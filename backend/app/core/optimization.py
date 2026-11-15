"""Portfolio optimization laboratory (risk-targeting, not return forecasting).

Decision variables: market-value weights w_i over a candidate universe.
All objectives are *risk-shape* objectives. None of them maximizes expected
return: doing so would require an explicit expected-return model, which this
application deliberately does not invent. The optional ``max_yield`` objective
maximizes the market-value-weighted yield to maturity -- yield is NOT expected
return (it ignores curve changes, roll-down and reinvestment), and the result
is labeled accordingly.

Solver: scipy.optimize.minimize(method="SLSQP"). Feasibility of the linear
constraint set is checked first with scipy.optimize.linprog (HiGHS), so an
infeasible specification is reported as such instead of as a solver failure.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
from scipy.optimize import linprog, minimize

from app.core.curve import ParCurve
from app.core.portfolio import MATURITY_BUCKETS, Position, _bond_at, analyze_portfolio
from app.core.risk import CurveSet

DEFAULT_UNIVERSE_YEARS = [1, 2, 3, 5, 7, 10, 20, 30]
RIDGE = 1e-4  # disclosed regularization used where the objective alone is not strictly convex


@dataclass
class Universe:
    positions: list[Position]
    labels: list[str]
    mod_dur: np.ndarray
    convexity: np.ndarray
    ytm: np.ndarray  # percent
    dirty: np.ndarray
    krd: np.ndarray  # (n, k)
    tenors: list[str]
    years_to_maturity: np.ndarray


def build_universe(par: ParCurve, settlement: date, years: list[int] | None = None,
                   positions: list[Position] | None = None) -> Universe:
    if positions is None:
        years = years or DEFAULT_UNIVERSE_YEARS
        positions = [_bond_at(settlement, y, par, 1_000_000) for y in years]
    cs = CurveSet.build(par)
    a = analyze_portfolio(positions, par, settlement, cs)
    h = a["holdings"]
    tenors = list(par.tenors)
    return Universe(
        positions=positions,
        labels=[r["label"] for r in h],
        mod_dur=np.array([r["modified_duration"] for r in h]),
        convexity=np.array([r["convexity"] for r in h]),
        ytm=np.array([r["ytm_pct"] for r in h]),
        dirty=np.array([r["dirty_price"] for r in h]),
        krd=np.array([[r["krd"][t] for t in tenors] for r in h]),
        tenors=tenors,
        years_to_maturity=np.array([r["years_to_maturity"] for r in h]),
    )


def _constraints(u: Universe, target_duration: float | None, max_bucket_weight: float | None):
    """Return (A_eq, b_eq, A_ub, b_ub, descriptions)."""
    n = len(u.positions)
    a_eq, b_eq, a_ub, b_ub, desc = [np.ones(n)], [1.0], [], [], ["sum(w) = 1 (fully invested)"]
    if target_duration is not None:
        a_eq.append(u.mod_dur)
        b_eq.append(target_duration)
        desc.append(f"sum(w_i * Dmod_i) = {target_duration:.3f} (duration target)")
    if max_bucket_weight is not None and max_bucket_weight < 1:
        for name, lo, hi in MATURITY_BUCKETS:
            sel = ((u.years_to_maturity >= lo) & (u.years_to_maturity < hi)).astype(float)
            if sel.sum() > 0:
                a_ub.append(sel)
                b_ub.append(max_bucket_weight)
        desc.append(f"sum of weights in each maturity bucket <= {max_bucket_weight:.0%}")
    return np.array(a_eq), np.array(b_eq), (np.array(a_ub) if a_ub else None), (np.array(b_ub) if b_ub else None), desc


def optimize(
    u: Universe,
    objective: str,
    capital: float,
    target_duration: float | None = None,
    max_weight: float = 1.0,
    long_only: bool = True,
    max_bucket_weight: float | None = None,
    target_krd: dict[str, float] | None = None,
    krd_weights: dict[str, float] | None = None,
) -> dict:
    n = len(u.positions)
    if capital <= 0:
        raise ValueError("capital must be positive")
    if not 0 < max_weight <= 1:
        raise ValueError("max_weight must be in (0, 1]")
    lo = 0.0 if long_only else -max_weight
    bounds = [(lo, max_weight)] * n
    a_eq, b_eq, a_ub, b_ub, cdesc = _constraints(u, target_duration, max_bucket_weight)
    cdesc.append(f"{lo:.0%} <= w_i <= {max_weight:.0%} per security" + (" (long-only)" if long_only else ""))

    feas = linprog(np.zeros(n), A_ub=a_ub, b_ub=b_ub, A_eq=a_eq, b_eq=b_eq, bounds=bounds, method="highs")
    base = {
        "objective": objective,
        "constraints": cdesc,
        "inputs": {
            "universe": u.labels,
            "modified_duration": u.mod_dur.tolist(),
            "ytm_pct": u.ytm.tolist(),
            "capital": capital,
            "target_duration": target_duration,
            "max_weight": max_weight,
            "long_only": long_only,
            "max_bucket_weight": max_bucket_weight,
        },
    }
    if feas.status != 0:
        dmin, dmax = float(u.mod_dur.min()), float(u.mod_dur.max())
        return {
            **base,
            "status": "infeasible",
            "solver_message": f"Linear feasibility check failed: {feas.message}",
            "hint": f"Universe durations span {dmin:.2f}-{dmax:.2f}y; with the weight limits the target may be unreachable.",
        }

    k = u.krd  # (n, K)
    tenors = u.tenors
    if objective == "min_concentration":
        if target_duration is None:
            raise ValueError("min_concentration requires a target duration")
        fun = lambda w: float(w @ w)  # noqa: E731
        jac = lambda w: 2 * w  # noqa: E731
        formula = "minimize sum(w_i^2)  (Herfindahl index of market-value weights)"
    elif objective in ("match_krd", "risk_target"):
        if not target_krd:
            raise ValueError(f"{objective} requires target key-rate durations")
        tgt = np.array([target_krd.get(t, 0.0) for t in tenors])
        om = np.array([(krd_weights or {}).get(t, 1.0) for t in tenors])

        def fun(w):
            e = w @ k - tgt
            return float(np.sum(om * e * e) + RIDGE * w @ w)

        def jac(w):
            e = w @ k - tgt
            return 2 * k @ (om * e) + 2 * RIDGE * w

        formula = (
            "minimize sum_k omega_k (KRD_p,k - KRD_target,k)^2 + "
            f"{RIDGE:g} * sum(w_i^2)   [ridge term disclosed: selects the least-concentrated solution among near-ties]"
        )
    elif objective == "max_yield":
        fun = lambda w: float(-(w @ u.ytm) + RIDGE * w @ w)  # noqa: E731
        jac = lambda w: -u.ytm + 2 * RIDGE * w  # noqa: E731
        formula = (
            f"maximize sum(w_i * YTM_i) - {RIDGE:g} * sum(w_i^2).  NOTE: yield-to-maturity is not expected return; "
            "this is not a risk-adjusted return optimization."
        )
    else:
        raise ValueError(f"unknown objective {objective!r}")

    cons = [{"type": "eq", "fun": (lambda w, a=a, b=b: a @ w - b), "jac": (lambda w, a=a: a)} for a, b in zip(a_eq, b_eq)]
    if a_ub is not None:
        cons += [{"type": "ineq", "fun": (lambda w, a=a, b=b: b - a @ w), "jac": (lambda w, a=a: -a)} for a, b in zip(a_ub, b_ub)]
    x0 = np.clip(np.asarray(feas.x, dtype=float), lo, max_weight)
    res = minimize(fun, x0, jac=jac, bounds=bounds, constraints=cons, method="SLSQP",
                   options={"ftol": 1e-12, "maxiter": 1000})
    w = np.where(np.abs(res.x) < 1e-8, 0.0, res.x)
    eq_resid = (a_eq @ w - b_eq).tolist()
    ub_resid = (a_ub @ w - b_ub).tolist() if a_ub is not None else []
    face = w * capital / (u.dirty / 100.0)
    allocations = [
        {"label": lab, "weight": float(wi), "market_value": float(wi * capital), "face_amount": float(fi),
         "modified_duration": float(d), "ytm_pct": float(y)}
        for lab, wi, fi, d, y in zip(u.labels, w, face, u.mod_dur, u.ytm)
    ]
    port_krd = (w @ k).tolist()
    return {
        **base,
        "status": "optimal" if res.success else "solver_failed",
        "solver": {"method": "SLSQP", "success": bool(res.success), "message": str(res.message),
                   "iterations": int(res.nit), "objective_value": float(res.fun)},
        "objective_formula": formula,
        "constraint_residuals": {"equality": eq_resid, "inequality_slack_violation": [max(0.0, r) for r in ub_resid]},
        "allocations": allocations,
        "portfolio": {
            "modified_duration": float(w @ u.mod_dur),
            "convexity": float(w @ u.convexity),
            "mv_weighted_ytm_pct": float(w @ u.ytm),
            "hhi": float(w @ w),
            "krd": dict(zip(tenors, port_krd)),
            "target_krd": target_krd,
        },
        "positions": [
            {"id": p.id, "label": p.label, "coupon_pct": p.coupon_rate * 100, "maturity": p.maturity.isoformat(),
             "face_amount": float(f)}
            for p, f in zip(u.positions, face) if abs(f) > 1e-6
        ],
        "assumptions": [
            "Weights are market-value weights; risk measures are linear in weights (static, instantaneous).",
            "Candidate bonds are hypothetical Treasury-style par bonds at each tenor (coupon = par yield rounded to 1/8%) unless user holdings are supplied.",
            "No transaction costs, bid-ask spreads, financing, or expected-return model.",
        ],
    }


def barbell_vs_bullet(par: ParCurve, settlement: date, target_years: int = 10, short_years: int = 2,
                      long_years: int = 30, notional: float = 100_000_000) -> dict:
    """Duration-matched barbell vs bullet comparison (weights solved analytically)."""
    bullet = [_bond_at(settlement, target_years, par, notional)]
    ab = analyze_portfolio(bullet, par, settlement)
    d_t = ab["summary"]["modified_duration"]
    mv = ab["summary"]["market_value"]
    trial = analyze_portfolio([_bond_at(settlement, short_years, par, 1e6), _bond_at(settlement, long_years, par, 1e6)], par, settlement)
    ds, dl = (h["modified_duration"] for h in trial["holdings"])
    ps, pl = (h["dirty_price"] for h in trial["holdings"])
    if not (ds < d_t < dl):
        raise ValueError("bullet duration must lie between the barbell wings' durations")
    wl = (d_t - ds) / (dl - ds)
    ws = 1 - wl
    barbell = [_bond_at(settlement, short_years, par, ws * mv / ps * 100), _bond_at(settlement, long_years, par, wl * mv / pl * 100)]
    return {"bullet": bullet, "barbell": barbell, "weights": {"short": ws, "long": wl}, "target_duration": d_t}
