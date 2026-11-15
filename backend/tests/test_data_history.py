"""Data ingestion, missing-data handling, date alignment (no look-ahead) and historical episodes."""
from datetime import date

import pandas as pd
import pytest

from app.core.historical import apply_to_portfolios, fill_missing_shocks, observed_changes
from app.core.macro import dashboard, monthly_indicator
from app.core.portfolio import sample_portfolio
from app.core.schedule import treasury_settlement
from app.data.events import HISTORICAL_EVENTS
from app.data.sources import parse_fred_csv, parse_treasury_csv
from app.data.store import DataUnavailable

OLD_CSV = 'Date,"3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","30 Yr"\n12/31/1991,3.96,4.00,4.12,4.77,5.11,5.93,6.38,6.71,7.41\n'
NEW_CSV = ('Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"\n'
           "11/13/2026,4.10,4.18,4.26,4.32,4.34,4.42,4.65,4.88,4.92,4.98,5.05,5.15,5.52,5.47\n"
           "11/12/2026,4.12,4.18,4.26,4.32,4.35,4.42,4.65,4.86,4.90,4.95,5.02,5.10,5.48,5.43\n")


def test_parse_treasury_missing_tenors_are_nan_not_filled():
    df = parse_treasury_csv(OLD_CSV)
    assert pd.isna(df.loc["1991-12-31", "1M"]) and pd.isna(df.loc["1991-12-31", "20Y"])
    assert df.loc["1991-12-31", "30Y"] == 7.41


def test_parse_treasury_ignores_unused_columns_and_sorts():
    df = parse_treasury_csv(NEW_CSV)
    assert list(df.columns) == ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]
    assert df.index.is_monotonic_increasing
    assert df.iloc[-1]["10Y"] == 5.15


def test_parse_treasury_rejects_implausible_values():
    from app.data.sources import DataSourceError
    with pytest.raises(DataSourceError):
        parse_treasury_csv(NEW_CSV.replace("5.15", "515"))


def test_parse_fred_drops_missing_dots():
    s = parse_fred_csv("observation_date,DGS10\n2024-01-01,.\n2024-01-02,3.95\n", "DGS10")
    assert len(s) == 1 and s.iloc[0] == 3.95


def test_snapshot_loaded_and_labeled(store):
    assert store.curve_provenance.mode == "snapshot"
    first, last = store.curve_dates()
    assert first <= date(1990, 1, 2) and last >= date(2026, 1, 1)


def test_date_alignment_uses_last_observation_on_or_before(store):
    # Saturday 2024-12-28 -> Friday 2024-12-27; never the following Monday
    assert store.resolve_curve_date(date(2024, 12, 28)) == date(2024, 12, 27)
    d = store.resolve_curve_date(date(2024, 12, 25))  # holiday
    assert d == date(2024, 12, 24)
    with pytest.raises(DataUnavailable):
        store.resolve_curve_date(date(1985, 1, 1))


def test_missing_tenor_reported_in_curve(store):
    par, d = store.curve_on(date(2004, 6, 1))  # 30Y not published 2002-02 to 2006-02
    assert "30Y" in par.missing_tenors()


def test_policy_range_history(store):
    after_march_2020 = store.policy_range_on(date(2020, 3, 20))
    assert (after_march_2020["lower"], after_march_2020["upper"]) == (0.0, 0.25)
    assert after_march_2020["kind"] == "range"
    before = store.policy_range_on(date(2020, 3, 2))
    assert (before["lower"], before["upper"]) == (1.5, 1.75)
    pre = store.policy_range_on(date(2007, 1, 15))
    assert pre["kind"] == "point target" and pre["upper"] == 5.25


@pytest.mark.parametrize("ev", HISTORICAL_EVENTS, ids=lambda e: e["id"])
def test_policy_changes_align_with_cited_announcements(store, ev):
    """Every cited rate-change announcement is followed (same or next business day) by a FRED target change."""
    changes = {c["effective_date"] for c in store.policy_changes()}
    for a in ev["announcements"]:
        d = date.fromisoformat(a["date"])
        title = a["title"].lower()
        if any(k in title for k in ("cut", "bp", "+25", "-25", "-50", "0 to 1/4", "establishes")) and "no taper" not in title:
            nxt = [pd.Timestamp(d) + pd.offsets.BDay(k) for k in range(0, 2)]
            assert any(x.strftime("%Y-%m-%d") in changes for x in nxt), (ev["id"], a)


def test_event_windows_have_data_and_no_lookahead(store):
    for ev in HISTORICAL_EVENTS:
        s, e = date.fromisoformat(ev["window"]["start"]), date.fromisoformat(ev["window"]["end"])
        obs = observed_changes(store, s, e)
        assert date.fromisoformat(obs["start_observed"]) <= s
        assert date.fromisoformat(obs["end_observed"]) <= e
        assert all(p["date"] <= obs["end_observed"] for p in obs["path"])


def test_known_historical_moves(store):
    # 2024 easing window: 100bp of cuts while the 10Y yield rose (from official data)
    obs = observed_changes(store, date(2024, 9, 17), date(2024, 12, 31))
    assert obs["policy_change_bp"] == -100
    assert obs["changes_bp"]["10Y"] > 50
    # 2023 banking stress: 2Y fell sharply
    obs = observed_changes(store, date(2023, 3, 8), date(2023, 3, 24))
    assert obs["changes_bp"]["2Y"] < -80


def test_fill_missing_shocks_is_explicit():
    shocks, filled = fill_missing_shocks({"1M": None, "3M": 10, "6M": 10, "1Y": 10, "2Y": 20, "3Y": 20, "5Y": 20,
                                          "7Y": 20, "10Y": 30, "20Y": 30, "30Y": None})
    assert filled == ["1M", "30Y"]
    assert shocks["30Y"] == 30 and shocks["1M"] == 10


def test_hypothetical_application_labeled(store):
    par, d = store.curve_on(None)
    settle = treasury_settlement(d)
    res = apply_to_portfolios(store, date(2013, 5, 21), date(2013, 9, 17),
                              {"long": sample_portfolio("long", par, settle)}, None, settle)
    assert "not a backtest" in res["hypothetical"]["disclaimer"]
    assert res["hypothetical"]["results"]["long"]["pnl_full"] < 0  # taper tantrum: yields rose


def test_macro_alignment(store):
    cpi = monthly_indicator(store, "cpi_yoy")
    raw = store.series("CPIAUCSL")
    t = pd.Timestamp("2023-06-01")
    assert cpi[t] == pytest.approx((raw[t] / raw[pd.Timestamp("2022-06-01")] - 1) * 100)
    out = dashboard(store, "core_pce_yoy", "ust_10y", date(2000, 1, 1), None, window=36, lag_months=3)
    assert out["n_levels"] > 200 and -1 <= out["correlation_levels"] <= 1
    lagged = monthly_indicator(store, "core_pce_yoy").shift(3, freq="MS")
    first = out["observations"][0]
    assert first["x"] == pytest.approx(lagged[pd.Timestamp(first["date"])])
    with pytest.raises(ValueError):
        dashboard(store, "nope", "ust_10y", None, None)
