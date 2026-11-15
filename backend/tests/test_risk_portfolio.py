"""Risk measures, portfolio aggregation and scenario repricing."""
from datetime import date

import numpy as np
import pytest

from app.core import scenarios
from app.core.bond import FixedRateBond, bond_cash_flows, risk_at_yield
from app.core.curve import ParCurve
from app.core.portfolio import Position, analyze_portfolio, run_scenario, sample_portfolio
from app.core.risk import CurveSet, curve_risk
from app.data.sources import TENORS

SETTLE = date(2026, 5, 15)
FLAT5 = ParCurve.from_percent({t: 5.0 for t in TENORS})
UPWARD = ParCurve.from_percent({"1M": 3.0, "3M": 3.1, "6M": 3.2, "1Y": 3.3, "2Y": 3.5, "3Y": 3.7, "5Y": 4.0,
                                "7Y": 4.3, "10Y": 4.6, "20Y": 5.0, "30Y": 5.2})


def pos(i, years, cpn, face=10_000_000):
    return Position(id=f"b{i}", label=f"B{i}", coupon_rate=cpn, maturity=date(2026 + years, 5, 15), face_amount=face)


PORT = [pos(1, 2, 0.035, 20e6), pos(2, 5, 0.04, 30e6), pos(3, 10, 0.045, 30e6), pos(4, 30, 0.05, 20e6)]


# ------------------------------------------------------------------ curve risk

def test_effective_duration_matches_modified_on_flat_curve():
    cs = CurveSet.build(FLAT5)
    cf = bond_cash_flows(FixedRateBond(date(2036, 5, 15), 0.05), SETTLE)
    cr = curve_risk(cf, cs)
    yr = risk_at_yield(cf, 0.05)
    assert cr.dirty == pytest.approx(100.0, abs=1e-9)
    # A parallel par shift on a flat semiannual curve is a parallel YTM shift for this bond
    assert cr.effective_duration == pytest.approx(yr.modified, rel=1e-6)
    assert cr.effective_convexity == pytest.approx(yr.convexity, rel=1e-3)


@pytest.mark.parametrize("years,cpn", [(2, 0.035), (7, 0.042), (10, 0.045), (30, 0.05)])
def test_key_rate_durations_sum_to_effective_duration(years, cpn):
    cs = CurveSet.build(UPWARD)
    cf = bond_cash_flows(FixedRateBond(date(2026 + years, 5, 15), cpn), SETTLE)
    cr = curve_risk(cf, cs)
    assert sum(cr.krd.values()) == pytest.approx(cr.effective_duration, rel=1e-4)
    assert sum(cr.kr_dv01.values()) == pytest.approx(cr.dv01, rel=1e-4)


def test_krd_locality():
    """A 10Y bond has no exposure to tenors beyond its maturity, and its largest KRD is at 10Y."""
    cs = CurveSet.build(UPWARD)
    cr = curve_risk(bond_cash_flows(FixedRateBond(date(2036, 5, 15), 0.045), SETTLE), cs)
    assert cr.krd["20Y"] == pytest.approx(0.0, abs=1e-12)
    assert cr.krd["30Y"] == pytest.approx(0.0, abs=1e-12)
    assert max(cr.krd, key=cr.krd.get) == "10Y"


def test_dv01_positive_and_matches_one_bp_loss():
    cs = CurveSet.build(UPWARD)
    cf = bond_cash_flows(FixedRateBond(date(2036, 5, 15), 0.045), SETTLE)
    cr = curve_risk(cf, cs)
    assert cr.dv01 > 0
    sc = run_scenario([pos(1, 10, 0.045, 100)], UPWARD, scenarios.parallel(1.0), SETTLE)
    assert -sc["totals"]["pnl_full"] == pytest.approx(cr.dv01, rel=1e-3)


# ------------------------------------------------------------------ aggregation

