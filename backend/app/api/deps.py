"""Shared helpers for API routes: curve resolution, position conversion, market context."""
from __future__ import annotations

from datetime import date

from app.api.schemas import CurveSpec, PolicyParams, PositionIn
from app.core.curve import ParCurve, curve_shape
from app.core.daycount import DayCount
from app.core.policy import INTERPRETATIONS, TRANSMISSION_PROFILES, translate_policy_scenario
from app.core.portfolio import Position
from app.core.schedule import treasury_settlement
from app.data.store import MarketDataStore


def to_positions(items: list[PositionIn]) -> list[Position]:
    ids = [p.id for p in items]
    if len(ids) != len(set(ids)):
        raise ValueError("position ids must be unique")
    return [
        Position(
            id=p.id, label=p.label, coupon_rate=p.coupon_pct / 100.0, maturity=p.maturity,
            face_amount=p.face_amount, frequency=p.frequency, day_count=DayCount(p.day_count),
        )
        for p in items
    ]


def resolve_curve(store: MarketDataStore, spec: CurveSpec) -> tuple[ParCurve, date, dict]:
    """Return (par curve, as-of date, provenance). Custom curves are labeled as user input."""
    if spec.custom_par_pct:
        as_of = spec.date or store.resolve_curve_date(None)
        par = ParCurve.from_percent(dict(spec.custom_par_pct), as_of=as_of.isoformat())
        prov = {"source": "User-supplied par curve", "mode": "user", "url": None,
                "retrieved_at_utc": None, "last_observation": None,
                "note": "Hypothetical curve entered by the user - not market data."}
        return par, as_of, prov
    par, d = store.curve_on(spec.date)
    return par, d, store.curve_provenance.to_dict()


def settlement_for(curve_date: date, override: date | None) -> date:
    return override or treasury_settlement(curve_date)


def market_context(store: MarketDataStore, par: ParCurve, as_of: date, prov: dict) -> dict:
    pct = par.to_percent()
    shape = curve_shape(pct)
    pr = store.policy_range_on(as_of)
    sources = [
        f"U.S. Treasury Daily Par Yield Curve Rates, observation {as_of.isoformat()} ({prov.get('mode')}).",
        f"FRED DFEDTARL/DFEDTARU target range as of {pr['as_of']}.",
    ]
    return {
        "curve_as_of": as_of.isoformat(),
        "curve_mode": prov.get("mode"),
        "policy_lower": pr["lower"], "policy_upper": pr["upper"], "policy_as_of": pr["as_of"],
        "policy_range": pr,
        "y2": pct.get("2Y", float("nan")), "y10": pct.get("10Y", float("nan")),
        "s2s10": shape["spread_2s10s_bp"] or 0.0, "s3m10": shape["spread_3m10y_bp"] or 0.0,
        "shape": shape["shape"],
        "sources": sources,
    }


def policy_translation(p: PolicyParams) -> tuple[dict, dict]:
    if p.interpretation not in INTERPRETATIONS:
        raise ValueError(f"unknown interpretation {p.interpretation!r}")
    if p.transmission not in TRANSMISSION_PROFILES:
        raise ValueError(f"unknown transmission profile {p.transmission!r}")
    preset = INTERPRETATIONS[p.interpretation]
    beta = dict(TRANSMISSION_PROFILES[p.transmission]["beta"])
    if p.pass_through:
        beta.update(p.pass_through)
    params = {
        "priced_in": preset["priced_in"] if p.priced_in is None else p.priced_in,
        "path_bp": preset["path_bp"] if p.path_bp is None else p.path_bp,
        "term_premium_bp": preset["term_premium_bp"] if p.term_premium_bp is None else p.term_premium_bp,
    }
    tr = translate_policy_scenario(
        p.policy_move_bp, params["priced_in"], params["path_bp"], params["term_premium_bp"], beta,
        p.overlay_kind, p.overlay_bp, p.overlay_pivot,
    )
    assumptions = [
        f"Market interpretation: {preset['label']} - {preset['note']}",
        f"Share of move priced in: {params['priced_in']*100:.0f}%; expected-path revision {params['path_bp']:+.0f} bp; "
        f"term-premium shift {params['term_premium_bp']:+.0f} bp.",
        f"Transmission profile: {TRANSMISSION_PROFILES[p.transmission]['label']}"
        + (" (with user overrides)" if p.pass_through else "") + ".",
        f"Curve overlay: {p.overlay_kind}" + (f" {p.overlay_bp:+.0f} bp" if p.overlay_kind != "none" else "") + ".",
        tr["formula"],
    ]
    return tr, {"params": params, "assumptions": assumptions, "beta": beta}
