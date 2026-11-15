"""Monetary-policy scenario -> Treasury curve shock translation.

THIS IS A SCENARIO TOOL, NOT A FORECAST. It does not predict FOMC decisions or
Treasury yields. It converts *user-specified, hypothetical* policy news into a
yield-curve shock using transparent, editable assumptions:

    dy(tenor) =  beta(tenor) * S                 (1) policy-surprise pass-through
               + L_path(tenor) * path_bp         (2) revision to expected policy path
               + L_tp(tenor)   * term_premium_bp (3) term-premium / inflation-compensation shift
               + overlay(tenor)                  (4) optional explicit curve-shape overlay

    S = policy_move_bp * (1 - priced_in)         the *unexpected* part of the move

Key principle: a change in the federal funds target does not mechanically move
every Treasury yield one-for-one. Markets price expected policy in advance, so
an announced move that was fully anticipated (priced_in = 1) contributes zero
through channel (1); yields then move only through revisions to the expected
path and term premia. The default pass-through profile declines with maturity,
consistent in *direction and rough magnitude* with event-study evidence
(Kuttner 2001; Gurkaynak, Sack & Swanson 2005) -- but the numbers here are
illustrative assumptions, not estimates produced by this application.
"""
from __future__ import annotations

from app.core.scenarios import from_anchors, twist
from app.data.sources import TENORS

# (1) Pass-through of the target-rate surprise by tenor (illustrative).
DEFAULT_PASS_THROUGH: dict[str, float] = {
    "1M": 0.95, "3M": 0.85, "6M": 0.75, "1Y": 0.65, "2Y": 0.55, "3Y": 0.48,
    "5Y": 0.38, "7Y": 0.32, "10Y": 0.27, "20Y": 0.20, "30Y": 0.17,
}
# (2) Loading of a revision to the expected policy path (peaks at 1-2 years).
PATH_LOADING: dict[str, float] = {
    "1M": 0.10, "3M": 0.30, "6M": 0.60, "1Y": 0.90, "2Y": 1.00, "3Y": 0.95,
    "5Y": 0.75, "7Y": 0.60, "10Y": 0.45, "20Y": 0.35, "30Y": 0.30,
}
# (3) Loading of a term-premium / inflation-compensation shift (rises with maturity).
TERM_PREMIUM_LOADING: dict[str, float] = {
    "1M": 0.00, "3M": 0.00, "6M": 0.02, "1Y": 0.05, "2Y": 0.15, "3Y": 0.25,
    "5Y": 0.45, "7Y": 0.60, "10Y": 0.75, "20Y": 0.95, "30Y": 1.00,
}

TRANSMISSION_PROFILES: dict[str, dict] = {
    "custom": {"label": "Custom pass-through (editable by tenor)", "beta": DEFAULT_PASS_THROUGH},
    "front_end": {"label": "Front-end led (default profile)", "beta": DEFAULT_PASS_THROUGH},
    "parallel": {
        "label": "Parallel Treasury shift (beta = 1 at every tenor; an upper-bound benchmark, not typical)",
        "beta": {t: 1.0 for t in TENORS},
    },
    "steepening": {
        "label": "Steepening transmission (short end reacts, long end barely moves)",
        "beta": {"1M": 1.0, "3M": 0.95, "6M": 0.85, "1Y": 0.75, "2Y": 0.6, "3Y": 0.45, "5Y": 0.3,
                 "7Y": 0.2, "10Y": 0.12, "20Y": 0.05, "30Y": 0.03},
    },
    "flattening": {
        "label": "Flattening transmission (long end moves nearly as much as the front end)",
        "beta": {"1M": 0.9, "3M": 0.88, "6M": 0.86, "1Y": 0.84, "2Y": 0.8, "3Y": 0.78, "5Y": 0.75,
                 "7Y": 0.72, "10Y": 0.7, "20Y": 0.66, "30Y": 0.64},
    },
    "twist": {
        "label": "Credibility twist (front end follows policy, long end moves the other way)",
        "beta": {"1M": 0.95, "3M": 0.85, "6M": 0.7, "1Y": 0.55, "2Y": 0.4, "3Y": 0.25, "5Y": 0.05,
                 "7Y": -0.05, "10Y": -0.12, "20Y": -0.18, "30Y": -0.2},
    },
}

