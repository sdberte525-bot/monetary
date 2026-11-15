from datetime import date

import pytest

from app.core.curve import ParCurve
from app.core.optimization import barbell_vs_bullet, build_universe, optimize
from app.core.policy import (
    DEFAULT_PASS_THROUGH,
    INTERPRETATIONS,
    PATH_LOADING,
    TERM_PREMIUM_LOADING,
    TRANSMISSION_PROFILES,
    translate_policy_scenario,
)
from app.core.portfolio import analyze_portfolio, sample_portfolio
from app.data.sources import TENORS

SETTLE = date(2026, 5, 15)
CURVE = ParCurve.from_percent({"1M": 3.0, "3M": 3.1, "6M": 3.2, "1Y": 3.3, "2Y": 3.5, "3Y": 3.7, "5Y": 4.0,
                               "7Y": 4.3, "10Y": 4.6, "20Y": 5.0, "30Y": 5.2})


# ------------------------------------------------------------------ policy translation

def test_fully_expected_move_has_no_surprise_component():
    tr = translate_policy_scenario(-50, 1.0, 0, 0, DEFAULT_PASS_THROUGH)
    assert tr["surprise_bp"] == 0
    assert all(v == 0 for v in tr["shocks_bp"].values())


def test_surprise_pass_through_is_not_one_for_one():
    tr = translate_policy_scenario(50, 0.0, 0, 0, DEFAULT_PASS_THROUGH)
    sh = tr["shocks_bp"]
    assert sh["1M"] == pytest.approx(50 * DEFAULT_PASS_THROUGH["1M"])
    assert sh["10Y"] == pytest.approx(50 * DEFAULT_PASS_THROUGH["10Y"])
    assert sh["10Y"] < 50 and sh["30Y"] < sh["2Y"] < sh["3M"]


def test_components_sum_to_total():
    tr = translate_policy_scenario(-25, 0.4, -20, 10, DEFAULT_PASS_THROUGH, "twist", 15)
    for c in tr["components"]:
        assert c["surprise"] + c["path"] + c["term_premium"] + c["overlay"] == pytest.approx(c["total"])
        t = c["tenor"]
        assert c["surprise"] == pytest.approx(DEFAULT_PASS_THROUGH[t] * -25 * 0.6)
        assert c["path"] == pytest.approx(PATH_LOADING[t] * -20)
        assert c["term_premium"] == pytest.approx(TERM_PREMIUM_LOADING[t] * 10)


def test_parallel_transmission_is_one_for_one_benchmark():
    tr = translate_policy_scenario(100, 0.0, 0, 0, TRANSMISSION_PROFILES["parallel"]["beta"])
    assert all(v == pytest.approx(100) for v in tr["shocks_bp"].values())


def test_policy_input_validation():
    with pytest.raises(ValueError):
        translate_policy_scenario(25, 1.5, 0, 0, DEFAULT_PASS_THROUGH)
    with pytest.raises(ValueError):
        translate_policy_scenario(25, 0.5, 0, 0, {"2Y": 0.5})
    with pytest.raises(ValueError):
        translate_policy_scenario(900, 0.5, 0, 0, DEFAULT_PASS_THROUGH)


def test_presets_well_formed():
    for prof in TRANSMISSION_PROFILES.values():
        assert set(prof["beta"]) == set(TENORS)
    for k, v in INTERPRETATIONS.items():
        assert 0 <= v["priced_in"] <= 1, k


def test_recession_shock_bull_steepens():
    p = INTERPRETATIONS["recession_shock"]
    tr = translate_policy_scenario(-50, p["priced_in"], p["path_bp"], p["term_premium_bp"], DEFAULT_PASS_THROUGH)
    sh = tr["shocks_bp"]
    assert sh["2Y"] < sh["10Y"] < 0


# ------------------------------------------------------------------ optimization

@pytest.fixture(scope="module")
def universe():
    return build_universe(CURVE, SETTLE)


def test_duration_target_and_constraints_respected(universe):
    res = optimize(universe, "min_concentration", 1e8, target_duration=6.0, max_weight=0.3)
    assert res["status"] == "optimal"
    w = [a["weight"] for a in res["allocations"]]
    assert sum(w) == pytest.approx(1.0, abs=1e-8)
    assert all(-1e-9 <= x <= 0.3 + 1e-9 for x in w)
    assert res["portfolio"]["modified_duration"] == pytest.approx(6.0, abs=1e-6)
    assert sum(a["market_value"] for a in res["allocations"]) == pytest.approx(1e8, rel=1e-8)
    assert all(abs(r) < 1e-8 for r in res["constraint_residuals"]["equality"])


def test_bucket_constraint(universe):
    res = optimize(universe, "min_concentration", 1e8, target_duration=8.0, max_weight=1.0, max_bucket_weight=0.25)
    assert res["status"] == "optimal"
    assert max(res["constraint_residuals"]["inequality_slack_violation"]) < 1e-8


def test_infeasible_target_reported(universe):
    res = optimize(universe, "min_concentration", 1e8, target_duration=29.0, max_weight=0.5)
    assert res["status"] == "infeasible"


def test_long_short_allows_negative_weights(universe):
    res = optimize(universe, "max_yield", 1e8, target_duration=5.0, max_weight=0.5, long_only=False)
    assert res["status"] == "optimal"
    assert "not expected return" in res["objective_formula"]


def test_match_benchmark_krd(universe):
    bench = analyze_portfolio(sample_portfolio("ladder", CURVE, SETTLE), CURVE, SETTLE)
    res = optimize(universe, "match_krd", 1e8, max_weight=1.0, target_krd=bench["key_rate_durations"])
    assert res["status"] == "optimal"
    err = sum(abs(res["portfolio"]["krd"][t] - bench["key_rate_durations"][t]) for t in TENORS)
    assert err < 0.1


def test_barbell_bullet_duration_match():
    bb = barbell_vs_bullet(CURVE, SETTLE)
    a = analyze_portfolio(bb["bullet"], CURVE, SETTLE)["summary"]
    b = analyze_portfolio(bb["barbell"], CURVE, SETTLE)["summary"]
    assert b["modified_duration"] == pytest.approx(a["modified_duration"], rel=1e-9)
    assert b["convexity"] > a["convexity"]
    assert bb["weights"]["short"] + bb["weights"]["long"] == pytest.approx(1.0)
