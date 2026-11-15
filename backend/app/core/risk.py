"""Curve-based valuation and risk: effective duration/convexity and key-rate durations.

Method (Ho, 1992 key-rate durations, applied to the *par* curve):
* Bump the par yield at one published tenor by +/-1bp, leaving the others
  unchanged. With linear par-yield interpolation the bump is a triangle that
  peaks at that tenor and fades to zero at the neighbouring tenors.
* Re-bootstrap the discount curve and fully reprice every cash flow.
* KRD_k = (P_down - P_up) / (2 * P_0 * 0.0001); KR-DV01_k = (P_down - P_up)/2.
Because the triangular bumps sum to a parallel shift, the KRDs sum (up to
second-order bootstrap effects) to the effective duration for a parallel
shift of the par curve -- this is asserted in the test-suite.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.bond import CashFlows
from app.core.curve import ParCurve, ZeroCurve, bootstrap

BUMP_BP = 1.0


def price_on_curve(cf: CashFlows, zc: ZeroCurve) -> float:
    """Dirty price (per 100) discounting every cash flow on the zero curve."""
    return float(np.dot(cf.amounts, zc.discount(cf.years)))


@dataclass
class CurveSet:
    """Base curve plus the bumped curves needed for effective and key-rate risk."""

    par: ParCurve
    base: ZeroCurve
    up: ZeroCurve
    down: ZeroCurve
    key_up: dict[str, ZeroCurve]
    key_down: dict[str, ZeroCurve]
    bump_bp: float = BUMP_BP

    @classmethod
    def build(cls, par: ParCurve, bump_bp: float = BUMP_BP) -> "CurveSet":
        allbp = {t: bump_bp for t in par.tenors}
        allbm = {t: -bump_bp for t in par.tenors}
        key_up = {t: bootstrap(par.shocked({t: bump_bp})) for t in par.tenors}
        key_down = {t: bootstrap(par.shocked({t: -bump_bp})) for t in par.tenors}
        return cls(
            par=par,
            base=bootstrap(par),
            up=bootstrap(par.shocked(allbp)),
            down=bootstrap(par.shocked(allbm)),
            key_up=key_up,
            key_down=key_down,
            bump_bp=bump_bp,
        )


@dataclass(frozen=True)
class CurveRisk:
    dirty: float
    effective_duration: float
    effective_convexity: float
    dv01: float  # per 100 face, effective (parallel par-curve shift)
    krd: dict[str, float]  # key-rate durations (years)
    kr_dv01: dict[str, float]  # per 100 face


def curve_risk(cf: CashFlows, cs: CurveSet) -> CurveRisk:
    p0 = price_on_curve(cf, cs.base)
    pu = price_on_curve(cf, cs.up)
    pd = price_on_curve(cf, cs.down)
    h = cs.bump_bp * 1e-4
    eff_dur = (pd - pu) / (2 * p0 * h)
    eff_cvx = (pd + pu - 2 * p0) / (p0 * h * h)
    krd, krdv = {}, {}
    for t in cs.par.tenors:
        a = price_on_curve(cf, cs.key_down[t])
        b = price_on_curve(cf, cs.key_up[t])
        krd[t] = (a - b) / (2 * p0 * h)
        krdv[t] = (a - b) / 2 / cs.bump_bp
    return CurveRisk(p0, eff_dur, eff_cvx, (pd - pu) / 2 / cs.bump_bp, krd, krdv)
