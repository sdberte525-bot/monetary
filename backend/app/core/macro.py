"""Macro / monetary research dashboard analytics.

Alignment rules (documented, deterministic):
* Daily series (yields, spreads, effective fed funds) are converted to MONTHLY
  AVERAGES of available daily observations, indexed to the first of the month.
* Inflation is the 12-month percent change of the seasonally adjusted price
  index (CPIAUCSL, PCEPILFE): 100 * (I_t / I_{t-12} - 1).
* Monthly macro data are indexed by the reference month, not the release date.
  CPI/PCE/unemployment are published with a lag of roughly 2-6 weeks, so a
  contemporaneous correlation uses information not available in real time at
  the start of the month. The optional ``lag_months`` shifts the indicator
  forward (indicator at t - lag vs. yield at t) to study lead/lag relations.

Correlation is descriptive. It does not establish causation, and monthly
macro/yield series are highly autocorrelated, so conventional significance
tests on levels are unreliable (spurious-regression problem, Granger & Newbold
1974). We report the number of observations, not p-values.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from app.data.store import MarketDataStore

INDICATORS: dict[str, dict] = {
    "fed_funds": {"label": "Effective federal funds rate", "units": "%", "series": "DFF", "transform": "monthly_avg"},
    "fed_target_upper": {"label": "Fed target (upper bound / point target)", "units": "%", "series": "TARGET", "transform": "monthly_last"},
    "cpi_yoy": {"label": "CPI inflation (YoY)", "units": "%", "series": "CPIAUCSL", "transform": "yoy"},
    "core_pce_yoy": {"label": "Core PCE inflation (YoY)", "units": "%", "series": "PCEPILFE", "transform": "yoy"},
    "unemployment": {"label": "Unemployment rate", "units": "%", "series": "UNRATE", "transform": "level"},
    "ust_3m": {"label": "3-Month Treasury (CMT)", "units": "%", "series": "DGS3MO", "transform": "monthly_avg"},
    "ust_2y": {"label": "2-Year Treasury (CMT)", "units": "%", "series": "DGS2", "transform": "monthly_avg"},
    "ust_10y": {"label": "10-Year Treasury (CMT)", "units": "%", "series": "DGS10", "transform": "monthly_avg"},
    "spread_10y2y": {"label": "10Y - 2Y spread", "units": "pp", "series": "T10Y2Y", "transform": "monthly_avg"},
    "spread_10y3m": {"label": "10Y - 3M spread", "units": "pp", "series": "T10Y3M", "transform": "monthly_avg"},
}


def _target_series(store: MarketDataStore) -> pd.Series:
    old = store.series("DFEDTAR")
    new = store.series("DFEDTARU")
    return pd.concat([old[old.index < new.index.min()], new]).sort_index()


def monthly_indicator(store: MarketDataStore, key: str) -> pd.Series:
    meta = INDICATORS[key]
    s = _target_series(store) if meta["series"] == "TARGET" else store.series(meta["series"])
    tr = meta["transform"]
    if tr == "monthly_avg":
        out = s.resample("MS").mean()
    elif tr == "monthly_last":
        out = s.resample("MS").last()
    elif tr == "yoy":
        m = s.resample("MS").last()
        out = (m / m.shift(12) - 1.0) * 100.0
        # require exactly 12 calendar months between observations
        out = out[m.index.to_series().diff(12).dt.days.between(334, 366)]
    else:
        out = s.resample("MS").last()
    out.name = key
    return out.dropna()


def describe(s: pd.Series) -> dict:
    if s.empty:
        return {"n": 0}
    return {
        "n": int(s.size), "mean": float(s.mean()), "std": float(s.std(ddof=1)) if s.size > 1 else None,
        "min": float(s.min()), "p25": float(s.quantile(0.25)), "median": float(s.median()),
        "p75": float(s.quantile(0.75)), "max": float(s.max()), "last": float(s.iloc[-1]),
        "last_date": s.index[-1].strftime("%Y-%m-%d"), "first_date": s.index[0].strftime("%Y-%m-%d"),
    }


def dashboard(
    store: MarketDataStore,
    x_key: str,
    y_key: str,
    start: date | None,
    end: date | None,
    window: int = 36,
    lag_months: int = 0,
    change_horizon: int = 12,
) -> dict:
    for k in (x_key, y_key):
        if k not in INDICATORS:
            raise ValueError(f"unknown indicator {k!r}")
    if window < 6 or window > 240:
        raise ValueError("rolling window must be between 6 and 240 months")
    if not 0 <= lag_months <= 24:
        raise ValueError("lag must be between 0 and 24 months")
    x = monthly_indicator(store, x_key).shift(lag_months, freq="MS")
    y = monthly_indicator(store, y_key)
    df = pd.concat([x.rename("x"), y.rename("y")], axis=1, join="inner").dropna()
    if start:
        df = df[df.index >= pd.Timestamp(start)]
    if end:
        df = df[df.index <= pd.Timestamp(end)]
    if len(df) < 12:
        raise ValueError("fewer than 12 overlapping monthly observations in the selected range")
    dx = df["x"].diff(change_horizon)
    dy = df["y"].diff(change_horizon)
    ch = pd.concat([dx, dy], axis=1).dropna()
    roll = df["x"].rolling(window).corr(df["y"]).dropna()
    roll_ch = dx.rolling(window).corr(dy).dropna()
    return {
        "x": {"key": x_key, **INDICATORS[x_key], "stats": describe(df["x"]), "lag_months": lag_months},
        "y": {"key": y_key, **INDICATORS[y_key], "stats": describe(df["y"])},
        "observations": [
            {"date": ix.strftime("%Y-%m-%d"), "x": float(r.x), "y": float(r.y)} for ix, r in df.iterrows()
        ],
        "correlation_levels": float(df["x"].corr(df["y"])),
        "correlation_changes": float(ch.iloc[:, 0].corr(ch.iloc[:, 1])) if len(ch) > 2 else None,
        "change_horizon_months": change_horizon,
        "n_levels": int(len(df)),
        "n_changes": int(len(ch)),
        "rolling_window_months": window,
        "rolling_correlation_levels": [{"date": i.strftime("%Y-%m-%d"), "value": float(v)} for i, v in roll.items()],
        "rolling_correlation_changes": [{"date": i.strftime("%Y-%m-%d"), "value": float(v)} for i, v in roll_ch.items()],
        "methodology": [
            "Daily series converted to monthly averages; inflation = 12-month % change of SA index.",
            "Monthly macro data are indexed to the reference month, not the release date (release lags of ~2-6 weeks).",
            f"Change correlation uses {change_horizon}-month changes (overlapping), which are autocorrelated.",
            "Correlation is descriptive and does not establish causation; no p-values reported because the series are persistent.",
        ],
    }


def overview_series(store: MarketDataStore, start: date | None = None) -> dict:
    """All indicators on one monthly grid for the multi-line dashboard chart."""
    frames = {k: monthly_indicator(store, k) for k in INDICATORS}
    df = pd.concat(frames, axis=1)
    if start:
        df = df[df.index >= pd.Timestamp(start)]
    rows = []
    for ix, r in df.iterrows():
        rows.append({"date": ix.strftime("%Y-%m-%d"), **{k: (None if pd.isna(v) else round(float(v), 4)) for k, v in r.items()}})
    latest = {k: describe(frames[k]) for k in INDICATORS}
    return {"rows": rows, "latest": latest, "indicators": INDICATORS}


def correlation_matrix(store: MarketDataStore, keys: list[str], start: date | None, end: date | None) -> dict:
    df = pd.concat({k: monthly_indicator(store, k) for k in keys}, axis=1).dropna()
    if start:
        df = df[df.index >= pd.Timestamp(start)]
    if end:
        df = df[df.index <= pd.Timestamp(end)]
    c = df.corr()
    return {"keys": keys, "matrix": np.round(c.to_numpy(), 4).tolist(), "n": int(len(df))}
