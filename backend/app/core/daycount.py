"""Day-count conventions.

All functions take ``datetime.date`` objects and are pure/deterministic.

Supported conventions
---------------------
ACT/ACT-ICMA  U.S. Treasury notes & bonds. Accrual fraction of a coupon period
              is (actual days since last coupon) / (actual days in the period).
30/360        U.S. (bond basis / SIFMA) - corporate & agency bonds.
ACT/360       money-market convention.
ACT/365F      fixed 365-day year; used for continuous-time cash-flow timing.
"""
from __future__ import annotations

from datetime import date
from enum import Enum


class DayCount(str, Enum):
    ACT_ACT_ICMA = "ACT/ACT-ICMA"
    THIRTY_360 = "30/360"
    ACT_360 = "ACT/360"
    ACT_365F = "ACT/365F"


def days_30_360_us(d1: date, d2: date) -> int:
    """30/360 US (Bond Basis) day count, per SIFMA / ISDA 2006 4.16(f)."""
    y1, m1, dd1 = d1.year, d1.month, d1.day
    y2, m2, dd2 = d2.year, d2.month, d2.day
    if dd1 == 31:
        dd1 = 30
    if dd2 == 31 and dd1 >= 30:
        dd2 = 30
    return 360 * (y2 - y1) + 30 * (m2 - m1) + (dd2 - dd1)


def accrual_fraction(
    convention: DayCount, period_start: date, period_end: date, accrual_end: date, frequency: int
) -> float:
    """Fraction of the coupon *period* elapsed between ``period_start`` and ``accrual_end``.

    Accrued interest = (annual coupon / frequency) * accrual_fraction.
    For ACT/360 and ACT/365F the fraction is expressed relative to a nominal
    period of (year basis / frequency) days, so a full period can differ
    slightly from 1.0 -- that is the defining property of those conventions.
    """
    if not (period_start <= accrual_end <= period_end):
        raise ValueError("accrual_end must lie within the coupon period")
    if frequency <= 0:
        raise ValueError("frequency must be positive")
    if convention == DayCount.ACT_ACT_ICMA:
        return (accrual_end - period_start).days / (period_end - period_start).days
    if convention == DayCount.THIRTY_360:
        num = days_30_360_us(period_start, accrual_end)
        den = days_30_360_us(period_start, period_end)
        return num / den if den else 0.0
    if convention == DayCount.ACT_360:
        return (accrual_end - period_start).days * frequency / 360.0
    if convention == DayCount.ACT_365F:
        return (accrual_end - period_start).days * frequency / 365.0
    raise ValueError(f"unsupported day count {convention}")


def year_fraction_act365(d1: date, d2: date) -> float:
    return (d2 - d1).days / 365.0
