from datetime import date

import numpy as np
import pytest

from app.core.bond import FixedRateBond, bond_cash_flows, risk_at_yield
from app.core.curve import SEMI_NODES, ParCurve, ZeroCurve, bootstrap, curve_shape
from app.core.risk import price_on_curve
from app.data.sources import TENORS

FLAT5 = {t: 5.0 for t in TENORS}
UPWARD = {"1M": 3.0, "3M": 3.1, "6M": 3.2, "1Y": 3.3, "2Y": 3.5, "3Y": 3.7, "5Y": 4.0,
          "7Y": 4.3, "10Y": 4.6, "20Y": 5.0, "30Y": 5.2}
INVERTED = {"1M": 5.5, "3M": 5.45, "6M": 5.35, "1Y": 5.1, "2Y": 4.7, "3Y": 4.4, "5Y": 4.1,
            "7Y": 4.0, "10Y": 3.9, "20Y": 4.1, "30Y": 4.0}


def test_flat_par_curve_gives_flat_zero_curve():
    zc = bootstrap(ParCurve.from_percent(FLAT5))
    z = zc.zero_rate(SEMI_NODES, compounding=2)
    np.testing.assert_allclose(z, 0.05, atol=1e-12)


@pytest.mark.parametrize("curve", [FLAT5, UPWARD, INVERTED])
def test_bootstrap_reprices_par_bonds_at_par(curve):
    par = ParCurve.from_percent(curve)
    zc = bootstrap(par)
    for t in np.arange(1.5, 30.01, 0.5):
        assert zc.par_yield(t) == pytest.approx(float(par.par_yield(t)), abs=1e-12)


def test_par_bond_off_curve_prices_at_100():
    par = ParCurve.from_percent(UPWARD)
    zc = bootstrap(par)
    settle = date(2026, 5, 15)
    cpn = float(par.par_yield(10.0))
    cf = bond_cash_flows(FixedRateBond(date(2036, 5, 15), cpn), settle)
    assert price_on_curve(cf, zc) == pytest.approx(100.0, abs=1e-9)


def test_zero_above_par_when_upward_sloping_and_below_when_inverted():
    up = bootstrap(ParCurve.from_percent(UPWARD))
    inv = bootstrap(ParCurve.from_percent(INVERTED))
    assert up.zero_rate(10.0)[0] > 0.046
    assert inv.zero_rate(10.0)[0] < 0.039


def test_discount_factors_monotone_and_start_at_one():
    zc = bootstrap(ParCurve.from_percent(UPWARD))
    t = np.linspace(0.0, 35.0, 500)
    d = zc.discount(t)
    assert d[0] == pytest.approx(1.0)
    assert np.all(np.diff(d) < 0)


def test_missing_tenors_are_dropped_not_filled():
    vals = dict(UPWARD)
    vals["30Y"] = None
    vals["1M"] = float("nan")
    par = ParCurve.from_percent(vals)
    assert "30Y" not in par.tenors and "1M" not in par.tenors
    zc = bootstrap(par)
    assert any("30Y" in w for w in zc.warnings)
    assert any("extrapolation" in w for w in zc.warnings)
    # flat extrapolation of the 20Y par yield beyond 20Y
    assert float(par.par_yield(30.0)) == pytest.approx(0.05)


def test_too_few_tenors_rejected():
    with pytest.raises(ValueError):
        ParCurve.from_percent({"10Y": 4.0})


def test_spot_rate_curve_round_trip():
    zc = ZeroCurve.from_spot_rates([1, 2, 5, 10, 30], [0.04, 0.041, 0.043, 0.045, 0.048])
    np.testing.assert_allclose(zc.zero_rate([1, 2, 5, 10, 30]), [0.04, 0.041, 0.043, 0.045, 0.048], atol=1e-12)
    # A bond priced off a user spot curve matches manual discounting
    cf = bond_cash_flows(FixedRateBond(date(2028, 5, 15), 0.05), date(2026, 5, 15))
    manual = sum(a * zc.discount(t)[0] for a, t in zip(cf.amounts, cf.years))
    assert price_on_curve(cf, zc) == pytest.approx(manual)


def test_curve_shape_definitions():
    assert curve_shape(UPWARD)["shape"] == "normal"
    assert curve_shape(INVERTED)["shape"] == "inverted"
    flat = dict(UPWARD, **{"10Y": 3.2})
    s = curve_shape(flat)
    assert s["spread_3m10y_bp"] == pytest.approx(10.0)
    assert s["shape_3m10y"] == "flat"
    assert curve_shape(UPWARD)["spread_2s10s_bp"] == pytest.approx(110.0)


def test_zero_curve_par_bond_yield_matches_ytm():
    # YTM of a par bond priced off the curve equals its coupon
    par = ParCurve.from_percent(INVERTED)
    zc = bootstrap(par)
    settle = date(2026, 5, 15)
    cpn = zc.par_yield(7.0)
    cf = bond_cash_flows(FixedRateBond(date(2033, 5, 15), cpn), settle)
    from app.core.bond import yield_from_dirty_price
    assert yield_from_dirty_price(cf, price_on_curve(cf, zc)) == pytest.approx(cpn, abs=1e-12)
    assert risk_at_yield(cf, cpn).clean == pytest.approx(100.0, abs=1e-9)
