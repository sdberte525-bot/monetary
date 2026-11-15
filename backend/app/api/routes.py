"""FastAPI routers. Every response that depends on market data carries provenance."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query, Response

from app.api import schemas as S
from app.api.deps import market_context, policy_translation, resolve_curve, settlement_for, to_positions
from app.core import macro, scenarios
from app.core.bond import (
    FixedRateBond,
    approximation_table,
    bond_cash_flows,
    custom_cash_flows,
    dirty_price_at_yield,
    horizon_return,
    risk_at_yield,
    yield_from_dirty_price,
)
from app.core.curve import ZeroCurve, bootstrap, curve_shape
from app.core.daycount import DayCount
from app.core.historical import apply_to_portfolios, observed_changes
from app.core.narrative import risk_observations, scenario_commentary
from app.core.optimization import barbell_vs_bullet, build_universe, optimize
from app.core.policy import (
    DEFAULT_PASS_THROUGH,
    INTERPRETATIONS,
    PATH_LOADING,
    POLICY_PRESETS_BP,
    TERM_PREMIUM_LOADING,
    TRANSMISSION_PROFILES,
)
from app.core.portfolio import SAMPLE_PORTFOLIOS, analyze_portfolio, run_scenario, sample_portfolio
from app.core.report import build_brief, render_pdf
from app.core.risk import price_on_curve
from app.data.events import EVENTS_BY_ID, HISTORICAL_EVENTS
from app.data.sources import FRED_SERIES_META, TENOR_YEARS, TENORS
from app.data.store import get_store

router = APIRouter(prefix="/api")


def _clean(o):
    """Recursively convert numpy / NaN values to JSON-safe Python types."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if (np.isnan(f) or np.isinf(f)) else f
    if isinstance(o, np.integer):
        return int(o)
    return o


# ============================================================== data / market

@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/data/status")
def data_status():
    st = get_store()
    st.curve_frame  # trigger refresh policy
    return _clean(st.status())


@router.post("/data/refresh")
def data_refresh():
    """Force a refresh from official sources (no-op in snapshot mode)."""
    st = get_store()
    if st.cfg.data_mode == "snapshot":
        return {"refreshed": False, "reason": "MONETARY_DATA_MODE=snapshot"}
    st.refresh_curve(force=True)
    for sid in FRED_SERIES_META:
        st.refresh_series(sid, force=True)
    return _clean(st.status())


def _curve_payload(st, d: date) -> dict:
    par, as_of = st.curve_on(d)
    zc = bootstrap(par)
    zt = np.array([TENOR_YEARS[t] for t in TENORS])
    fwd_t = np.arange(0.5, 30.01, 0.5)
    return {
        "as_of": as_of.isoformat(),
        "par_pct": {t: st.curve_row_pct(as_of)[t] for t in TENORS},
        "zero_pct": {t: float(v * 100) for t, v in zip(TENORS, zc.zero_rate(zt))},
        "discount_factors": {t: float(v) for t, v in zip(TENORS, zc.discount(zt))},
        "zero_curve_dense": [
            {"years": float(t), "zero_pct": float(z * 100), "par_pct": float(par.par_yield(t) * 100),
             "forward_6m_pct": float(f * 100)}
            for t, z, f in zip(fwd_t, zc.zero_rate(fwd_t), zc.forward_rate(fwd_t - 0.5, fwd_t))
        ],
        "shape": curve_shape(st.curve_row_pct(as_of)),
        "warnings": zc.warnings,
    }


@router.get("/market/overview")
def market_overview():
    st = get_store()
    latest = st.resolve_curve_date(None)
    cur = _curve_payload(st, latest)
    comps = {}
    for label, delta in (("1W", 7), ("1M", 30), ("3M", 91), ("1Y", 365)):
        d = st.resolve_curve_date(latest - timedelta(days=delta))
        prev = st.curve_row_pct(d)
        comps[label] = {
            "date": d.isoformat(),
            "par_pct": prev,
            "change_bp": {t: (None if prev[t] is None or cur["par_pct"][t] is None
                              else round((cur["par_pct"][t] - prev[t]) * 100, 2)) for t in TENORS},
        }
    pr = st.policy_range_on(None)
    effr, effr_d = st.value_on("DFF")
    return _clean({
        "curve": cur,
        "comparisons": comps,
        "policy": pr,
        "effr": {"value": effr, "as_of": effr_d.isoformat(), "series": "DFF"},
        "provenance": {"treasury": st.curve_provenance.to_dict(),
                       "policy": st.series_provenance("DFEDTARU").to_dict(),
                       "effr": st.series_provenance("DFF").to_dict()},
    })


