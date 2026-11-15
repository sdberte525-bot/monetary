"""Bond pricing engine tests against closed-form results and published textbook examples."""
from datetime import date

import numpy as np
import pytest

from app.core.bond import (
    BP,
    CashFlows,
    FixedRateBond,
    analyze_bond_at_price,
    analyze_bond_at_yield,
    approximation_table,
    bond_cash_flows,
    custom_cash_flows,
    dirty_price_at_yield,
    horizon_return,
    risk_at_yield,
    yield_from_dirty_price,
    zero_coupon_bond,
)
from app.core.daycount import DayCount, days_30_360_us

SETTLE = date(2026, 5, 15)


def annuity_price(c_per_period: float, y_per_period: float, n: int, face: float = 100.0) -> float:
    """Independent closed-form price of a bond on a coupon date."""
    return c_per_period * (1 - (1 + y_per_period) ** -n) / y_per_period + face * (1 + y_per_period) ** -n


def closed_form_macaulay_periods(c: float, y: float, n: int) -> float:
    """Closed-form Macaulay duration (in periods) for a level-coupon bond on a coupon date.
    c, y are per-period decimals. (e.g. Fabozzi, Bond Markets, Analysis & Strategies)."""
    return (1 + y) / y - (1 + y + n * (c - y)) / (c * ((1 + y) ** n - 1) + y)


# ---------------------------------------------------------------- zero-coupon bonds

def test_zero_coupon_price_semiannual_bey():
    z = zero_coupon_bond(date(2036, 5, 15))
    r = analyze_bond_at_yield(z, SETTLE, 0.05)
    assert r.dirty == pytest.approx(100 / 1.025**20, abs=1e-10)
    assert r.dirty == pytest.approx(61.0270943, abs=1e-6)
    assert r.accrued == 0.0
    # Macaulay duration of a zero equals its maturity
    assert r.macaulay == pytest.approx(10.0, abs=1e-12)
    assert r.modified == pytest.approx(10.0 / 1.025, abs=1e-12)


def test_zero_coupon_fractional_period():
    # 3 months into a semiannual period -> exponent 2*T with T measured ACT/ACT in periods
    z = zero_coupon_bond(date(2031, 5, 15))
    settle = date(2026, 8, 15)  # 92 of 184 days into the period
    cf = bond_cash_flows(z, settle)
    assert cf.years[-1] * 2 == pytest.approx(9 + 92 / 184, abs=1e-12)
    assert dirty_price_at_yield(cf, 0.04) == pytest.approx(100 / 1.02 ** (9 + 0.5), abs=1e-10)


# ---------------------------------------------------------------- coupon bonds

@pytest.mark.parametrize(
    "coupon,ytm,years,expected",
    [
        # Fabozzi, "Bond Markets, Analysis and Strategies": 20-year 9% bond at 6% -> 134.6722
        (0.09, 0.06, 20, 134.6722),
        # Fabozzi: 20-year 10% bond at 11% -> 91.9770 (published value rounded to 4dp
        # from 91.97694 in the source's PV-factor arithmetic; tolerance 1e-4)
        (0.10, 0.11, 20, 91.9770),
    ],
)
def test_textbook_prices(coupon, ytm, years, expected):
    b = FixedRateBond(date(2026 + years, 5, 15), coupon)
    r = analyze_bond_at_yield(b, SETTLE, ytm)
    assert r.dirty == pytest.approx(expected, abs=1e-4)


def test_against_closed_form_grid():
    rng = np.random.default_rng(7)
    for _ in range(50):
        c = rng.uniform(0.0, 0.10)
        y = rng.uniform(0.001, 0.12)
        n_years = int(rng.integers(1, 31))
        b = FixedRateBond(date(2026 + n_years, 5, 15), c)
        r = analyze_bond_at_yield(b, SETTLE, y)
        assert r.dirty == pytest.approx(annuity_price(100 * c / 2, y / 2, 2 * n_years), rel=1e-12)
        if c > 0:
            mac = closed_form_macaulay_periods(c / 2, y / 2, 2 * n_years) / 2
            assert r.macaulay == pytest.approx(mac, rel=1e-9)


