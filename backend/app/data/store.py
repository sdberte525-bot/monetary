"""Market data store: normalization, caching, refresh policy and provenance.

Policy
------
* The bundled snapshot (real official data, retrieved at a recorded time) is
  always loaded first so the app works offline.
* In ``auto``/``live`` mode, recent data are refreshed from the official source
  when the source-specific TTL has expired. Refreshed observations are merged
  over the snapshot; older history is unchanged.
* If a refresh fails in ``auto`` mode, the snapshot remains in use and every
  response carries ``mode='snapshot'`` with the failure reason. Snapshot data
  are never labeled live.
* Missing observations are never filled. Date lookups use the last
  observation ON OR BEFORE the requested date (no look-ahead).
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone

import pandas as pd

from app.config import SNAPSHOT_DIR, Settings, settings
from app.core.curve import ParCurve
from app.data import sources
from app.data.sources import TENORS, DataSourceError

log = logging.getLogger("monetary.data")


@dataclass
class Provenance:
    source: str
    url: str
    mode: str  # "live" | "snapshot"
    retrieved_at_utc: str
    last_observation: str | None
    note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class DataUnavailable(LookupError):
    pass


class MarketDataStore:
    def __init__(self, cfg: Settings = settings, snapshot_dir=SNAPSHOT_DIR) -> None:
        self.cfg = cfg
        self.snapshot_dir = snapshot_dir
        self._lock = threading.RLock()
        meta_path = snapshot_dir / "metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError(f"snapshot metadata missing at {meta_path}; run scripts/build_snapshot.py")
        self.snapshot_meta = json.loads(meta_path.read_text())
        self._curve = self._load_curve_csv(snapshot_dir / "treasury_par_curve.csv")
        snap_ts = self.snapshot_meta["retrieved_at_utc"]
        self._curve_prov = Provenance(
            source="U.S. Department of the Treasury - Daily Treasury Par Yield Curve Rates",
            url=sources.TREASURY_SOURCE_PAGE,
            mode="snapshot",
            retrieved_at_utc=snap_ts,
            last_observation=self._curve.index.max().strftime("%Y-%m-%d"),
            note="Bundled historical snapshot of official data (not live).",
        )
        self._curve_checked = 0.0
        self._series: dict[str, pd.Series] = {}
        self._series_prov: dict[str, Provenance] = {}
        self._series_checked: dict[str, float] = {}
        for sid in sources.FRED_SERIES_META:
            path = snapshot_dir / f"fred_{sid}.csv"
            if path.exists():
                s = pd.read_csv(path, index_col=0, parse_dates=True).iloc[:, 0].dropna().sort_index()
                s.name = sid
                self._series[sid] = s
                self._series_prov[sid] = Provenance(
                    source=f"FRED, Federal Reserve Bank of St. Louis ({sid})",
                    url=sources.FRED_SERIES_PAGE.format(series_id=sid),
                    mode="snapshot",
                    retrieved_at_utc=snap_ts,
                    last_observation=s.index.max().strftime("%Y-%m-%d"),
                    note="Bundled historical snapshot of official data (not live).",
                )
        self.last_errors: dict[str, str] = {}

    # ------------------------------------------------------------------ loading
    @staticmethod
    def _load_curve_csv(path) -> pd.DataFrame:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        df.index.name = "date"
        return df[TENORS].astype(float).sort_index()

    # ------------------------------------------------------------------ refresh
    def _should_refresh(self, last_checked: float, ttl: int) -> bool:
        return self.cfg.data_mode != "snapshot" and (time.time() - last_checked) > ttl

    def refresh_curve(self, force: bool = False) -> None:
        with self._lock:
            if not force and not self._should_refresh(self._curve_checked, self.cfg.ttl_treasury):
                return
            self._curve_checked = time.time()
            try:
                year = date.today().year
                last_snapshot_year = self._curve.index.max().year
                fresh = sources.fetch_treasury_range(min(year, last_snapshot_year), year)
                merged = pd.concat([self._curve[self._curve.index < fresh.index.min()], fresh]).sort_index()
                self._curve = merged[~merged.index.duplicated(keep="last")]
                self._curve_prov = Provenance(
                    source="U.S. Department of the Treasury - Daily Treasury Par Yield Curve Rates",
                    url=sources.TREASURY_SOURCE_PAGE,
                    mode="live",
                    retrieved_at_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    last_observation=self._curve.index.max().strftime("%Y-%m-%d"),
                    note=f"Observations from {fresh.index.min():%Y-%m-%d} downloaded live; earlier history from the bundled snapshot.",
                )
                self.last_errors.pop("treasury", None)
            except DataSourceError as exc:
                self.last_errors["treasury"] = str(exc)
                log.warning("treasury refresh failed: %s", exc)
                if self.cfg.data_mode == "live":
                    raise
                self._curve_prov.note = f"Live refresh failed ({exc}); using bundled snapshot (not live)."

    def refresh_series(self, sid: str, force: bool = False) -> None:
        meta = sources.FRED_SERIES_META.get(sid)
        if meta is None:
            raise KeyError(sid)
        ttl = self.cfg.ttl_fred_monthly if meta["freq"] == "monthly" else self.cfg.ttl_fred_daily
        with self._lock:
            if not force and not self._should_refresh(self._series_checked.get(sid, 0.0), ttl):
                return
            self._series_checked[sid] = time.time()
            try:
                s = sources.fetch_fred_series(sid)
                self._series[sid] = s
                self._series_prov[sid] = Provenance(
                    source=f"FRED, Federal Reserve Bank of St. Louis ({sid})",
                    url=sources.FRED_SERIES_PAGE.format(series_id=sid),
                    mode="live",
                    retrieved_at_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    last_observation=s.index.max().strftime("%Y-%m-%d"),
                )
                self.last_errors.pop(sid, None)
            except DataSourceError as exc:
                self.last_errors[sid] = str(exc)
                log.warning("FRED %s refresh failed: %s", sid, exc)
                if self.cfg.data_mode == "live":
                    raise
                if sid in self._series_prov:
                    self._series_prov[sid].note = f"Live refresh failed ({exc}); using bundled snapshot (not live)."

    # ------------------------------------------------------------------ curve access
    @property
    def curve_frame(self) -> pd.DataFrame:
        self.refresh_curve()
        return self._curve

    @property
    def curve_provenance(self) -> Provenance:
        return self._curve_prov

    def curve_dates(self) -> tuple[date, date]:
        df = self.curve_frame
        return df.index.min().date(), df.index.max().date()

    def resolve_curve_date(self, on: date | None) -> date:
        """Last observation date on or before ``on`` (latest if None). Never looks ahead."""
        df = self.curve_frame
        if on is None:
            return df.index.max().date()
        ts = pd.Timestamp(on)
        idx = df.index[df.index <= ts]
        if len(idx) == 0:
            raise DataUnavailable(f"no Treasury curve observation on or before {on}; data begin {df.index.min():%Y-%m-%d}")
        return idx.max().date()

    def curve_on(self, on: date | None = None) -> tuple[ParCurve, date]:
        d = self.resolve_curve_date(on)
        row = self.curve_frame.loc[pd.Timestamp(d)]
        vals = {t: (None if pd.isna(row[t]) else float(row[t])) for t in TENORS}
        return ParCurve.from_percent(vals, as_of=d.isoformat()), d

    def curve_row_pct(self, d: date) -> dict[str, float | None]:
        row = self.curve_frame.loc[pd.Timestamp(self.resolve_curve_date(d))]
        return {t: (None if pd.isna(row[t]) else float(row[t])) for t in TENORS}

    def curve_history(self, start: date | None, end: date | None, tenors: list[str]) -> pd.DataFrame:
        bad = [t for t in tenors if t not in TENORS]
        if bad:
            raise ValueError(f"unknown tenors {bad}")
        df = self.curve_frame
        if start:
            df = df[df.index >= pd.Timestamp(start)]
        if end:
            df = df[df.index <= pd.Timestamp(end)]
        return df[tenors]

    # ------------------------------------------------------------------ FRED access
    def series(self, sid: str) -> pd.Series:
        self.refresh_series(sid)
        if sid not in self._series:
            raise DataUnavailable(f"series {sid} unavailable (no snapshot and live fetch failed)")
        return self._series[sid]

    def series_provenance(self, sid: str) -> Provenance:
        self.series(sid)
        return self._series_prov[sid]

    def value_on(self, sid: str, on: date | None = None) -> tuple[float, date]:
        s = self.series(sid)
        if on is not None:
            s = s[s.index <= pd.Timestamp(on)]
        if s.empty:
            raise DataUnavailable(f"{sid}: no observation on or before {on}")
        return float(s.iloc[-1]), s.index[-1].date()

    def policy_range_on(self, on: date | None = None) -> dict:
        """Fed target: range (DFEDTARL/U) from 2008-12-16, point target (DFEDTAR) before."""
        u = self.series("DFEDTARU")
        if on is None or pd.Timestamp(on) >= u.index.min():
            lo, d = self.value_on("DFEDTARL", on)
            hi, _ = self.value_on("DFEDTARU", on)
            return {"lower": lo, "upper": hi, "as_of": d.isoformat(), "kind": "range",
                    "series": ["DFEDTARL", "DFEDTARU"]}
        t, d = self.value_on("DFEDTAR", on)
        return {"lower": t, "upper": t, "as_of": d.isoformat(), "kind": "point target", "series": ["DFEDTAR"]}

    def policy_changes(self) -> list[dict]:
        """Every change in the FOMC target, derived from FRED (effective dates)."""
        out = []
        old = self.series("DFEDTAR")
        d_old = old.diff()
        for ts, v in d_old[d_old != 0].dropna().items():
            out.append({"effective_date": ts.date().isoformat(), "lower": float(old[ts]), "upper": float(old[ts]),
                        "change_bp": round(float(v) * 100), "kind": "point target"})
        lo, hi = self.series("DFEDTARL"), self.series("DFEDTARU")
        d_hi = hi.diff()
        first = hi.index.min()
        prev_target = float(old[old.index < first].iloc[-1]) if (old.index < first).any() else None
        if prev_target is not None:
            out.append({"effective_date": first.date().isoformat(), "lower": float(lo[first]), "upper": float(hi[first]),
                        "change_bp": round((float(hi[first]) - prev_target) * 100), "kind": "range (introduced)"})
        for ts, v in d_hi[d_hi != 0].dropna().items():
            out.append({"effective_date": ts.date().isoformat(), "lower": float(lo[ts]), "upper": float(hi[ts]),
                        "change_bp": round(float(v) * 100), "kind": "range"})
        return out

    def status(self) -> dict:
        return {
            "data_mode": self.cfg.data_mode,
            "snapshot_retrieved_at_utc": self.snapshot_meta["retrieved_at_utc"],
            "treasury": self._curve_prov.to_dict(),
            "fred": {sid: p.to_dict() for sid, p in self._series_prov.items()},
            "errors": dict(self.last_errors),
        }


_store: MarketDataStore | None = None


def get_store() -> MarketDataStore:
    global _store
    if _store is None:
        _store = MarketDataStore()
    return _store