@router.get("/curve")
def get_curve(date_: date | None = Query(None, alias="date")):
    st = get_store()
    d = st.resolve_curve_date(date_)
    return _clean({**_curve_payload(st, d), "requested": date_.isoformat() if date_ else None,
                   "provenance": st.curve_provenance.to_dict()})


@router.get("/curve/compare")
def compare_curves(date1: date, date2: date):
    st = get_store()
    a = _curve_payload(st, st.resolve_curve_date(date1))
    b = _curve_payload(st, st.resolve_curve_date(date2))
    ch = {t: (None if a["par_pct"][t] is None or b["par_pct"][t] is None
              else round((b["par_pct"][t] - a["par_pct"][t]) * 100, 2)) for t in TENORS}
    shocks = {t: v for t, v in ch.items() if v is not None}
    return _clean({"a": a, "b": b, "change_bp": ch,
                   "move_classification": scenarios.classify_move(shocks) if shocks else None,
                   "provenance": st.curve_provenance.to_dict()})


@router.get("/curve/history")
def curve_history(
    tenors: str = "2Y,10Y",
    start: date | None = None,
    end: date | None = None,
    freq: str = Query("auto", pattern="^(auto|D|W|M)$"),
):
    st = get_store()
    tl = [t.strip() for t in tenors.split(",") if t.strip()]
    df = st.curve_history(start, end, tl)
    if freq == "auto":
        span = (df.index.max() - df.index.min()).days if len(df) else 0
        freq = "D" if span <= 3 * 365 else ("W" if span <= 12 * 365 else "M")
    if freq != "D":
        # last available observation in each period (no averaging across missing tenors, no look-ahead)
        df = df.resample("W-FRI" if freq == "W" else "ME").last().dropna(how="all")
    rows = [{"date": ix.strftime("%Y-%m-%d"), **{c: (None if pd.isna(v) else float(v)) for c, v in r.items()}}
            for ix, r in df.iterrows()]
    if "2Y" in tl and "10Y" in tl:
        for r in rows:
            r["2s10s_bp"] = None if r["2Y"] is None or r["10Y"] is None else round((r["10Y"] - r["2Y"]) * 100, 2)
    return _clean({"tenors": tl, "frequency": freq, "rows": rows, "provenance": st.curve_provenance.to_dict()})


@router.get("/curve/dates")
def curve_dates():
    a, b = get_store().curve_dates()
    return {"first": a.isoformat(), "last": b.isoformat()}


@router.post("/curve/spot")
def spot_curve(req: S.SpotCurveRequest):
    comp = None if req.compounding == "continuous" else int(req.compounding)
    zc = ZeroCurve.from_spot_rates(req.years, [r / 100 for r in req.rates_pct], comp)
    t = np.arange(0.5, max(req.years) + 1e-9, 0.5)
    return _clean({
        "source": "user-supplied spot rates",
        "points": [{"years": float(x), "discount_factor": float(d), "zero_pct_sa": float(z * 100),
                    "par_pct_sa": float(zc.par_yield(x) * 100) if x >= 0.5 else None}
                   for x, d, z in zip(t, zc.discount(t), zc.zero_rate(t))],
    })


# ============================================================== scenarios

@router.get("/scenarios/presets")
def scenario_presets():
    return {"presets": scenarios.SHAPE_PRESETS, "definitions": scenarios.SHAPE_DEFINITIONS, "tenors": TENORS}