def test_par_bond_prices_at_par_on_coupon_date():
    b = FixedRateBond(date(2036, 5, 15), 0.0425)
    assert analyze_bond_at_yield(b, SETTLE, 0.0425).clean == pytest.approx(100.0, abs=1e-10)


def test_fabozzi_modified_duration():
    b = FixedRateBond(date(2046, 5, 15), 0.09)
    r = analyze_bond_at_yield(b, SETTLE, 0.06)
    assert round(r.modified, 2) == 10.66


def test_ytm_round_trip_with_accrued():
    b = FixedRateBond(date(2034, 2, 15), 0.03875)
    settle = date(2026, 11, 16)
    for y in (-0.002, 0.0, 0.01, 0.045, 0.09):
        cf = bond_cash_flows(b, settle)
        p = dirty_price_at_yield(cf, y)
        assert yield_from_dirty_price(cf, p) == pytest.approx(y, abs=1e-12)
    r = analyze_bond_at_price(b, settle, 97.25)
    assert r.clean == pytest.approx(97.25, abs=1e-9)


def test_yield_solver_rejects_impossible_price():
    cf = bond_cash_flows(FixedRateBond(date(2030, 5, 15), 0.04), SETTLE)
    with pytest.raises(ValueError):
        yield_from_dirty_price(cf, 0.0)
    with pytest.raises(ValueError):
        yield_from_dirty_price(cf, 10_000.0)


# ---------------------------------------------------------------- accrued interest & day counts

def test_accrued_act_act_hand_calculation():
    # 4% semiannual; period 2026-05-15 -> 2026-11-15 = 184 days; settle 92 days in.
    b = FixedRateBond(date(2030, 5, 15), 0.04)
    cf = bond_cash_flows(b, date(2026, 8, 15))
    assert cf.previous_coupon == date(2026, 5, 15)
    assert cf.next_coupon == date(2026, 11, 15)
    assert cf.accrued == pytest.approx(2.0 * 92 / 184, abs=1e-12)


def test_accrued_30_360_hand_calculation():
    b = FixedRateBond(date(2031, 1, 15), 0.06, day_count=DayCount.THIRTY_360)
    cf = bond_cash_flows(b, date(2026, 3, 1))
    assert days_30_360_us(date(2026, 1, 15), date(2026, 3, 1)) == 46
    assert cf.accrued == pytest.approx(3.0 * 46 / 180, abs=1e-12)


def test_30_360_end_of_month_rules():
    assert days_30_360_us(date(2026, 1, 31), date(2026, 3, 31)) == 60
    assert days_30_360_us(date(2026, 1, 30), date(2026, 3, 31)) == 60
    assert days_30_360_us(date(2026, 1, 15), date(2026, 3, 31)) == 76


def test_coupon_on_settlement_belongs_to_seller():
    b = FixedRateBond(date(2030, 5, 15), 0.05)
    cf = bond_cash_flows(b, date(2026, 11, 15))
    assert cf.accrued == 0.0
    assert cf.dates[0] == date(2027, 5, 15)


def test_end_of_month_schedule():
    b = FixedRateBond(date(2031, 8, 31), 0.04)
    cf = bond_cash_flows(b, date(2026, 11, 16))
    assert cf.previous_coupon == date(2026, 8, 31)
    assert cf.next_coupon == date(2027, 2, 28)
    assert date(2029, 2, 28) in cf.dates and date(2028, 2, 29) in cf.dates


# ---------------------------------------------------------------- duration / convexity / DV01

