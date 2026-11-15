"""Raw data ingestion from official public sources.

Each function returns a normalized pandas object plus no side effects; caching
and fallback policy live in :mod:`app.data.store`.

Sources
-------
* U.S. Department of the Treasury, "Daily Treasury Par Yield Curve Rates"
  https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve
  Yields are par yields on a bond-equivalent (semiannual) basis, in percent,
  derived by Treasury from indicative bid-side prices of on-the-run securities.
* Federal Reserve Bank of St. Louis, FRED. https://fred.stlouisfed.org
"""
from __future__ import annotations

import io
from datetime import date

import httpx
import pandas as pd

from app.config import settings

TREASURY_CSV_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
    "&field_tdr_date_value={year}&page&_format=csv"
)
TREASURY_SOURCE_PAGE = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "TextView?type=daily_treasury_yield_curve"
)
FRED_GRAPH_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
FRED_API_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES_PAGE = "https://fred.stlouisfed.org/series/{series_id}"

# Canonical tenor labels used throughout the application, with year fractions.
TENORS: list[str] = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]
TENOR_YEARS: dict[str, float] = {
    "1M": 1 / 12, "3M": 0.25, "6M": 0.5, "1Y": 1.0, "2Y": 2.0, "3Y": 3.0,
    "5Y": 5.0, "7Y": 7.0, "10Y": 10.0, "20Y": 20.0, "30Y": 30.0,
}

# Treasury CSV column header -> canonical tenor. Columns not listed (2M, 4M,
# 1.5M) are published but intentionally not used so that the tenor set is
# stable across the full history.
_TREASURY_COLUMN_MAP = {
    "1 Mo": "1M", "3 Mo": "3M", "6 Mo": "6M", "1 Yr": "1Y", "2 Yr": "2Y", "3 Yr": "3Y",
    "5 Yr": "5Y", "7 Yr": "7Y", "10 Yr": "10Y", "20 Yr": "20Y", "30 Yr": "30Y",
}

# FRED constant-maturity series that mirror the Treasury par curve (used only as
# a secondary source if Treasury's site is unavailable).
FRED_CMT_SERIES = {
    "1M": "DGS1MO", "3M": "DGS3MO", "6M": "DGS6MO", "1Y": "DGS1", "2Y": "DGS2", "3Y": "DGS3",
    "5Y": "DGS5", "7Y": "DGS7", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30",
}

# Macro / policy series used by the application.
FRED_SERIES_META: dict[str, dict[str, str]] = {
    "DFEDTARU": {"name": "Federal Funds Target Range - Upper Limit", "units": "percent", "freq": "daily"},
    "DFEDTARL": {"name": "Federal Funds Target Range - Lower Limit", "units": "percent", "freq": "daily"},
    "DFEDTAR": {"name": "Federal Funds Target Rate (discontinued 2008-12-15)", "units": "percent", "freq": "daily"},
    "DFF": {"name": "Federal Funds Effective Rate", "units": "percent", "freq": "daily"},
    "CPIAUCSL": {"name": "CPI for All Urban Consumers: All Items (SA)", "units": "index 1982-84=100", "freq": "monthly"},
    "PCEPILFE": {"name": "PCE Price Index Excluding Food and Energy (Core PCE, SA)", "units": "index 2017=100", "freq": "monthly"},
    "UNRATE": {"name": "Unemployment Rate (SA)", "units": "percent", "freq": "monthly"},
    "DGS3MO": {"name": "3-Month Treasury CMT", "units": "percent", "freq": "daily"},
    "DGS2": {"name": "2-Year Treasury CMT", "units": "percent", "freq": "daily"},
    "DGS10": {"name": "10-Year Treasury CMT", "units": "percent", "freq": "daily"},
    "T10Y2Y": {"name": "10-Year minus 2-Year Treasury CMT", "units": "percentage points", "freq": "daily"},
    "T10Y3M": {"name": "10-Year minus 3-Month Treasury CMT", "units": "percentage points", "freq": "daily"},
}


