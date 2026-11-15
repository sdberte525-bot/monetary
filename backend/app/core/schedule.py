"""Coupon schedule generation.

Schedules are generated *backward from maturity* in steps of 12/frequency
months, which is how U.S. Treasury notes/bonds are scheduled (coupons fall on
the maturity day-of-month). If the maturity date is the last day of its month,
every coupon date is a month-end (end-of-month rule).

Assumption: the schedule is regular -- odd (short/long) first coupons are not
modeled. For seasoned bonds this only affects cash flows before settlement,
which are irrelevant to valuation; the *quasi-coupon* date on or before
settlement is used to compute accrued interest.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta


def is_month_end(d: date) -> bool:
    return d.day == calendar.monthrange(d.year, d.month)[1]


def add_months(d: date, months: int, eom: bool = False) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    last = calendar.monthrange(year, month)[1]
    day = last if eom else min(d.day, last)
    return date(year, month, day)


@dataclass(frozen=True)
class CouponPeriod:
    """The coupon period containing settlement and all remaining payment dates."""

    previous_coupon: date  # quasi-coupon date on or before settlement
    next_coupon: date
    payment_dates: tuple[date, ...]  # strictly after settlement, ascending, ends at maturity


def coupon_schedule(settlement: date, maturity: date, frequency: int) -> CouponPeriod:
    """Return remaining coupon dates after ``settlement`` and the surrounding period.

    A coupon falling exactly on the settlement date belongs to the seller and is
    excluded (accrued interest is then zero).
    """
    if frequency not in (1, 2, 4, 12):
        raise ValueError("frequency must be one of 1, 2, 4, 12")
    if maturity <= settlement:
        raise ValueError("maturity must be after settlement")
    step = 12 // frequency
    eom = is_month_end(maturity)
    dates: list[date] = []
    k = 0
    while True:
        d = add_months(maturity, -step * k, eom=eom)
        if d <= settlement:
            previous = d
            break
        dates.append(d)
        k += 1
        if k > 12 * 200:  # pragma: no cover - guard
            raise RuntimeError("schedule generation runaway")
    dates.reverse()
    return CouponPeriod(previous_coupon=previous, next_coupon=dates[0], payment_dates=tuple(dates))


def add_business_days(d: date, n: int) -> date:
    """Add ``n`` weekdays (U.S. federal holidays are not modeled -- documented assumption)."""
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


def treasury_settlement(trade_date: date) -> date:
    """Regular settlement for U.S. Treasuries is T+1 business day."""
    return add_business_days(trade_date, 1)
