"""Yield-curve shock generators. All shocks are in basis points at published tenors.

Shape scenarios are defined by *anchor* shocks at a few tenors, linearly
interpolated in maturity across the 11 published tenors and held flat outside
the outermost anchors. Every preset therefore has an explicit, inspectable
formula (returned in ``describe``).
"""
from __future__ import annotations

import numpy as np

from app.data.sources import TENOR_YEARS, TENORS


def from_anchors(anchors: dict[str, float]) -> dict[str, float]:
    if not anchors:
        return {t: 0.0 for t in TENORS}
    for k in anchors:
        if k not in TENOR_YEARS:
            raise ValueError(f"unknown tenor {k!r}")
    items = sorted(anchors.items(), key=lambda kv: TENOR_YEARS[kv[0]])
    xs = np.array([TENOR_YEARS[k] for k, _ in items])
    ys = np.array([v for _, v in items], dtype=float)
    return {t: float(np.interp(TENOR_YEARS[t], xs, ys)) for t in TENORS}


def parallel(bp: float) -> dict[str, float]:
    return {t: float(bp) for t in TENORS}


def slope(short_bp: float, long_bp: float, short_tenor: str = "2Y", long_tenor: str = "10Y") -> dict[str, float]:
    return from_anchors({short_tenor: short_bp, long_tenor: long_bp})


def twist(magnitude_bp: float, pivot: str = "5Y") -> dict[str, float]:
    """Short end moves by -magnitude, long end by +magnitude, zero at the pivot (steepening twist if > 0)."""
    return from_anchors({"2Y": -magnitude_bp, pivot: 0.0, "30Y": magnitude_bp})


def butterfly(magnitude_bp: float) -> dict[str, float]:
    """Positive butterfly: wings (<=2Y and 30Y) rise by +m, belly (7Y) falls by -m."""
    return from_anchors({"2Y": magnitude_bp, "7Y": -magnitude_bp, "30Y": magnitude_bp})


# Named presets: (description, anchors). Magnitudes are illustrative.
SHAPE_PRESETS: dict[str, dict] = {
    "parallel_up_100": {"label": "Parallel +100bp", "anchors": {"1M": 100, "30Y": 100}},
    "parallel_down_100": {"label": "Parallel -100bp", "anchors": {"1M": -100, "30Y": -100}},
    "bull_steepener": {"label": "Bull steepener (2Y -50, 10Y -15)", "anchors": {"2Y": -50, "10Y": -15}},
    "bear_steepener": {"label": "Bear steepener (2Y +10, 10Y +45)", "anchors": {"2Y": 10, "10Y": 45}},
    "bull_flattener": {"label": "Bull flattener (2Y -10, 10Y -45)", "anchors": {"2Y": -10, "10Y": -45}},
    "bear_flattener": {"label": "Bear flattener (2Y +50, 10Y +15)", "anchors": {"2Y": 50, "10Y": 15}},
    "twist_steepening": {"label": "Steepening twist (2Y -25, 5Y 0, 30Y +25)", "anchors": {"2Y": -25, "5Y": 0, "30Y": 25}},
    "twist_flattening": {"label": "Flattening twist (2Y +25, 5Y 0, 30Y -25)", "anchors": {"2Y": 25, "5Y": 0, "30Y": -25}},
    "butterfly_positive": {"label": "Positive butterfly (wings +20, 7Y belly -20)", "anchors": {"2Y": 20, "7Y": -20, "30Y": 20}},
    "butterfly_negative": {"label": "Negative butterfly (wings -20, 7Y belly +20)", "anchors": {"2Y": -20, "7Y": 20, "30Y": -20}},
}

SHAPE_DEFINITIONS = {
    "bull_steepening": "Yields fall, short end falls more -> 10Y-2Y spread widens (typical when markets price policy easing).",
    "bear_steepening": "Yields rise, long end rises more -> spread widens (e.g. rising term premium or inflation compensation).",
    "bull_flattening": "Yields fall, long end falls more -> spread narrows (e.g. flight to duration, lower long-run growth expectations).",
    "bear_flattening": "Yields rise, short end rises more -> spread narrows (typical when markets price policy tightening).",
    "twist": "Short and long ends move in opposite directions around a pivot tenor.",
    "butterfly": "Wings (short and long) move opposite to the belly (intermediate maturities).",
}


def preset(name: str, scale: float = 1.0) -> dict[str, float]:
    if name not in SHAPE_PRESETS:
        raise KeyError(f"unknown preset {name!r}")
    a = {k: v * scale for k, v in SHAPE_PRESETS[name]["anchors"].items()}
    return from_anchors(a)


def classify_move(shocks: dict[str, float], short: str = "2Y", long: str = "10Y", tol_bp: float = 2.0) -> str:
    """Name a curve move by the direction of the level and the change in the 10Y-2Y slope."""
    s, l_ = shocks.get(short, 0.0), shocks.get(long, 0.0)
    level = (s + l_) / 2
    dslope = l_ - s
    if abs(dslope) <= tol_bp:
        if abs(level) <= tol_bp:
            return "little change"
        return "parallel shift up" if level > 0 else "parallel shift down"
    if s * l_ < 0:
        return "steepening twist" if dslope > 0 else "flattening twist"
    bull = level < 0
    steep = dslope > 0
    return f"{'bull' if bull else 'bear'} {'steepening' if steep else 'flattening'}"
