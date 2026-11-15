"""Bond cash-flow generation, yield-based valuation and analytic risk measures.

Conventions (stated once, used everywhere)
-----------------------------------------
* Prices are quoted per 100 of face value. Position values scale by face/100.
* Yields are decimals internally (0.045 = 4.50%). The API layer converts from
  percent; 1 basis point = 0.0001 = 0.01%.
* Yield-to-maturity uses the *street convention*: periodic compounding at the
  coupon frequency f, with fractional first period
      dirty = sum_k CF_k / (1 + y/f)^(w + k - 1)
  where w = (days settlement->next coupon) / (days in coupon period).
  (Treasury's own "simple interest in the final coupon period" convention
  is not used; the difference is limited to bonds in their last period.)
* Zero-coupon bonds are modeled as coupon = 0 with semiannual compounding
  (the U.S. STRIPS bond-equivalent convention).
* Duration and convexity are expressed in years / years^2 and are derivatives
  with respect to the bond's own yield, holding the settlement date fixed.
* DV01 (PVBP) is reported as a POSITIVE number: the price *decrease* for a
  1bp *increase* in yield. DV01 = D_mod * dirty price * 0.0001.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
from scipy.optimize import brentq

from app.core.daycount import DayCount, accrual_fraction, days_30_360_us, year_fraction_act365
from app.core.schedule import coupon_schedule

BP = 1e-4


@dataclass(frozen=True)
class FixedRateBond:
    maturity: date
    coupon_rate: float  # decimal, annual (0.0425 = 4.25%)
    frequency: int = 2
    day_count: DayCount = DayCount.ACT_ACT_ICMA
    redemption: float = 100.0  # per 100 face

    def __post_init__(self) -> None:
        if not (-0.01 <= self.coupon_rate <= 0.5):
            raise ValueError("coupon_rate must be a decimal between -1% and 50% (e.g. 0.0425)")
        if self.frequency not in (1, 2, 4, 12):
            raise ValueError("frequency must be 1, 2, 4 or 12")


def zero_coupon_bond(maturity: date) -> FixedRateBond:
    return FixedRateBond(maturity=maturity, coupon_rate=0.0, frequency=2)


@dataclass(frozen=True)
class CashFlows:
    """Remaining cash flows of an instrument as of a settlement date (per 100 face)."""

    settlement: date
    dates: tuple[date, ...]
    amounts: np.ndarray
    years: np.ndarray  # time from settlement in years (periods / f for bonds)
    compounding: int | None  # periods per year used to discount at a yield; None = continuous
    accrued: float = 0.0
    previous_coupon: date | None = None
    next_coupon: date | None = None
    accrual_fraction: float = 0.0


def bond_cash_flows(bond: FixedRateBond, settlement: date) -> CashFlows:
    sched = coupon_schedule(settlement, bond.maturity, bond.frequency)
    f = bond.frequency
    coupon = 100.0 * bond.coupon_rate / f
    prev, nxt = sched.previous_coupon, sched.next_coupon
    af = accrual_fraction(bond.day_count, prev, nxt, settlement, f)
    accrued = coupon * af
    # Fraction of the current period remaining, on the convention's own day basis.
    if bond.day_count == DayCount.THIRTY_360:
        den = days_30_360_us(prev, nxt)
        w = days_30_360_us(settlement, nxt) / den
    else:
        w = (nxt - settlement).days / (nxt - prev).days
    n = len(sched.payment_dates)
    periods = w + np.arange(n, dtype=float)
    amounts = np.full(n, coupon)
    amounts[-1] += bond.redemption
    return CashFlows(
        settlement=settlement,
        dates=sched.payment_dates,
        amounts=amounts,
        years=periods / f,
        compounding=f,
        accrued=accrued,
        previous_coupon=prev,
        next_coupon=nxt,
        accrual_fraction=af,
    )


def custom_cash_flows(
    settlement: date, dates: list[date], amounts: list[float], compounding: int | None = 2
) -> CashFlows:
    """Arbitrary cash flows; time measured ACT/365F; flows on/before settlement are dropped."""
    if len(dates) != len(amounts):
        raise ValueError("dates and amounts must have equal length")
    pairs = sorted((d, float(a)) for d, a in zip(dates, amounts) if d > settlement)
    if not pairs:
        raise ValueError("no cash flows after settlement")
    ds = tuple(p[0] for p in pairs)
    am = np.array([p[1] for p in pairs])
    yrs = np.array([year_fraction_act365(settlement, d) for d in ds])
    return CashFlows(settlement=settlement, dates=ds, amounts=am, years=yrs, compounding=compounding)


# --------------------------------------------------------------------------- yield math

def discount_factors_at_yield(years: np.ndarray, y: float, compounding: int | None) -> np.ndarray:
    if compounding is None:
        return np.exp(-y * years)
    base = 1.0 + y / compounding
    if base <= 0:
        raise ValueError("yield too negative for the compounding frequency")
    return base ** (-compounding * years)


def dirty_price_at_yield(cf: CashFlows, y: float) -> float:
    return float(np.dot(cf.amounts, discount_factors_at_yield(cf.years, y, cf.compounding)))


def yield_from_dirty_price(cf: CashFlows, dirty: float, lo: float = -0.5, hi: float = 3.0) -> float:
    """Solve for YTM with Brent's method (bracketed, guaranteed convergence)."""
    if dirty <= 0:
        raise ValueError("price must be positive")
    g = lambda y: dirty_price_at_yield(cf, y) - dirty  # noqa: E731 - monotone decreasing in y
    if cf.compounding is not None:
        lo = max(lo, -0.99 * cf.compounding)
    if g(lo) * g(hi) > 0:
        raise ValueError("price is outside the range implied by yields in [-50%, 300%]")
    return float(brentq(g, lo, hi, xtol=1e-14, rtol=1e-15, maxiter=500))