@router.post("/scenarios/shape")
def scenario_shape(req: S.ShapeRequest):
    if req.kind == "parallel":
        sh = scenarios.parallel(req.bp)
    elif req.kind == "preset":
        sh = scenarios.preset(req.preset or "", req.scale)
    elif req.kind == "anchors":
        sh = scenarios.from_anchors(dict(req.anchors or {}))
    else:
        sh = {t: float((req.custom or {}).get(t, 0.0)) for t in TENORS}
    return {"shocks_bp": sh, "classification": scenarios.classify_move(sh)}


# ============================================================== bonds

def _bond(req) -> FixedRateBond:
    return FixedRateBond(req.maturity, req.coupon_pct / 100, req.frequency, DayCount(req.day_count))


@router.post("/bond/analyze")
def bond_analyze(req: S.BondRequest):
    bond = _bond(req)
    cf = bond_cash_flows(bond, req.settlement)
    prov = None
    if req.mode == "yield":
        y = req.ytm_pct / 100
    elif req.mode == "price":
        y = yield_from_dirty_price(cf, req.clean_price + cf.accrued)
    else:
        st = get_store()
        par, as_of, prov = resolve_curve(st, req.curve)
        y = yield_from_dirty_price(cf, price_on_curve(cf, bootstrap(par)))
        prov = {**prov, "curve_as_of": as_of.isoformat()}
    r = risk_at_yield(cf, y)
    scale = req.face_amount / 100
    grid = np.linspace(max(-0.02, y - 0.04), y + 0.04, 81)
    pv_curve = []
    for g in grid:
        dy = g - y
        p = dirty_price_at_yield(cf, g)
        pv_curve.append({
            "ytm_pct": g * 100, "price": p - cf.accrued, "dirty": p,
            "duration_approx": r.dirty * (1 - r.modified * dy) - cf.accrued,
            "convexity_approx": r.dirty * (1 - r.modified * dy + 0.5 * r.convexity * dy * dy) - cf.accrued,
        })
    # Sensitivity to maturity for a bond with the same coupon and yield
    profile = []
    for yrs in [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 25, 30]:
        mat = req.settlement + timedelta(days=round(yrs * 365.25))
        b2 = FixedRateBond(mat, bond.coupon_rate, bond.frequency, bond.day_count)
        r2 = risk_at_yield(bond_cash_flows(b2, req.settlement), y)
        profile.append({"years": yrs, "modified_duration": r2.modified, "macaulay_duration": r2.macaulay,
                        "convexity": r2.convexity, "dv01_per_100": r2.dv01})
    flows = [
        {"date": d.isoformat(), "years": float(t), "amount_per_100": float(a), "amount": float(a * scale),
         "discount_factor": float(df), "pv_per_100": float(a * df), "pv_share": float(a * df / r.dirty)}
        for d, t, a, df in zip(cf.dates, cf.years, cf.amounts, (1 + y / bond.frequency) ** (-bond.frequency * cf.years))
    ]
    return _clean({
        "inputs": req.model_dump(mode="json"),
        "analytics": {
            "clean_price": r.clean, "dirty_price": r.dirty, "accrued_per_100": r.accrued,
            "accrual_fraction": cf.accrual_fraction,
            "previous_coupon": cf.previous_coupon.isoformat(), "next_coupon": cf.next_coupon.isoformat(),
            "ytm_pct": y * 100, "macaulay_duration": r.macaulay, "modified_duration": r.modified,
            "convexity": r.convexity, "dv01_per_100": r.dv01, "dv01": r.dv01 * scale,
            "dollar_duration": r.dollar_duration * scale, "market_value": r.dirty * scale,
            "accrued_amount": r.accrued * scale,
            "effective_duration_100bp": (dirty_price_at_yield(cf, y - 0.01) - dirty_price_at_yield(cf, y + 0.01)) / (2 * r.dirty * 0.01),
        },
        "cash_flows": flows,
        "approximations": approximation_table(cf, y, req.shocks_bp),
        "price_yield_curve": pv_curve,
        "maturity_profile": profile,
        "curve_provenance": prov,
        "conventions": [
            "Yield: street convention, compounding at coupon frequency, fractional first period (ACT/ACT ICMA period fraction).",
            "Price per 100 face. DV01 = Dmod x dirty price x 0.0001 (positive = loss for +1bp).",
            "Effective duration here = central difference of full repricing for +/-100bp yield shifts.",
        ],
    })