def test_portfolio_aggregation_identities():
    a = analyze_portfolio(PORT, UPWARD, SETTLE)
    h = a["holdings"]
    s = a["summary"]
    assert s["market_value"] == pytest.approx(sum(r["market_value"] for r in h))
    assert sum(r["weight"] for r in h) == pytest.approx(1.0)
    assert s["dv01"] == pytest.approx(sum(r["dv01"] for r in h))
    assert s["modified_duration"] == pytest.approx(sum(r["weight"] * r["modified_duration"] for r in h))
    assert sum(a["key_rate_dv01"].values()) == pytest.approx(s["dv01"], rel=1e-4)
    assert sum(b["weight"] for b in a["maturity_buckets"]) == pytest.approx(1.0)
    assert sum(r["dv01_share"] for r in h) == pytest.approx(1.0)
    # Market value-based DV01 consistency: DV01 ~= D_eff * MV * 1bp
    assert s["dv01"] == pytest.approx(s["effective_duration"] * s["market_value"] * 1e-4, rel=1e-6)


def test_portfolio_scaling_is_linear():
    a = analyze_portfolio(PORT, UPWARD, SETTLE)
    doubled = [Position(p.id, p.label, p.coupon_rate, p.maturity, 2 * p.face_amount) for p in PORT]
    b = analyze_portfolio(doubled, UPWARD, SETTLE)
    assert b["summary"]["market_value"] == pytest.approx(2 * a["summary"]["market_value"])
    assert b["summary"]["dv01"] == pytest.approx(2 * a["summary"]["dv01"])
    assert b["summary"]["modified_duration"] == pytest.approx(a["summary"]["modified_duration"])


def test_portfolio_yield_conventions_bracket():
    a = analyze_portfolio(PORT, UPWARD, SETTLE)
    ys = [r["ytm_pct"] for r in a["holdings"]]
    assert min(ys) <= a["summary"]["cash_flow_yield_pct"] <= max(ys)
    assert min(ys) <= a["summary"]["mv_weighted_ytm_pct"] <= max(ys)


def test_concentration_warning():
    a = analyze_portfolio([pos(1, 10, 0.045, 90e6), pos(2, 2, 0.035, 10e6)], UPWARD, SETTLE)
    assert a["concentration"]["warnings"]
    assert a["concentration"]["hhi"] > 0.5


def test_invalid_portfolios():
    with pytest.raises(ValueError):
        analyze_portfolio([], UPWARD, SETTLE)
    with pytest.raises(ValueError):
        analyze_portfolio([pos(1, -1, 0.04)], UPWARD, SETTLE)


# ------------------------------------------------------------------ scenarios

def test_parallel_shock_signs_and_approximations():
    up = run_scenario(PORT, UPWARD, scenarios.parallel(100), SETTLE)["totals"]
    dn = run_scenario(PORT, UPWARD, scenarios.parallel(-100), SETTLE)["totals"]
    assert up["pnl_full"] < 0 < dn["pnl_full"]
    # Positive convexity: gains from a fall exceed losses from an equal rise
    assert dn["pnl_full"] > -up["pnl_full"]
    # First-order estimate is symmetric and overstates losses / understates gains
    assert up["pnl_krd_approx"] < up["pnl_full"]
    assert dn["pnl_krd_approx"] < dn["pnl_full"]
    # Convexity adjustment brings the estimate closer to full revaluation
    for t in (up, dn):
        assert abs(t["pnl_krd_convexity_approx"] - t["pnl_full"]) < abs(t["pnl_krd_approx"] - t["pnl_full"])


def test_small_shock_first_order_accuracy():
    t = run_scenario(PORT, UPWARD, scenarios.parallel(1.0), SETTLE)["totals"]
    assert t["pnl_krd_approx"] == pytest.approx(t["pnl_full"], rel=2e-3)
    assert sum(t["pnl_by_key_rate"].values()) == pytest.approx(t["pnl_krd_approx"])


