"""Runtime configuration, read from environment variables.

Environment variables
---------------------
MONETARY_DATA_MODE   "auto" (default) | "live" | "snapshot"
    auto     -> try official sources, fall back to the bundled snapshot (labeled)
    live     -> official sources only; errors propagate if unavailable
    snapshot -> never touch the network; bundled historical snapshot only
FRED_API_KEY         optional. If set, FRED's JSON API is used; otherwise the
                     keyless fredgraph.csv endpoint is used.
MONETARY_HTTP_TIMEOUT  seconds per HTTP request (default 20)
MONETARY_CORS_ORIGINS  comma-separated list of allowed frontend origins
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = BACKEND_ROOT / "data" / "snapshot"


def _csv_env(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [s.strip() for s in raw.split(",") if s.strip()]


@dataclass(frozen=True)
class Settings:
    data_mode: str = field(default_factory=lambda: os.environ.get("MONETARY_DATA_MODE", "auto").lower())
    fred_api_key: str | None = field(default_factory=lambda: os.environ.get("FRED_API_KEY") or None)
    http_timeout: float = field(default_factory=lambda: float(os.environ.get("MONETARY_HTTP_TIMEOUT", "20")))
    cors_origins: list[str] = field(
        default_factory=lambda: _csv_env(
            "MONETARY_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        )
    )
    # In-memory cache refresh intervals (seconds) per source. Treasury publishes the daily par
    # curve once per business day (~ after 3:30pm ET); FRED macro series are
    # monthly. We do not need to poll more often than this.
    ttl_treasury: int = 6 * 3600
    ttl_fred_daily: int = 6 * 3600
    ttl_fred_monthly: int = 24 * 3600

    def __post_init__(self) -> None:
        if self.data_mode not in {"auto", "live", "snapshot"}:
            raise ValueError(f"MONETARY_DATA_MODE must be auto|live|snapshot, got {self.data_mode!r}")


settings = Settings()