@router.post("/bond/horizon")
def bond_horizon(req: S.HorizonRequest):
    hr = horizon_return(_bond(req), req.settlement, req.horizon_date, req.ytm_start_pct / 100,
                        req.ytm_end_pct / 100, None if req.reinvest_pct is None else req.reinvest_pct / 100)
    return _clean({**hr.__dict__, "horizon_date": hr.horizon_date.isoformat(),
                   "identity": "total = coupons + reinvestment + accrued change + accretion/roll-down + rate effect"})


@router.post("/bond/custom")
def bond_custom(req: S.CustomCashFlowRequest):
    comp = None if req.compounding == "continuous" else int(req.compounding)
    cf = custom_cash_flows(req.settlement, [f.date for f in req.flows], [f.amount for f in req.flows], comp)
    if req.mode == "yield":
        if req.ytm_pct is None:
            raise ValueError("ytm_pct required")
        y = req.ytm_pct / 100
    elif req.mode == "price":
        if req.price is None:
            raise ValueError("price required")
        y = yield_from_dirty_price(cf, req.price)
    else:
        par, _, _ = resolve_curve(get_store(), req.curve)
        y = yield_from_dirty_price(cf, price_on_curve(cf, bootstrap(par)))
    r = risk_at_yield(cf, y)
    return _clean({"price": r.dirty, "ytm_pct": y * 100, "macaulay_duration": r.macaulay,
                   "modified_duration": r.modified, "convexity": r.convexity, "dv01": r.dv01,
                   "approximations": approximation_table(cf, y, [-100, -50, 50, 100]),
                   "convention": "Times ACT/365F from settlement; price = sum(CF x DF(y)); flows on/before settlement excluded."})


# ============================================================== portfolios

@router.get("/portfolio/samples")
def portfolio_samples(date_: date | None = Query(None, alias="date")):
    st = get_store()
    par, as_of = st.curve_on(date_)
    settle = settlement_for(as_of, None)
    out = {}
    for key, name in SAMPLE_PORTFOLIOS.items():
        out[key] = {
            "name": name,
            "positions": [
                {"id": p.id, "label": p.label, "coupon_pct": round(p.coupon_rate * 100, 4),
                 "maturity": p.maturity.isoformat(), "face_amount": round(p.face_amount, 2),
                 "frequency": p.frequency, "day_count": p.day_count.value}
                for p in sample_portfolio(key, par, settle)
            ],
        }
    return {"curve_as_of": as_of.isoformat(), "settlement": settle.isoformat(), "portfolios": out,
            "note": "Hypothetical Treasury-style bonds: coupons equal the bootstrapped par yield at each maturity, rounded to 1/8%. Not actual CUSIPs."}


def _ctx(req_curve: S.CurveSpec, settlement: date | None = None):
    st = get_store()
    par, as_of, prov = resolve_curve(st, req_curve)
    return st, par, as_of, prov, settlement_for(as_of, settlement)


@router.post("/portfolio/analyze")
def portfolio_analyze(req: S.PortfolioRequest):
    st, par, as_of, prov, settle = _ctx(req.curve, req.settlement)
    res = analyze_portfolio(to_positions(req.positions), par, settle)
    return _clean({**res, "provenance": prov})


@router.post("/portfolio/scenario")
def portfolio_scenario(req: S.ScenarioRequest):
    st, par, as_of, prov, settle = _ctx(req.curve, req.settlement)
    sc = run_scenario(to_positions(req.positions), par, dict(req.shocks_bp), settle)
    sc["commentary"] = scenario_commentary(sc)
    sc["risk_observations"] = risk_observations(sc)
    sc["classification"] = scenarios.classify_move(sc["shocks_bp"])
    return _clean({**sc, "provenance": prov})