def test_nonparallel_shock_is_local():
    """A shock only at 30Y cannot affect a 2Y or 5Y bond (linear par interpolation between 20Y and 30Y)."""
    sc = run_scenario(PORT, UPWARD, {"30Y": 50.0}, SETTLE)
    by = {r["id"]: r for r in sc["pnl"]}
    assert by["b1"]["pnl_full"] == pytest.approx(0.0, abs=1e-6)
    assert by["b2"]["pnl_full"] == pytest.approx(0.0, abs=1e-6)
    assert by["b4"]["pnl_full"] < 0


def test_steepener_hurts_long_more_than_short():
    sc = run_scenario(PORT, UPWARD, scenarios.preset("bear_steepener"), SETTLE)
    r = {x["id"]: x["return_full"] for x in sc["pnl"]}
    assert r["b4"] < r["b3"] < r["b2"] < r["b1"] < 0


def test_shocked_curve_equals_base_plus_shock():
    sh = scenarios.preset("twist_steepening")
    sc = run_scenario(PORT, UPWARD, sh, SETTLE)
    for t in TENORS:
        assert sc["shocked_curve_pct"][t] - sc["base_curve_pct"][t] == pytest.approx(sh[t] / 100)


def test_zero_shock_zero_pnl():
    sc = run_scenario(PORT, UPWARD, {}, SETTLE)
    assert sc["totals"]["pnl_full"] == pytest.approx(0.0, abs=1e-6)


def test_scenario_shape_generators():
    p = scenarios.parallel(25)
    assert set(p.values()) == {25.0}
    s = scenarios.slope(-50, -15)
    assert s["1M"] == -50 and s["30Y"] == -15 and s["5Y"] == pytest.approx(-50 + 35 * 3 / 8)
    tw = scenarios.twist(25)
    assert tw["5Y"] == 0 and tw["2Y"] == -25 and tw["30Y"] == 25
    assert scenarios.classify_move(scenarios.preset("bull_steepener")) == "bull steepening"
    assert scenarios.classify_move(scenarios.preset("bear_flattener")) == "bear flattening"
    assert scenarios.classify_move(scenarios.preset("bull_flattener")) == "bull flattening"
    assert scenarios.classify_move(scenarios.preset("bear_steepener")) == "bear steepening"
    assert scenarios.classify_move(scenarios.parallel(-30)) == "parallel shift down"
    with pytest.raises(ValueError):
        scenarios.from_anchors({"4Y": 10})


# ------------------------------------------------------------------ samples

def test_sample_portfolios_trade_near_par_and_barbell_matches_bullet():
    bullet = analyze_portfolio(sample_portfolio("bullet", UPWARD, SETTLE), UPWARD, SETTLE)
    barbell = analyze_portfolio(sample_portfolio("barbell", UPWARD, SETTLE), UPWARD, SETTLE)
    assert barbell["summary"]["modified_duration"] == pytest.approx(bullet["summary"]["modified_duration"], rel=1e-9)
    assert barbell["summary"]["market_value"] == pytest.approx(bullet["summary"]["market_value"], rel=1e-9)
    assert barbell["summary"]["convexity"] > bullet["summary"]["convexity"]
    for h in bullet["holdings"]:
        assert abs(h["clean_price"] - 100) < 1.5  # coupon rounded to 1/8 of par yield
    for name in ("short", "intermediate", "long", "ladder"):
        a = analyze_portfolio(sample_portfolio(name, UPWARD, SETTLE), UPWARD, SETTLE)
        assert a["summary"]["market_value"] > 0
    d = {n: analyze_portfolio(sample_portfolio(n, UPWARD, SETTLE), UPWARD, SETTLE)["summary"]["modified_duration"]
         for n in ("short", "intermediate", "long")}
    assert d["short"] < d["intermediate"] < d["long"]
    assert np.isfinite(list(d.values())).all()