class DataSourceError(RuntimeError):
    """Raised when an external source cannot be reached or returns invalid data."""


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=settings.http_timeout,
        headers={"User-Agent": "monetary-research-terminal/1.0 (open-source research tool)"},
        follow_redirects=True,
    )


def parse_treasury_csv(text: str) -> pd.DataFrame:
    """Parse one Treasury par-yield CSV into a DataFrame indexed by date.

    Values are percent (e.g. 4.25 = 4.25%). Tenors absent for the period
    (e.g. 20Y before 1993-10, 30Y between 2002-02 and 2006-02, 1M before
    2001-07) are left as NaN -- they are never filled.
    """
    raw = pd.read_csv(io.StringIO(text))
    if "Date" not in raw.columns:
        raise DataSourceError("Treasury CSV missing 'Date' column")
    out = pd.DataFrame(index=pd.to_datetime(raw["Date"], format="%m/%d/%Y"))
    out.index.name = "date"
    for col, tenor in _TREASURY_COLUMN_MAP.items():
        out[tenor] = pd.to_numeric(raw[col], errors="coerce").to_numpy() if col in raw.columns else float("nan")
    out = out[TENORS].sort_index()
    out = out[~out.index.duplicated(keep="last")]
    _validate_yields(out)
    return out


def _validate_yields(df: pd.DataFrame) -> None:
    vals = df.to_numpy(dtype=float)
    finite = vals[~pd.isna(vals)]
    if finite.size and (finite.min() < -5 or finite.max() > 30):
        raise DataSourceError("Treasury yields outside plausible range [-5%, 30%] - refusing to ingest")


def fetch_treasury_year(year: int) -> pd.DataFrame:
    url = TREASURY_CSV_URL.format(year=year)
    try:
        with _client() as c:
            r = c.get(url)
            r.raise_for_status()
    except httpx.HTTPError as exc:  # pragma: no cover - network
        raise DataSourceError(f"Treasury request failed for {year}: {exc}") from exc
    if not r.text.strip() or "Date" not in r.text[:200]:
        raise DataSourceError(f"Treasury returned no CSV data for {year}")
    return parse_treasury_csv(r.text)


def fetch_treasury_range(start_year: int, end_year: int | None = None) -> pd.DataFrame:
    end_year = end_year or date.today().year
    frames = [fetch_treasury_year(y) for y in range(start_year, end_year + 1)]
    df = pd.concat(frames).sort_index()
    return df[~df.index.duplicated(keep="last")]


def parse_fred_csv(text: str, series_id: str) -> pd.Series:
    raw = pd.read_csv(io.StringIO(text))
    date_col = "observation_date" if "observation_date" in raw.columns else raw.columns[0]
    if series_id not in raw.columns:
        raise DataSourceError(f"FRED CSV for {series_id} missing value column")
    s = pd.Series(
        pd.to_numeric(raw[series_id], errors="coerce").to_numpy(),
        index=pd.to_datetime(raw[date_col]),
        name=series_id,
    )
    s.index.name = "date"
    return s.dropna().sort_index()


def fetch_fred_series(series_id: str) -> pd.Series:
    """Fetch a full FRED series. Missing observations ('.') are dropped, never filled."""
    try:
        with _client() as c:
            if settings.fred_api_key:
                r = c.get(
                    FRED_API_URL,
                    params={"series_id": series_id, "api_key": settings.fred_api_key, "file_type": "json"},
                )
                r.raise_for_status()
                obs = r.json()["observations"]
                s = pd.Series(
                    pd.to_numeric([o["value"] for o in obs], errors="coerce"),
                    index=pd.to_datetime([o["date"] for o in obs]),
                    name=series_id,
                )
                s.index.name = "date"
                return s.dropna().sort_index()
            r = c.get(FRED_GRAPH_CSV_URL.format(series_id=series_id))
            r.raise_for_status()
    except (httpx.HTTPError, KeyError, ValueError) as exc:  # pragma: no cover - network
        raise DataSourceError(f"FRED request failed for {series_id}: {exc}") from exc
    return parse_fred_csv(r.text, series_id)