STRESS_GRID = [
    ("parallel_m100", "Parallel −100bp", lambda: scenarios.parallel(-100)),
    ("parallel_m50", "Parallel −50bp", lambda: scenarios.parallel(-50)),
    ("parallel_m25", "Parallel −25bp", lambda: scenarios.parallel(-25)),
    ("parallel_p25", "Parallel +25bp", lambda: scenarios.parallel(25)),
    ("parallel_p50", "Parallel +50bp", lambda: scenarios.parallel(50)),
    ("parallel_p100", "Parallel +100bp", lambda: scenarios.parallel(100)),
    ("bull_steepener", scenarios.SHAPE_PRESETS["bull_steepener"]["label"], lambda: scenarios.preset("bull_steepener")),
    ("bear_steepener", scenarios.SHAPE_PRESETS["bear_steepener"]["label"], lambda: scenarios.preset("bear_steepener")),
    ("bull_flattener", scenarios.SHAPE_PRESETS["bull_flattener"]["label"], lambda: scenarios.preset("bull_flattener")),
    ("bear_flattener", scenarios.SHAPE_PRESETS["bear_flattener"]["label"], lambda: scenarios.preset("bear_flattener")),
]


@router.post("/portfolio/stress")
def portfolio_stress(req: S.PortfolioRequest):
    """Standard instantaneous stress grid, full revaluation for each scenario."""
    st, par, as_of, prov, settle = _ctx(req.curve, req.settlement)
    positions = to_positions(req.positions)
    rows = []
    for key, label, fn in STRESS_GRID:
        sh = fn()
        t = run_scenario(positions, par, sh, settle)["totals"]
        rows.append({"key": key, "label": label, "shocks_bp": sh, "pnl_full": t["pnl_full"], "return_full": t["return_full"],
                     "pnl_krd_approx": t["pnl_krd_approx"], "pnl_krd_convexity_approx": t["pnl_krd_convexity_approx"]})
    return _clean({"rows": rows, "curve_as_of": as_of.isoformat(), "settlement": settle.isoformat(), "provenance": prov})


@router.post("/portfolio/compare")
def portfolio_compare(req: S.CompareRequest):
    st, par, as_of, prov, settle = _ctx(req.curve)
    shocks = dict(req.shocks_bp) or scenarios.parallel(100)
    out = {}
    for key, name, pos in (("a", req.name_a, req.a), ("b", req.name_b, req.b)):
        sc = run_scenario(to_positions(pos), par, shocks, settle)
        out[key] = {"name": name, "analytics": sc["base"], "scenario_totals": sc["totals"]}
    std = {}
    for nm in ("parallel_up_100", "parallel_down_100", "bull_steepener", "bear_steepener", "bull_flattener", "bear_flattener"):
        sh = scenarios.preset(nm)
        std[nm] = {
            "label": scenarios.SHAPE_PRESETS[nm]["label"],
            "a": run_scenario(to_positions(req.a), par, sh, settle)["totals"]["return_full"],
            "b": run_scenario(to_positions(req.b), par, sh, settle)["totals"]["return_full"],
        }
    return _clean({**out, "shocks_bp": shocks, "standard_scenarios": std, "provenance": prov,
                   "curve_as_of": as_of.isoformat()})


# ============================================================== monetary policy simulator

@router.get("/policy/config")
def policy_config():
    st = get_store()
    return {
        "policy_presets_bp": POLICY_PRESETS_BP,
        "interpretations": INTERPRETATIONS,
        "transmission_profiles": TRANSMISSION_PROFILES,
        "loadings": {"pass_through_default": DEFAULT_PASS_THROUGH, "path": PATH_LOADING, "term_premium": TERM_PREMIUM_LOADING},
        "current_policy": st.policy_range_on(None),
        "tenors": TENORS,
        "disclaimer": "All presets are illustrative assumptions, not empirical forecasts.",
    }


