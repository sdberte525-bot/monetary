"""Build the bundled historical data snapshot used in snapshot/demo mode.

Downloads official data and writes it, unmodified apart from column
normalization, to backend/data/snapshot/:

    treasury_par_curve.csv   daily par yields (percent), 1990 -> latest
    fred_<SERIES>.csv        one file per FRED series
    metadata.json            retrieval timestamp, source URLs, last observation dates

Usage:  python -m scripts.build_snapshot  [--start-year 1990]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import SNAPSHOT_DIR  # noqa: E402
from app.data import sources  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=1990)
    args = ap.parse_args()
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta: dict = {"retrieved_at_utc": retrieved, "series": {}}

    print("Treasury par yield curve ...", flush=True)
    curve = sources.fetch_treasury_range(args.start_year)
    curve.to_csv(SNAPSHOT_DIR / "treasury_par_curve.csv", float_format="%.2f", date_format="%Y-%m-%d")
    meta["treasury_par_curve"] = {
        "source": "U.S. Department of the Treasury - Daily Treasury Par Yield Curve Rates",
        "url": sources.TREASURY_SOURCE_PAGE,
        "first_date": curve.index.min().strftime("%Y-%m-%d"),
        "last_date": curve.index.max().strftime("%Y-%m-%d"),
        "rows": int(len(curve)),
        "units": "percent, bond-equivalent (semiannual) par yield",
    }

    for sid, info in sources.FRED_SERIES_META.items():
        print(f"FRED {sid} ...", flush=True)
        s = sources.fetch_fred_series(sid)
        s.to_csv(SNAPSHOT_DIR / f"fred_{sid}.csv", header=[sid], date_format="%Y-%m-%d")
        meta["series"][sid] = {
            **info,
            "source": "Federal Reserve Bank of St. Louis, FRED",
            "url": sources.FRED_SERIES_PAGE.format(series_id=sid),
            "first_date": s.index.min().strftime("%Y-%m-%d"),
            "last_date": s.index.max().strftime("%Y-%m-%d"),
            "rows": int(len(s)),
        }

    (SNAPSHOT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k: v for k, v in meta.items() if k != "series"}, indent=2))


if __name__ == "__main__":
    main()