# Market-interpretation presets. All values are ILLUSTRATIVE ASSUMPTIONS.
INTERPRETATIONS: dict[str, dict] = {
    "expected": {
        "label": "Expected policy move",
        "priced_in": 1.0, "path_bp": 0.0, "term_premium_bp": 0.0,
        "note": "Fully anticipated: the move itself is already in prices, so the surprise channel is zero.",
    },
    "hawkish_surprise": {
        "label": "Unexpected hawkish surprise",
        "priced_in": 0.0, "path_bp": 15.0, "term_premium_bp": 5.0,
        "note": "Move not anticipated and read as signalling a higher path of future policy rates.",
    },
    "dovish_surprise": {
        "label": "Unexpected dovish surprise",
        "priced_in": 0.0, "path_bp": -15.0, "term_premium_bp": -3.0,
        "note": "Move not anticipated and read as signalling a lower path of future policy rates.",
    },
    "inflation_shock": {
        "label": "Inflation shock",
        "priced_in": 0.5, "path_bp": 20.0, "term_premium_bp": 25.0,
        "note": "Policy reacts to higher inflation; expected path and long-end inflation compensation rise.",
    },
    "recession_shock": {
        "label": "Recession shock",
        "priced_in": 0.25, "path_bp": -60.0, "term_premium_bp": -10.0,
        "note": "Markets price additional future easing; short and intermediate yields fall most (bull steepening).",
    },
    "higher_for_longer": {
        "label": "Higher-for-longer",
        "priced_in": 1.0, "path_bp": 30.0, "term_premium_bp": 15.0,
        "note": "Policy rate held, but expected cuts are pushed out; 1-5Y yields rise most, term premium up.",
    },
}

POLICY_PRESETS_BP = {
    "cut_100": -100, "cut_50": -50, "cut_25": -25, "hold": 0, "hike_25": 25, "hike_50": 50, "hike_100": 100,
}


def overlay_shocks(kind: str, magnitude_bp: float, pivot: str = "5Y") -> dict[str, float]:
    """Explicit curve-shape overlay added on top of the policy channels."""
    if kind == "none" or magnitude_bp == 0:
        return {t: 0.0 for t in TENORS}
    if kind == "parallel":
        return {t: float(magnitude_bp) for t in TENORS}
    if kind == "steepening":  # long end up relative to 2Y, linear in maturity, 0 at <=2Y
        return from_anchors({"2Y": 0.0, "30Y": magnitude_bp})
    if kind == "flattening":
        return from_anchors({"2Y": 0.0, "30Y": -magnitude_bp})
    if kind == "twist":
        return twist(magnitude_bp, pivot)
    raise ValueError(f"unknown overlay {kind!r}")


def translate_policy_scenario(
    policy_move_bp: float,
    priced_in: float,
    path_bp: float,
    term_premium_bp: float,
    pass_through: dict[str, float],
    overlay_kind: str = "none",
    overlay_bp: float = 0.0,
    overlay_pivot: str = "5Y",
) -> dict:
    if not 0.0 <= priced_in <= 1.0:
        raise ValueError("priced_in must be between 0 and 1")
    if abs(policy_move_bp) > 500:
        raise ValueError("policy move limited to +/-500bp")
    missing = [t for t in TENORS if t not in pass_through]
    if missing:
        raise ValueError(f"pass-through missing tenors: {missing}")
    surprise = policy_move_bp * (1.0 - priced_in)
    ov = overlay_shocks(overlay_kind, overlay_bp, overlay_pivot)
    comps = []
    total = {}
    for t in TENORS:
        c1 = pass_through[t] * surprise
        c2 = PATH_LOADING[t] * path_bp
        c3 = TERM_PREMIUM_LOADING[t] * term_premium_bp
        c4 = ov[t]
        total[t] = c1 + c2 + c3 + c4
        comps.append({"tenor": t, "surprise": c1, "path": c2, "term_premium": c3, "overlay": c4, "total": total[t]})
    return {
        "policy_move_bp": policy_move_bp,
        "expected_component_bp": policy_move_bp * priced_in,
        "surprise_bp": surprise,
        "shocks_bp": total,
        "components": comps,
        "formula": "dy(t) = beta(t)*S + L_path(t)*path_bp + L_tp(t)*term_premium_bp + overlay(t);  S = policy_move*(1 - priced_in)",
        "loadings": {"pass_through": pass_through, "path": PATH_LOADING, "term_premium": TERM_PREMIUM_LOADING},
        "disclaimer": (
            "Hypothetical scenario built from user-adjustable assumptions. It is not a forecast of "
            "Federal Reserve decisions or Treasury yields."
        ),
    }