@router.post("/policy/simulate")
def policy_simulate(req: S.PolicyRequest):
    st, par, as_of, prov, settle = _ctx(req.curve)
    tr, meta = policy_translation(req)
    sc = run_scenario(to_positions(req.positions), par, tr["shocks_bp"], settle)
    pr = st.policy_range_on(as_of)
    sc["commentary"] = scenario_commentary(sc, tr, pr)
    sc["risk_observations"] = risk_observations(sc)
    return _clean({
        "translation": tr,
        "assumptions": meta["assumptions"],
        "policy_before": pr,
        "policy_after": {"lower": max(0.0, pr["lower"] + req.policy_move_bp / 100), "upper": pr["upper"] + req.policy_move_bp / 100,
                         "note": "Hypothetical. Lower bound floored at 0%."},
        "scenario": sc,
        "classification": scenarios.classify_move(tr["shocks_bp"]),
        "provenance": prov,
        "curve_as_of": as_of.isoformat(),
    })


# ============================================================== historical scenarios

@router.get("/history/events")
def history_events():
    return {"events": HISTORICAL_EVENTS}


@router.get("/history/events/{event_id}")
def history_event(event_id: str, start: date | None = None, end: date | None = None):
    st = get_store()
    ev = EVENTS_BY_ID.get(event_id)
    if ev is None:
        raise KeyError(f"unknown event {event_id}")
    s = start or date.fromisoformat(ev["window"]["start"])
    e = end or date.fromisoformat(ev["window"]["end"])
    obs = observed_changes(st, s, e)
    changes = [c for c in st.policy_changes() if s.isoformat() <= c["effective_date"] <= e.isoformat()]
    return _clean({"event": ev, "observed": obs, "policy_changes_in_window": changes,
                   "custom_window": bool(start or end), "provenance": st.curve_provenance.to_dict()})


@router.get("/history/policy-changes")
def history_policy_changes(start: date | None = None):
    st = get_store()
    ch = st.policy_changes()
    if start:
        ch = [c for c in ch if c["effective_date"] >= start.isoformat()]
    return {"changes": ch, "note": "Derived from FRED DFEDTAR (to 2008-12-15) and DFEDTARL/DFEDTARU; dates are effective dates.",
            "provenance": st.series_provenance("DFEDTARU").to_dict()}


@router.post("/history/apply")
def history_apply(req: S.HistoryApplyRequest):
    st = get_store()
    if req.event_id:
        ev = EVENTS_BY_ID.get(req.event_id)
        if ev is None:
            raise KeyError(f"unknown event {req.event_id}")
        s = req.start or date.fromisoformat(ev["window"]["start"])
        e = req.end or date.fromisoformat(ev["window"]["end"])
    elif req.start and req.end:
        s, e = req.start, req.end
    else:
        raise ValueError("provide event_id or start and end dates")
    par, as_of = st.curve_on(req.curve.date)
    settle = settlement_for(as_of, None)
    ports = {name: to_positions(p) for name, p in req.portfolios.items()}
    if req.include_samples:
        for key, label in SAMPLE_PORTFOLIOS.items():
            ports.setdefault(label, sample_portfolio(key, par, settle))
    if not ports:
        raise ValueError("no portfolios supplied")
    return _clean(apply_to_portfolios(st, s, e, ports, as_of, settle))


# ============================================================== optimization

@router.post("/optimize")
def optimize_route(req: S.OptimizeRequest):
    st, par, as_of, prov, settle = _ctx(req.curve)
    uni = build_universe(par, settle, req.universe_years,
                         to_positions(req.universe_positions) if req.universe_positions else None)
    target_krd = dict(req.target_krd) if req.target_krd else None
    if req.objective == "match_krd":
        if not req.benchmark_positions:
            raise ValueError("match_krd requires benchmark_positions")
        bench = analyze_portfolio(to_positions(req.benchmark_positions), par, settle)
        target_krd = bench["key_rate_durations"]
    res = optimize(uni, req.objective, req.capital, req.target_duration, req.max_weight, req.long_only,
                   req.max_bucket_weight, target_krd, dict(req.krd_weights) if req.krd_weights else None)
    return _clean({**res, "curve_as_of": as_of.isoformat(), "provenance": prov})