def test_duration_convexity_match_finite_differences():
    b = FixedRateBond(date(2041, 2, 15), 0.0475)
    cf = bond_cash_flows(b, date(2026, 11, 16))
    y, h = 0.051, 1e-5
    r = risk_at_yield(cf, y)
    pu, pd, p0 = dirty_price_at_yield(cf, y + h), dirty_price_at_yield(cf, y - h), r.dirty
    assert r.modified == pytest.approx((pd - pu) / (2 * h * p0), rel=1e-7)
    assert r.convexity == pytest.approx((pu + pd - 2 * p0) / (h * h * p0), rel=1e-4)


def test_dv01_sign_and_magnitude():
    b = FixedRateBond(date(2036, 5, 15), 0.05)
    r = analyze_bond_at_yield(b, SETTLE, 0.05)
    # Hand calculation: Mac = (1.025/0.025)(1 - 1.025^-20)/2 = 7.989446 y; Dmod = Mac/1.025 = 7.794581
    assert r.macaulay == pytest.approx(41 * (1 - 1.025**-20) / 2, rel=1e-12)
    assert r.modified == pytest.approx(7.794581, abs=1e-6)
    assert r.dv01 > 0
    assert r.dv01 == pytest.approx(0.07794581, abs=1e-8)
    cf = bond_cash_flows(b, SETTLE)
    actual_loss = r.dirty - dirty_price_at_yield(cf, 0.05 + BP)
    assert r.dv01 == pytest.approx(actual_loss, rel=1e-3)


def test_hull_continuous_compounding_example():
    # Hull, Options Futures & Other Derivatives, Table 4.6: 3y 10% bond, semiannual coupons,
    # yield 12% continuously compounded -> price 94.213, duration 2.653 years.
    cf = CashFlows(
        settlement=SETTLE, dates=tuple(), amounts=np.array([5, 5, 5, 5, 5, 105.0]),
        years=np.arange(1, 7) * 0.5, compounding=None,
    )
    r = risk_at_yield(cf, 0.12)
    assert r.dirty == pytest.approx(94.213, abs=5e-4)
    assert r.macaulay == pytest.approx(2.653, abs=5e-4)
    assert r.modified == r.macaulay  # continuous compounding


def test_custom_cash_flows_drop_past_flows():
    cf = custom_cash_flows(SETTLE, [date(2026, 1, 1), date(2027, 5, 15), date(2028, 5, 15)], [5, 5, 105])
    assert len(cf.amounts) == 2


def test_convexity_improves_approximation():
    b = FixedRateBond(date(2056, 5, 15), 0.045)
    cf = bond_cash_flows(b, SETTLE)
    rows = approximation_table(cf, 0.045, [-200, -100, 100, 200])
    for row in rows:
        assert abs(row["convexity_error_bp_of_price"]) < abs(row["duration_error_bp_of_price"])
        # duration approximation always underestimates price for an option-free bond
        assert row["duration_return"] <= row["full_return"]


# ---------------------------------------------------------------- horizon return

def test_horizon_return_identity():
    b = FixedRateBond(date(2036, 5, 15), 0.045)
    settle, horizon = date(2026, 6, 1), date(2027, 6, 1)
    hr = horizon_return(b, settle, horizon, 0.045, 0.050)
    parts = hr.coupons_received + hr.reinvestment_income + hr.accrued_change + hr.accretion_rolldown + hr.rate_effect
    assert parts == pytest.approx(hr.total, abs=1e-12)
    assert hr.total == pytest.approx(
        hr.final_dirty + hr.coupons_received + hr.reinvestment_income - hr.initial_dirty, abs=1e-10
    )
    assert hr.coupons_received == pytest.approx(4.5, abs=1e-12)  # two semiannual coupons
    assert hr.rate_effect < 0  # yields rose


def test_invalid_inputs():
    with pytest.raises(ValueError):
        FixedRateBond(date(2030, 1, 1), 4.25)  # percent passed instead of decimal
    with pytest.raises(ValueError):
        bond_cash_flows(FixedRateBond(date(2026, 1, 1), 0.04), SETTLE)  # matured