@dataclass(frozen=True)
class YieldRisk:
    dirty: float
    clean: float
    accrued: float
    ytm: float
    macaulay: float  # years
    modified: float  # years
    convexity: float  # years^2
    dv01: float  # per 100 face, positive = loss for +1bp
    dollar_duration: float  # D_mod * dirty (per 100 face) -- price change per 1.00 (100%) yield change


def risk_at_yield(cf: CashFlows, y: float) -> YieldRisk:
    t = cf.years
    m = cf.compounding
    dfs = discount_factors_at_yield(t, y, m)
    pv = cf.amounts * dfs
    p = float(pv.sum())
    mac = float(np.dot(t, pv) / p)
    if m is None:
        mod = mac
        conv = float(np.dot(t * t, pv) / p)
    else:
        g = 1.0 + y / m
        mod = mac / g
        conv = float(np.dot(t * (t + 1.0 / m), pv) / (p * g * g))
    return YieldRisk(
        dirty=p,
        clean=p - cf.accrued,
        accrued=cf.accrued,
        ytm=y,
        macaulay=mac,
        modified=mod,
        convexity=conv,
        dv01=mod * p * BP,
        dollar_duration=mod * p,
    )


def analyze_bond_at_yield(bond: FixedRateBond, settlement: date, ytm: float) -> YieldRisk:
    return risk_at_yield(bond_cash_flows(bond, settlement), ytm)


def analyze_bond_at_price(bond: FixedRateBond, settlement: date, clean_price: float) -> YieldRisk:
    cf = bond_cash_flows(bond, settlement)
    y = yield_from_dirty_price(cf, clean_price + cf.accrued)
    return risk_at_yield(cf, y)


def approximation_table(cf: CashFlows, y: float, shocks_bp: list[float]) -> list[dict]:
    """Compare full repricing vs duration and duration+convexity approximations.

    dP/P ~= -D_mod * dy                      (first order)
    dP/P ~= -D_mod * dy + 0.5 * C * dy^2     (second order)
    """
    base = risk_at_yield(cf, y)
    rows = []
    for s in shocks_bp:
        dy = s * BP
        full = dirty_price_at_yield(cf, y + dy)
        ret_full = full / base.dirty - 1.0
        ret_dur = -base.modified * dy
        ret_cvx = ret_dur + 0.5 * base.convexity * dy * dy
        rows.append(
            {
                "shock_bp": s,
                "yield": y + dy,
                "full_price": full,
                "full_return": ret_full,
                "duration_return": ret_dur,
                "convexity_return": ret_cvx,
                "duration_price": base.dirty * (1 + ret_dur),
                "convexity_price": base.dirty * (1 + ret_cvx),
                "duration_error_bp_of_price": (ret_dur - ret_full) * 1e4,
                "convexity_error_bp_of_price": (ret_cvx - ret_full) * 1e4,
            }
        )
    return rows


# --------------------------------------------------------------------------- horizon return

@dataclass(frozen=True)
class HorizonReturn:
    horizon_date: date
    initial_dirty: float
    final_dirty: float
    coupons_received: float
    reinvestment_income: float
    accrued_change: float
    accretion_rolldown: float  # clean price change at constant yield (pull-to-par)
    rate_effect: float  # clean price change from the yield change at the horizon
    total: float
    total_return: float  # decimal, over the horizon (not annualized)


def horizon_return(
    bond: FixedRateBond,
    settlement: date,
    horizon_date: date,
    y0: float,
    y1: float,
    reinvest_rate: float | None = None,
) -> HorizonReturn:
    """Decompose total return per 100 face over [settlement, horizon] into carry and price effects.

    total = coupons + reinvestment + (AI_1 - AI_0) + [clean(h, y0) - clean(0, y0)] + [clean(h, y1) - clean(h, y0)]

    The identity holds exactly. Coupons paid before the horizon are reinvested at
    ``reinvest_rate`` (simple interest, ACT/365F; default = y0) until the horizon.
    """
    if not (settlement < horizon_date < bond.maturity):
        raise ValueError("horizon must fall strictly between settlement and maturity")
    cf0 = bond_cash_flows(bond, settlement)
    r0 = risk_at_yield(cf0, y0)
    cfh = bond_cash_flows(bond, horizon_date)
    ph_y0 = risk_at_yield(cfh, y0)
    ph_y1 = risk_at_yield(cfh, y1)
    rr = y0 if reinvest_rate is None else reinvest_rate
    coupons = 0.0
    reinv = 0.0
    for d, a in zip(cf0.dates, cf0.amounts):
        if settlement < d <= horizon_date:
            coupons += a
            reinv += a * rr * year_fraction_act365(d, horizon_date)
    accrued_change = cfh.accrued - cf0.accrued
    accretion = ph_y0.clean - r0.clean
    rate = ph_y1.clean - ph_y0.clean
    total = coupons + reinv + accrued_change + accretion + rate
    return HorizonReturn(
        horizon_date=horizon_date,
        initial_dirty=r0.dirty,
        final_dirty=ph_y1.dirty,
        coupons_received=coupons,
        reinvestment_income=reinv,
        accrued_change=accrued_change,
        accretion_rolldown=accretion,
        rate_effect=rate,
        total=total,
        total_return=total / r0.dirty,
    )