@router.post("/optimize/barbell-bullet")
def optimize_barbell_bullet(req: S.BarbellBulletRequest):
    st, par, as_of, prov, settle = _ctx(req.curve)
    bb = barbell_vs_bullet(par, settle, req.target_years, req.short_years, req.long_years, req.notional)
    out = {}
    for key in ("bullet", "barbell"):
        a = analyze_portfolio(bb[key], par, settle)
        out[key] = {"summary": a["summary"], "krd": a["key_rate_durations"], "holdings": a["holdings"],
                    "positions": [{"id": p.id, "label": p.label, "coupon_pct": p.coupon_rate * 100,
                                   "maturity": p.maturity.isoformat(), "face_amount": p.face_amount} for p in bb[key]]}
    grid = {}
    for nm in ("parallel_up_100", "parallel_down_100", "bull_steepener", "bear_steepener", "bull_flattener",
               "bear_flattener", "butterfly_positive", "butterfly_negative"):
        sh = scenarios.preset(nm)
        rb = run_scenario(bb["bullet"], par, sh, settle)["totals"]["return_full"]
        rr = run_scenario(bb["barbell"], par, sh, settle)["totals"]["return_full"]
        grid[nm] = {"label": scenarios.SHAPE_PRESETS[nm]["label"], "bullet": rb, "barbell": rr, "barbell_minus_bullet_bp": (rr - rb) * 1e4}
    return _clean({**out, "weights": bb["weights"], "target_duration": bb["target_duration"], "scenarios": grid,
                   "curve_as_of": as_of.isoformat(), "provenance": prov,
                   "method": "Barbell wing weights solved analytically so that MV-weighted modified duration equals the bullet's."})


# ============================================================== macro research

@router.get("/macro/indicators")
def macro_indicators():
    return {"indicators": macro.INDICATORS, "fred_series": FRED_SERIES_META}


@router.get("/macro/overview")
def macro_overview(start: date | None = None):
    st = get_store()
    res = macro.overview_series(st, start)
    prov = {sid: st.series_provenance(sid).to_dict() for sid in FRED_SERIES_META}
    return _clean({**res, "provenance": prov})


@router.get("/macro/dashboard")
def macro_dashboard(x: str = "core_pce_yoy", y: str = "ust_10y", start: date | None = None, end: date | None = None,
                    window: int = 36, lag: int = 0, horizon: int = 12):
    st = get_store()
    return _clean(macro.dashboard(st, x, y, start, end, window, lag, horizon))


@router.get("/macro/correlations")
def macro_correlations(keys: str = "fed_funds,cpi_yoy,core_pce_yoy,unemployment,ust_2y,ust_10y,spread_10y2y",
                       start: date | None = None, end: date | None = None):
    return _clean(macro.correlation_matrix(get_store(), [k.strip() for k in keys.split(",")], start, end))


# ============================================================== reports

def _report_brief(req: S.ReportRequest) -> dict:
    st, par, as_of, prov, settle = _ctx(req.curve)
    positions = to_positions(req.positions)
    policy_tr = None
    assumptions: list[str] = []
    label = req.scenario_label
    if req.policy is not None:
        policy_tr, meta = policy_translation(req.policy)
        shocks = policy_tr["shocks_bp"]
        assumptions = meta["assumptions"]
        label = f"Hypothetical policy scenario: {req.policy.policy_move_bp:+.0f} bp change in the fed funds target"
    elif req.shocks_bp:
        shocks = dict(req.shocks_bp)
        assumptions = ["Shocks (bp) by tenor: " + ", ".join(f"{t} {v:+.0f}" for t, v in shocks.items())]
    else:
        raise ValueError("provide shocks_bp or policy parameters")
    sc = run_scenario(positions, par, shocks, settle)
    mkt = market_context(st, par, as_of, prov)
    return build_brief(sc, mkt, label, assumptions, policy_tr, req.portfolio_name)


@router.post("/report/brief")
def report_brief(req: S.ReportRequest):
    return _clean(_report_brief(req))


@router.post("/report/pdf")
def report_pdf(req: S.ReportRequest):
    pdf = render_pdf(_report_brief(req))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="monetary_research_brief.pdf"'})
