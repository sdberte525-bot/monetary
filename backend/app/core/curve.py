"""Treasury par curve -> discount curve construction.

Observed data are *par yields* (Treasury CMT, bond-equivalent basis). A par
yield is the coupon rate at which a hypothetical bond of that maturity would
price at 100; it is NOT the zero-coupon (spot) rate for that maturity. We
therefore bootstrap discount factors. Assumptions (all documented in the
Methodology page and returned with every curve):

1. Interpolation: par yields are linearly interpolated in maturity between
   published tenors and held flat outside the published range. Missing tenors
   on a date are dropped (never filled with values from other dates).
2. Bills (t <= 1y) are treated as zero-coupon instruments quoted on a
   bond-equivalent basis:  t < 0.5:  DF = 1 / (1 + y t)     (simple interest)
                           t >= 0.5: DF = (1 + y/2)^(-2t)   (semiannual)
3. Coupon tenors (t > 1y): the par yield c(t) at each semiannual node
   t = 1.5, 2.0, ..., 30 defines a par bond paying c/2 every six months;
   DF(t) = (1 - c/2 * sum_{j<t} DF(t_j)) / (1 + c/2).
4. Between nodes, ln DF is linearly interpolated (piecewise-constant
   instantaneous forward rates). Beyond the last node, the final forward rate
   is extrapolated flat and a warning is raised.
5. Coupon timing uses exact semiannual periods (no day-count or settlement
   lag inside the bootstrap); on-the-run liquidity premia are ignored.

These are standard, transparent textbook choices (e.g. Tuckman & Serrat,
*Fixed Income Securities*, ch. 2) -- they are not Treasury's or the Fed's
production curve models (cf. Gurkaynak, Sack & Wright 2007 for a fitted
Svensson curve).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.data.sources import TENOR_YEARS, TENORS

SEMI_NODES = np.arange(0.5, 30.0 + 1e-9, 0.5)


@dataclass(frozen=True)
class ParCurve:
    """Par yields (decimal) at published tenors for a single observation date."""

    tenors: tuple[str, ...]
    yields: np.ndarray  # decimal
    as_of: str | None = None

    @property
    def years(self) -> np.ndarray:
        return np.array([TENOR_YEARS[t] for t in self.tenors])

    @classmethod
    def from_percent(cls, values: dict[str, float | None], as_of: str | None = None) -> "ParCurve":
        """Build from a {tenor: percent} mapping. None/NaN tenors are dropped (never filled)."""
        tenors, ys = [], []
        for t in TENORS:
            v = values.get(t)
            if v is None or (isinstance(v, float) and np.isnan(v)):
                continue
            tenors.append(t)
            ys.append(float(v) / 100.0)
        if len(tenors) < 2:
            raise ValueError("at least two tenors are required to build a curve")
        return cls(tuple(tenors), np.array(ys), as_of)

    def missing_tenors(self) -> list[str]:
        return [t for t in TENORS if t not in self.tenors]

    def par_yield(self, t: np.ndarray | float) -> np.ndarray:
        return np.interp(t, self.years, self.yields)

    def shocked(self, shocks_bp: dict[str, float]) -> "ParCurve":
        """Add tenor-specific shocks (bp) at published tenors."""
        add = np.array([shocks_bp.get(t, 0.0) for t in self.tenors]) * 1e-4
        return ParCurve(self.tenors, self.yields + add, self.as_of)

    def to_percent(self) -> dict[str, float]:
        return {t: float(y * 100) for t, y in zip(self.tenors, self.yields)}


@dataclass(frozen=True)
class ZeroCurve:
    """Discount curve represented by node times and discount factors."""

    times: np.ndarray  # years, strictly increasing, > 0
    dfs: np.ndarray
    max_observed_maturity: float
    source: str = "bootstrapped"
    warnings: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if np.any(np.diff(self.times) <= 0):
            raise ValueError("curve node times must be strictly increasing")
        if np.any(self.dfs <= 0):
            raise ValueError("non-positive discount factor - curve inputs are inconsistent")

    # -- core interpolation: log-linear DF == piecewise-flat forwards
    def discount(self, t: np.ndarray | float) -> np.ndarray:
        t = np.atleast_1d(np.asarray(t, dtype=float))
        if np.any(t < 0):
            raise ValueError("negative time")
        lt = np.concatenate([[0.0], self.times])
        ld = np.concatenate([[0.0], np.log(self.dfs)])
        out = np.interp(t, lt, ld)
        beyond = t > lt[-1]
        if np.any(beyond):
            fwd = -(ld[-1] - ld[-2]) / (lt[-1] - lt[-2])
            out[beyond] = ld[-1] - fwd * (t[beyond] - lt[-1])
        return np.exp(out)

    def zero_rate(self, t: np.ndarray | float, compounding: int | None = 2) -> np.ndarray:
        t = np.atleast_1d(np.asarray(t, dtype=float))
        df = self.discount(t)
        if compounding is None:
            return -np.log(df) / t
        return compounding * (df ** (-1.0 / (compounding * t)) - 1.0)

    def forward_rate(self, t1: np.ndarray, t2: np.ndarray, compounding: int | None = 2) -> np.ndarray:
        """Simple forward rate between t1 and t2 under the stated compounding."""
        d1, d2 = self.discount(t1), self.discount(t2)
        tau = np.asarray(t2) - np.asarray(t1)
        if compounding is None:
            return np.log(d1 / d2) / tau
        return compounding * ((d1 / d2) ** (1.0 / (compounding * tau)) - 1.0)

    def par_yield(self, t: float, frequency: int = 2) -> float:
        """Par coupon (decimal) for a bond with regular coupons at `frequency` maturing at t."""
        n = int(round(t * frequency))
        if n < 1:
            raise ValueError("maturity too short")
        times = np.arange(1, n + 1) / frequency
        d = self.discount(times)
        return float(frequency * (1 - d[-1]) / d.sum())

    @classmethod
    def from_spot_rates(
        cls, years: list[float], rates: list[float], compounding: int | None = 2
    ) -> "ZeroCurve":
        """Build from user-supplied spot (zero) rates in decimals - alternative to bootstrapping."""
        ys = np.asarray(years, dtype=float)
        rs = np.asarray(rates, dtype=float)
        order = np.argsort(ys)
        ys, rs = ys[order], rs[order]
        if np.any(ys <= 0):
            raise ValueError("spot-rate maturities must be positive")
        if compounding is None:
            dfs = np.exp(-rs * ys)
        else:
            dfs = (1 + rs / compounding) ** (-compounding * ys)
        return cls(ys, dfs, float(ys.max()), source="user-supplied spot rates")


def bootstrap(par: ParCurve) -> ZeroCurve:
    """Bootstrap discount factors from a par curve (see module docstring for assumptions)."""
    warnings: list[str] = []
    obs_years = par.years
    max_obs = float(obs_years.max())
    if par.missing_tenors():
        warnings.append(
            "Tenors not published on this date and excluded (not filled): " + ", ".join(par.missing_tenors())
        )
    if max_obs < 30:
        warnings.append(
            f"Longest observed tenor is {max_obs:g}y; par yields beyond it are held flat (extrapolation)."
        )

    # Short bill nodes below 6 months, at published tenors only.
    short_times = [t for t in obs_years if t < 0.5]
    times: list[float] = []
    dfs: list[float] = []
    for t in short_times:
        y = float(par.par_yield(t))
        times.append(t)
        dfs.append(1.0 / (1.0 + y * t))

    df_semi: dict[float, float] = {}
    for t in SEMI_NODES:
        c = float(par.par_yield(t))
        if t <= 1.0 + 1e-12:
            d = (1.0 + c / 2.0) ** (-2.0 * t)
        else:
            prior = sum(df_semi[s] for s in SEMI_NODES if s < t - 1e-12)
            d = (1.0 - c / 2.0 * prior) / (1.0 + c / 2.0)
        if d <= 0:
            raise ValueError(f"bootstrap failed at t={t}: non-positive discount factor")
        df_semi[float(t)] = d
        times.append(float(t))
        dfs.append(d)
    return ZeroCurve(np.array(times), np.array(dfs), max_obs, warnings=warnings)


def curve_shape(par_pct: dict[str, float | None], flat_threshold_bp: float = 25.0) -> dict:
    """Classify the curve using transparent spread-based definitions.

    * 10Y-2Y spread and 10Y-3M spread are computed in bp.
    * Inverted: spread < 0.  Flat: 0 <= spread < threshold (default 25bp).
      Normal (upward-sloping): spread >= threshold.
    Classification is reported separately for each spread; the headline uses
    10Y-3M if both are available (the measure emphasized by Estrella & Mishkin
    1996), else 10Y-2Y.
    """

    def classify(s: float | None) -> str | None:
        if s is None:
            return None
        if s < 0:
            return "inverted"
        if s < flat_threshold_bp:
            return "flat"
        return "normal"

    def spread(a: str, b: str) -> float | None:
        va, vb = par_pct.get(a), par_pct.get(b)
        if va is None or vb is None or np.isnan(va) or np.isnan(vb):
            return None
        return round((va - vb) * 100.0, 2)

    s210 = spread("10Y", "2Y")
    s310 = spread("10Y", "3M")
    headline = classify(s310) if s310 is not None else classify(s210)
    return {
        "spread_2s10s_bp": s210,
        "spread_3m10y_bp": s310,
        "shape_2s10s": classify(s210),
        "shape_3m10y": classify(s310),
        "shape": headline,
        "flat_threshold_bp": flat_threshold_bp,
        "definition": (
            f"Inverted if spread < 0 bp; flat if 0 <= spread < {flat_threshold_bp:g} bp; "
            f"normal if spread >= {flat_threshold_bp:g} bp. Headline uses 10Y-3M when available."
        ),
    }
