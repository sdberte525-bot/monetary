"""Calculation-based commentary.

Every sentence is assembled from numbers computed by the engine. No economic
news, policy statements, forecasts or recommendations are generated. Wording
is deliberately conditional ("under the specified hypothetical...").
"""
from __future__ import annotations

from app.core.portfolio import MATURITY_BUCKETS
from app.core.scenarios import classify_move


def _money(x: float) -> str:
    if abs(x) < 0.5:
        return "$0"
    sign = "-" if x < 0 else ""
    x = abs(x)
    if x >= 1e9:
        return f"{sign}${x/1e9:,.2f}bn"
    if x >= 1e6:
        return f"{sign}${x/1e6:,.2f}mm"
    if x >= 1e3:
        return f"{sign}${x/1e3:,.1f}k"
    return f"{sign}${x:,.0f}"


def _bp(x: float) -> str:
    return f"{x:+.1f} bp"


def _bucket_of(years: float) -> str:
    for name, lo, hi in MATURITY_BUCKETS:
        if lo <= years < hi:
            return name
    return "30y+"


def scenario_commentary(sc: dict, policy: dict | None = None, policy_range: dict | None = None) -> list[str]:
    s = []
    shocks = sc["shocks_bp"]
    tot = sc["totals"]
    base = sc["base"]["summary"]
    if policy is not None:
        move = policy["policy_move_bp"]
        if move == 0:
            s.append("The hypothetical scenario assumes no change in the federal funds target range.")
        else:
            verb = "increase" if move > 0 else "reduction"
            line = f"The hypothetical scenario assumes a {abs(move):.0f} bp {verb} in the federal funds target range"
            if policy_range:
                lo, hi = policy_range["lower"], policy_range["upper"]
                line += f", from {lo:.2f}-{hi:.2f}% to {lo + move/100:.2f}-{hi + move/100:.2f}%"
            s.append(line + ".")
        s.append(
            f"Of that move, {abs(policy['expected_component_bp']):.0f} bp is assumed to be already priced in, leaving a "
            f"policy surprise of {policy['surprise_bp']:.0f} bp; yields also respond to the assumed revision of the "
            "expected policy path and term premium."
        )
        if move != 0 and "10Y" in shocks:
            ratio = shocks["10Y"] / move
            s.append(
                f"Under these assumptions the 2-year yield changes by {_bp(shocks.get('2Y', 0))} and the 10-year by "
                f"{_bp(shocks['10Y'])} - the 10-year moves {abs(ratio):.2f}x the policy-rate change"
                f"{' in the opposite direction' if ratio < 0 else ''}, not one-for-one."
            )
    move_name = classify_move(shocks)
    sb, sa = sc["curve_shape_before"], sc["curve_shape_after"]
    if sb["spread_2s10s_bp"] is not None and sa["spread_2s10s_bp"] is not None:
        s.append(
            f"The curve move is a {move_name}: the 10Y-2Y spread goes from {sb['spread_2s10s_bp']:.0f} bp to "
            f"{sa['spread_2s10s_bp']:.0f} bp ({sb['shape_2s10s']} -> {sa['shape_2s10s']})."
        )
    pnl = tot["pnl_full"]
    direction = "gains" if pnl > 0 else "loses" if pnl < 0 else "is unchanged at"
    s.append(
        f"On full cash-flow revaluation the portfolio {direction} {_money(abs(pnl))} "
        f"({tot['return_full']*100:+.2f}%) on a starting market value of {_money(base['market_value'])}."
    )
    rows = sorted(sc["pnl"], key=lambda r: abs(r["pnl_full"]), reverse=True)
    if rows and abs(pnl) > 0:
        top = rows[0]
        holdings = {h["id"]: h for h in sc["base"]["holdings"]}
        h = holdings.get(top["id"], {})
        bucket = _bucket_of(h.get("years_to_maturity", 0))
        bucket_pnl = sum(
            r["pnl_full"] for r in sc["pnl"] if _bucket_of(holdings[r["id"]]["years_to_maturity"]) == bucket
        )
        s.append(
            f"The largest contributor is {top['label']} ({_money(top['pnl_full'])}, "
            f"{top['share_of_pnl']*100:.0f}% of total P&L); the {bucket} maturity bucket accounts for "
            f"{bucket_pnl / pnl * 100:.0f}% of the result."
        )
    kr = tot["pnl_by_key_rate"]
    if kr:
        tmax = max(kr, key=lambda t: abs(kr[t]))
        if abs(kr[tmax]) > 0:
            s.append(
                f"By key rate, the {tmax} point explains the most first-order P&L ({_money(kr[tmax])}): the portfolio's "
                f"{tmax} key-rate DV01 of {_money(sc['base']['key_rate_dv01'][tmax])} per bp times a {_bp(shocks[tmax])} shock."
            )
    approx_err = tot["pnl_krd_approx"] - pnl
    s.append(
        f"A first-order key-rate duration estimate gives {_money(tot['pnl_krd_approx'])} and adding convexity gives "
        f"{_money(tot['pnl_krd_convexity_approx'])}, versus {_money(pnl)} on full revaluation "
        f"(first-order error {_money(approx_err)})."
    )
    s.append(
        f"Portfolio modified duration moves from {base['modified_duration']:.2f} to "
        f"{sc['shocked']['summary']['modified_duration']:.2f} years and DV01 from {_money(base['dv01'])} to "
        f"{_money(sc['shocked']['summary']['dv01'])} per bp after the shock."
    )
    return s


def risk_observations(sc: dict) -> list[str]:
    """Analytical (non-prescriptive) portfolio-management implications."""
    out = []
    base = sc["base"]
    krdv = base["key_rate_dv01"]
    total = sum(krdv.values())
    if total > 0:
        t = max(krdv, key=lambda k: krdv[k])
        out.append(
            f"{krdv[t]/total*100:.0f}% of the portfolio's key-rate DV01 sits at the {t} point; P&L is most sensitive to "
            f"moves in that part of the curve."
        )
        sh = sc["shocks_bp"].get(t, 0.0)
        if sh:
            out.append(
                f"In this scenario, each $1,000 of {t} key-rate DV01 removed would change first-order scenario P&L by "
                f"about {_money(1000 * sh)}."
            )
    conc = base["concentration"]
    out.append(
        f"Market-value concentration: HHI {conc['hhi']:.3f} (effective number of positions {conc['effective_positions']:.1f}); "
        f"largest single DV01 share {conc['max_dv01_share']*100:.0f}%."
    )
    out.extend(conc["warnings"])
    cvx = base["summary"]["convexity"]
    out.append(
        f"Portfolio convexity of {cvx:.1f} adds roughly {0.5*cvx*(0.01**2)*100:.2f}% of value for a 100 bp parallel move "
        "in either direction, relative to the duration-only estimate."
    )
    return out
