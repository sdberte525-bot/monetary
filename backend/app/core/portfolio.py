"""Portfolio construction, aggregation and scenario repricing.

Valuation assumptions (returned with every result):
* Static positions: holdings are fixed; no trading, rebalancing or carry.
* Every security is a Treasury-style fixed-rate bond (no credit or optionality)
  valued by discounting each cash flow on the bootstrapped Treasury zero curve
  with zero spread. Its YTM is then solved from that model price.
* Scenario shocks are instantaneous and applied to par yields at published
  tenors; the zero curve is re-bootstrapped and all cash flows re-discounted
  (full revaluation). Duration-based approximations are shown alongside, never
  instead of, full revaluation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import numpy as np

from app.core.bond import (
    BP,
    CashFlows,
    FixedRateBond,
    bond_cash_flows,
    risk_at_yield,
    yield_from_dirty_price,
)
from app.core.curve import ParCurve, bootstrap, curve_shape
from app.core.daycount import DayCount
from app.core.risk import CurveSet, curve_risk, price_on_curve

MATURITY_BUCKETS: list[tuple[str, float, float]] = [
    ("0-1y", 0, 1), ("1-3y", 1, 3), ("3-5y", 3, 5), ("5-7y", 5, 7),
    ("7-10y", 7, 10), ("10-20y", 10, 20), ("20-30y", 20, 30.5),
]

# Concentration thresholds (documented, adjustable defaults).
MAX_WEIGHT_WARN = 0.35
MAX_DV01_SHARE_WARN = 0.50

VALUATION_ASSUMPTIONS = [
    "Static positions: no trading, coupon reinvestment, or rebalancing within the analysis.",
    "Securities are Treasury-style fixed-rate bonds valued on the bootstrapped Treasury zero curve with zero spread.",
    "Scenario shocks are instantaneous and applied to published par-yield tenors; the zero curve is re-bootstrapped and all cash flows fully re-discounted.",
    "Key-rate risk uses +/-1bp triangular bumps of the par curve (Ho, 1992).",
    "Settlement-date accrued interest uses ACT/ACT (ICMA) unless a position specifies otherwise.",
]


@dataclass(frozen=True)
class Position:
    id: str
    label: str
    coupon_rate: float  # decimal
    maturity: date
    face_amount: float  # currency units of face
    frequency: int = 2
    day_count: DayCount = DayCount.ACT_ACT_ICMA

    @property
    def bond(self) -> FixedRateBond:
        return FixedRateBond(self.maturity, self.coupon_rate, self.frequency, self.day_count)


@dataclass
class _Priced:
    pos: Position
    cf: CashFlows
    dirty: float
    ytm: float


def _price_positions(positions: list[Position], cs: CurveSet, settlement: date) -> list[_Priced]:
    out = []
    for p in positions:
        if p.maturity <= settlement:
            raise ValueError(f"position {p.label!r} has matured on or before settlement {settlement}")
        if p.face_amount < 0:
            raise ValueError(f"position {p.label!r}: short positions are not supported (face < 0)")
        cf = bond_cash_flows(p.bond, settlement)
        dirty = price_on_curve(cf, cs.base)
        out.append(_Priced(p, cf, dirty, yield_from_dirty_price(cf, dirty)))
    return out


def _years(settlement: date, d: date) -> float:
    return (d - settlement).days / 365.25


def analyze_portfolio(
    positions: list[Position], par: ParCurve, settlement: date, cs: CurveSet | None = None
) -> dict:
    if not positions:
        raise ValueError("portfolio is empty")
    cs = cs or CurveSet.build(par)
    priced = _price_positions(positions, cs, settlement)
    tenors = list(par.tenors)
    rows = []
    agg_cf_years: list[np.ndarray] = []
    agg_cf_amts: list[np.ndarray] = []
    for pr in priced:
        p = pr.pos
        scale = p.face_amount / 100.0
        yr = risk_at_yield(pr.cf, pr.ytm)
        cr = curve_risk(pr.cf, cs)
        mv = pr.dirty * scale
        rows.append(
            {
                "id": p.id,
                "label": p.label,
                "coupon_pct": p.coupon_rate * 100,
                "maturity": p.maturity.isoformat(),
                "years_to_maturity": _years(settlement, p.maturity),
                "face_amount": p.face_amount,
                "frequency": p.frequency,
                "day_count": p.day_count.value,
                "clean_price": pr.dirty - pr.cf.accrued,
                "dirty_price": pr.dirty,
                "accrued_per_100": pr.cf.accrued,
                "accrued_amount": pr.cf.accrued * scale,
                "market_value": mv,
                "ytm_pct": pr.ytm * 100,
                "macaulay_duration": yr.macaulay,
                "modified_duration": yr.modified,
                "effective_duration": cr.effective_duration,
                "convexity": yr.convexity,
                "effective_convexity": cr.effective_convexity,
                "dv01": cr.dv01 * scale,
                "krd": cr.krd,
                "kr_dv01": {t: v * scale for t, v in cr.kr_dv01.items()},
                "next_coupon": pr.cf.next_coupon.isoformat() if pr.cf.next_coupon else None,
            }
        )
        agg_cf_years.append(pr.cf.years)
        agg_cf_amts.append(pr.cf.amounts * scale)

    mv_total = sum(r["market_value"] for r in rows)
    if mv_total <= 0:
        raise ValueError("portfolio market value must be positive")
    dv01_total = sum(r["dv01"] for r in rows)
    for r in rows:
        r["weight"] = r["market_value"] / mv_total
        r["duration_contribution"] = r["weight"] * r["modified_duration"]
        r["dv01_share"] = r["dv01"] / dv01_total if dv01_total else 0.0

    w = np.array([r["weight"] for r in rows])
    mod_dur = float(sum(r["duration_contribution"] for r in rows))
    eff_dur = float(sum(r["weight"] * r["effective_duration"] for r in rows))
    convexity = float(sum(r["weight"] * r["convexity"] for r in rows))
    krd = {t: float(sum(r["weight"] * r["krd"][t] for r in rows)) for t in tenors}
    kr_dv01 = {t: float(sum(r["kr_dv01"][t] for r in rows)) for t in tenors}

    # Portfolio yield, two stated conventions.
    mv_weighted_ytm = float(np.dot(w, [r["ytm_pct"] for r in rows]))
    agg = CashFlows(
        settlement=settlement,
        dates=(),
        amounts=np.concatenate(agg_cf_amts),
        years=np.concatenate(agg_cf_years),
        compounding=2,
    )
    cash_flow_yield = yield_from_dirty_price(agg, mv_total) * 100

    buckets = []
    for name, lo, hi in MATURITY_BUCKETS:
        sel = [r for r in rows if lo <= r["years_to_maturity"] < hi]
        buckets.append(
            {
                "bucket": name,
                "market_value": sum(r["market_value"] for r in sel),
                "weight": sum(r["weight"] for r in sel),
                "dv01": sum(r["dv01"] for r in sel),
                "count": len(sel),
            }
        )

    hhi = float(np.sum(w**2))
    dv01_sh = np.array([r["dv01_share"] for r in rows])
    conc_warnings = []
    if w.max() > MAX_WEIGHT_WARN:
        top = rows[int(w.argmax())]["label"]
        conc_warnings.append(f"{top} is {w.max():.0%} of market value (> {MAX_WEIGHT_WARN:.0%} threshold).")
    if dv01_sh.max() > MAX_DV01_SHARE_WARN and len(rows) > 1:
        top = rows[int(dv01_sh.argmax())]["label"]
        conc_warnings.append(f"{top} contributes {dv01_sh.max():.0%} of portfolio DV01 (> {MAX_DV01_SHARE_WARN:.0%}).")

    return {
        "settlement": settlement.isoformat(),
        "curve_as_of": par.as_of,
        "summary": {
            "market_value": mv_total,
            "face_amount": sum(p.face_amount for p in positions),
            "accrued_interest": sum(r["accrued_amount"] for r in rows),
            "modified_duration": mod_dur,
            "effective_duration": eff_dur,
            "convexity": convexity,
            "dv01": dv01_total,
            "mv_weighted_ytm_pct": mv_weighted_ytm,
            "cash_flow_yield_pct": cash_flow_yield,
            "positions": len(rows),
            "weighted_avg_maturity": float(np.dot(w, [r["years_to_maturity"] for r in rows])),
        },
        "key_rate_durations": krd,
        "key_rate_dv01": kr_dv01,
        "holdings": rows,
        "maturity_buckets": buckets,
        "concentration": {
            "hhi": hhi,
            "effective_positions": 1.0 / hhi,
            "max_weight": float(w.max()),
            "top3_weight": float(np.sort(w)[::-1][:3].sum()),
            "max_dv01_share": float(dv01_sh.max()),
            "dv01_hhi": float(np.sum(dv01_sh**2)),
            "warnings": conc_warnings,
            "thresholds": {"max_weight": MAX_WEIGHT_WARN, "max_dv01_share": MAX_DV01_SHARE_WARN},
        },
        "conventions": {
            "duration": "Modified duration is w.r.t. each bond's own YTM (street convention); effective duration is w.r.t. a parallel +/-1bp par-curve shift.",
            "dv01": "Positive DV01 = dollar loss for a +1bp parallel par-curve shift (effective, full revaluation).",
            "portfolio_yield": "mv_weighted_ytm: market-value-weighted average YTM (an approximation). cash_flow_yield: IRR of aggregated cash flows vs. total dirty market value, semiannual bond-equivalent basis.",
            "weights": "Weights use dirty market value (price + accrued).",
        },
        "assumptions": VALUATION_ASSUMPTIONS,
        "curve_warnings": cs.base.warnings,
    }


@dataclass
class ScenarioResult:
    base: dict
    shocked: dict
    shocks_bp: dict[str, float]
    pnl: list[dict] = field(default_factory=list)
    totals: dict = field(default_factory=dict)


def run_scenario(
    positions: list[Position], par: ParCurve, shocks_bp: dict[str, float], settlement: date
) -> dict:
    """Instantaneous scenario: full revaluation plus first/second-order approximations."""
    unknown = set(shocks_bp) - set(par.tenors)
    shocks = {t: float(shocks_bp.get(t, 0.0)) for t in par.tenors}
    shocked_par = par.shocked(shocks)
    cs_base = CurveSet.build(par)
    cs_shock = CurveSet.build(shocked_par)
    base = analyze_portfolio(positions, par, settlement, cs_base)
    after = analyze_portfolio(positions, shocked_par, settlement, cs_shock)
    zc_shock = bootstrap(shocked_par)

    pnl = []
    for b, a, pos in zip(base["holdings"], after["holdings"], positions):
        full = a["market_value"] - b["market_value"]
        # First order: key-rate DV01s x tenor shocks (dollar DV01 is per +1bp, loss-positive).
        krd_approx = -sum(b["kr_dv01"][t] * shocks[t] for t in par.tenors)
        # Effective yield change seen by the bond = KRD-weighted average of the tenor shocks.
        krd_sum = sum(b["krd"].values())
        dy_eff_bp = sum(b["krd"][t] * shocks[t] for t in par.tenors) / krd_sum if krd_sum else 0.0
        cvx_adj = 0.5 * b["effective_convexity"] * (dy_eff_bp * BP) ** 2 * b["market_value"]
        pnl.append(
            {
                "id": b["id"],
                "label": b["label"],
                "market_value_before": b["market_value"],
                "market_value_after": a["market_value"],
                "pnl_full": full,
                "return_full": full / b["market_value"],
                "pnl_krd_approx": krd_approx,
                "pnl_krd_convexity_approx": krd_approx + cvx_adj,
                "effective_yield_change_bp": dy_eff_bp,
                "ytm_change_bp": (a["ytm_pct"] - b["ytm_pct"]) * 100,
                "price_before": b["clean_price"],
                "price_after": a["clean_price"],
                "duration_before": b["modified_duration"],
                "duration_after": a["modified_duration"],
            }
        )
    total = sum(r["pnl_full"] for r in pnl)
    for r in pnl:
        r["share_of_pnl"] = r["pnl_full"] / total if abs(total) > 1e-9 else 0.0
    zero_t = np.array([0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30])
    return {
        "shocks_bp": shocks,
        "ignored_shock_tenors": sorted(unknown),
        "base_curve_pct": par.to_percent(),
        "shocked_curve_pct": shocked_par.to_percent(),
        "base_zero_pct": {f"{t:g}": float(v * 100) for t, v in zip(zero_t, cs_base.base.zero_rate(zero_t))},
        "shocked_zero_pct": {f"{t:g}": float(v * 100) for t, v in zip(zero_t, zc_shock.zero_rate(zero_t))},
        "base": base,
        "shocked": after,
        "pnl": pnl,
        "totals": {
            "pnl_full": total,
            "return_full": total / base["summary"]["market_value"],
            "pnl_krd_approx": sum(r["pnl_krd_approx"] for r in pnl),
            "pnl_krd_convexity_approx": sum(r["pnl_krd_convexity_approx"] for r in pnl),
            "duration_change": after["summary"]["modified_duration"] - base["summary"]["modified_duration"],
            "dv01_change": after["summary"]["dv01"] - base["summary"]["dv01"],
            "krd_change": {
                t: after["key_rate_durations"][t] - base["key_rate_durations"][t] for t in par.tenors
            },
            # First-order P&L attribution by key rate: -KR-DV01_t x shock_t (sums to pnl_krd_approx).
            "pnl_by_key_rate": {t: -base["key_rate_dv01"][t] * shocks[t] for t in par.tenors},
        },
        "curve_shape_before": curve_shape(par.to_percent()),
        "curve_shape_after": curve_shape(shocked_par.to_percent()),
        "assumptions": VALUATION_ASSUMPTIONS,
    }


# --------------------------------------------------------------------------- sample portfolios

def _rounded_coupon(par_yield: float) -> float:
    """Round a par yield to the nearest 1/8 of a percent (Treasury coupon increment)."""
    return round(par_yield * 100 * 8) / 8 / 100


def _bond_at(settlement: date, years: int, par: ParCurve, face: float, label: str | None = None) -> Position:
    from app.core.schedule import add_months

    mat = add_months(settlement, 12 * years)
    zc = bootstrap(par)
    cpn = _rounded_coupon(zc.par_yield(years))
    return Position(
        id=f"UST-{years}Y",
        label=label or f"UST {cpn*100:.3f}% {mat:%b-%Y} ({years}Y)",
        coupon_rate=cpn,
        maturity=mat,
        face_amount=face,
    )


SAMPLE_PORTFOLIOS = {
    "short": "Short-duration Treasury",
    "intermediate": "Intermediate Treasury",
    "long": "Long-duration Treasury",
    "bullet": "Bullet (10Y)",
    "barbell": "Barbell (2Y / 30Y, duration-matched to bullet)",
    "ladder": "Laddered Treasury (1Y-10Y)",
}


def sample_portfolio(name: str, par: ParCurve, settlement: date, notional: float = 100_000_000) -> list[Position]:
    """Hypothetical Treasury-style portfolios. Coupons = curve par yield rounded to 1/8%.

    The bonds are *illustrative constructs* issued 'today' at each tenor, not
    actual CUSIPs; they trade near par by construction.
    """
    b = lambda y, f: _bond_at(settlement, y, par, f)  # noqa: E731
    if name == "short":
        return [b(1, 0.3 * notional), b(2, 0.4 * notional), b(3, 0.3 * notional)]
    if name == "intermediate":
        return [b(3, 0.2 * notional), b(5, 0.3 * notional), b(7, 0.3 * notional), b(10, 0.2 * notional)]
    if name == "long":
        return [b(10, 0.3 * notional), b(20, 0.3 * notional), b(30, 0.4 * notional)]
    if name == "bullet":
        return [b(10, notional)]
    if name == "ladder":
        return [b(y, notional / 10) for y in range(1, 11)]
    if name == "barbell":
        # Solve weights w2 + w30 = 1 so that MV-weighted modified duration equals the 10Y bullet.
        bullet = analyze_portfolio([b(10, notional)], par, settlement)
        d_target = bullet["summary"]["modified_duration"]
        trial = analyze_portfolio([b(2, notional), b(30, notional)], par, settlement)
        d2, d30 = (h["modified_duration"] for h in trial["holdings"])
        p2, p30 = (h["dirty_price"] for h in trial["holdings"])
        w30 = (d_target - d2) / (d30 - d2)
        w2 = 1 - w30
        mv = bullet["summary"]["market_value"]
        return [b(2, w2 * mv / p2 * 100), b(30, w30 * mv / p30 * 100)]
    raise KeyError(f"unknown sample portfolio {name!r}")
