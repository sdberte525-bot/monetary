"""Historical policy-episode analysis.

Three things are kept strictly separate in every result:
1. ``observed``      -- actual Treasury par-yield changes between two dates.
2. ``hypothetical``  -- P&L from applying those observed changes, as an
                        instantaneous shock, to a portfolio valued on the
                        CURRENT curve. This is a stress test, not a backtest:
                        it ignores carry, roll-down, the historical curve level,
                        reinvestment, and any trading.
3. ``assumptions``   -- anything inferred where data were unavailable (e.g. a
                        tenor not published in the window), explicitly listed.

Date alignment: for each window endpoint the last observation ON OR BEFORE
the requested date is used, so no information after the endpoint is used.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from app.core.portfolio import Position, run_scenario
from app.data.sources import TENOR_YEARS, TENORS
from app.data.store import MarketDataStore

HYPOTHETICAL_DISCLAIMER = (
    "Hypothetical stress test: the observed par-yield changes from the historical window are applied "
    "instantaneously to today's portfolio on today's curve. This is not a backtest - it ignores the "
    "historical curve level, coupon carry, roll-down, reinvestment, and trading over the window."
)


def observed_changes(store: MarketDataStore, start: date, end: date) -> dict:
    if end <= start:
        raise ValueError("window end must be after start")
    d0 = store.resolve_curve_date(start)
    d1 = store.resolve_curve_date(end)
    if d1 <= d0:
        raise ValueError("no Treasury observations inside the requested window")
    y0 = store.curve_row_pct(d0)
    y1 = store.curve_row_pct(d1)
    changes: dict[str, float | None] = {}
    for t in TENORS:
        changes[t] = None if (y0[t] is None or y1[t] is None) else round((y1[t] - y0[t]) * 100, 2)
    p0 = store.policy_range_on(d0)
    p1 = store.policy_range_on(d1)
    path = store.curve_history(d0, d1, ["3M", "2Y", "10Y", "30Y"])
    path_rows = [
        {"date": ix.strftime("%Y-%m-%d"), **{c: (None if pd.isna(v) else float(v)) for c, v in row.items()}}
        for ix, row in path.iterrows()
    ]
    # policy range path for the timeline chart
    up = store.series("DFEDTARU") if pd.Timestamp(d1) >= store.series("DFEDTARU").index.min() else None
    return {
        "start_requested": start.isoformat(),
        "end_requested": end.isoformat(),
        "start_observed": d0.isoformat(),
        "end_observed": d1.isoformat(),
        "yields_start_pct": y0,
        "yields_end_pct": y1,
        "changes_bp": changes,
        "spread_2s10s_bp": {
            "start": _spread(y0, "10Y", "2Y"), "end": _spread(y1, "10Y", "2Y"),
        },
        "spread_3m10y_bp": {
            "start": _spread(y0, "10Y", "3M"), "end": _spread(y1, "10Y", "3M"),
        },
        "policy_start": p0,
        "policy_end": p1,
        "policy_change_bp": round((p1["upper"] - p0["upper"]) * 100),
        "path": path_rows,
        "policy_series_used": "DFEDTARU/DFEDTARL" if up is not None else "DFEDTAR",
    }


def _spread(y: dict, a: str, b: str) -> float | None:
    if y.get(a) is None or y.get(b) is None:
        return None
    return round((y[a] - y[b]) * 100, 2)


def fill_missing_shocks(changes: dict[str, float | None]) -> tuple[dict[str, float], list[str]]:
    """Interpolate shocks for tenors without observations; return the list of filled tenors.

    This is an explicit, labeled assumption -- used only to build a shock for a
    current curve that has those tenors.
    """
    have = [(TENOR_YEARS[t], v) for t, v in changes.items() if v is not None]
    if len(have) < 2:
        raise ValueError("not enough observed tenors in the window to build a shock")
    xs, ys = zip(*sorted(have))
    filled, out = [], {}
    for t in TENORS:
        if changes.get(t) is None:
            out[t] = float(np.interp(TENOR_YEARS[t], xs, ys))
            filled.append(t)
        else:
            out[t] = float(changes[t])
    return out, filled


def apply_to_portfolios(
    store: MarketDataStore,
    start: date,
    end: date,
    portfolios: dict[str, list[Position]],
    curve_date: date | None,
    settlement: date,
) -> dict:
    obs = observed_changes(store, start, end)
    shocks, filled = fill_missing_shocks(obs["changes_bp"])
    par, as_of = store.curve_on(curve_date)
    results = {}
    for name, positions in portfolios.items():
        sc = run_scenario(positions, par, shocks, settlement)
        results[name] = {
            "market_value_before": sc["base"]["summary"]["market_value"],
            "pnl_full": sc["totals"]["pnl_full"],
            "return_full": sc["totals"]["return_full"],
            "pnl_krd_approx": sc["totals"]["pnl_krd_approx"],
            "duration": sc["base"]["summary"]["modified_duration"],
            "dv01": sc["base"]["summary"]["dv01"],
            "by_security": sc["pnl"],
        }
    assumptions = []
    if filled:
        assumptions.append(
            "Tenors without observations in the window were assigned shocks by linear interpolation "
            "(in maturity) of observed tenor changes: " + ", ".join(filled)
        )
    return {
        "observed": obs,
        "hypothetical": {
            "valuation_curve_as_of": as_of.isoformat(),
            "settlement": settlement.isoformat(),
            "shocks_bp": shocks,
            "results": results,
            "disclaimer": HYPOTHETICAL_DISCLAIMER,
        },
        "assumptions": assumptions,
    }
