"""The in-browser dispatcher must return exactly what the FastAPI server returns."""
import json

import pytest
from fastapi.testclient import TestClient

from app.browser import handle
from app.main import app

TENORS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def positions(client):
    return client.get("/api/portfolio/samples").json()["portfolios"]["intermediate"]["positions"]


def _strip(o):
    """Drop wall-clock fields that legitimately differ between two calls."""
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k not in {"generated_at_utc"}}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    return o


def _both(client, method, path, query="", body=None):
    url = path + (f"?{query}" if query else "")
    r = client.request(method, url, json=body)
    status, ctype, payload = handle(method, path, query, json.dumps(body) if body is not None else None)
    return r, status, ctype, payload


GETS = [
    ("/api/health", ""),
    ("/api/market/overview", ""),
    ("/api/curve", "date=2008-12-20"),
    ("/api/curve/compare", "date1=2024-09-17&date2=2024-12-31"),
    ("/api/curve/history", "tenors=2Y,10Y&start=2020-01-01"),
    ("/api/curve/dates", ""),
    ("/api/scenarios/presets", ""),
    ("/api/policy/config", ""),
    ("/api/history/events", ""),
    ("/api/history/events/taper_2013", "start=2013-05-01"),
    ("/api/history/policy-changes", "start=2020-01-01"),
    ("/api/macro/dashboard", "x=cpi_yoy&y=ust_2y&start=2000-01-01&window=24&lag=3&horizon=6"),
    ("/api/macro/correlations", "start=2010-01-01"),
    ("/api/portfolio/samples", ""),
    ("/api/data/status", ""),
]


@pytest.mark.parametrize("path,query", GETS)
def test_get_parity(client, path, query):
    r, status, ctype, payload = _both(client, "GET", path, query)
    assert status == r.status_code == 200
    assert _strip(json.loads(payload)) == _strip(r.json())


def test_post_parity(client, positions):
    bodies = [
        ("/api/portfolio/analyze", {"positions": positions}),
        ("/api/portfolio/scenario", {"positions": positions, "shocks_bp": {t: 25 for t in TENORS}}),
        ("/api/portfolio/stress", {"positions": positions}),
        ("/api/policy/simulate", {"policy_move_bp": -50, "interpretation": "dovish_surprise", "positions": positions}),
        ("/api/history/apply", {"event_id": "easing_2024", "portfolios": {"Mine": positions}}),
        ("/api/optimize", {"objective": "min_concentration", "target_duration": 6}),
        ("/api/bond/analyze", {"maturity": "2036-05-15", "coupon_pct": 4.25, "settlement": "2026-11-16", "ytm_pct": 5}),
        ("/api/scenarios/shape", {"kind": "preset", "preset": "bear_flattener"}),
        ("/api/report/brief", {"positions": positions, "shocks_bp": {"10Y": 25}}),
    ]
    for path, body in bodies:
        r, status, ctype, payload = _both(client, "POST", path, body=body)
        assert status == r.status_code == 200, path
        assert _strip(json.loads(payload)) == _strip(r.json()), path


def test_error_parity(client, positions):
    cases = [
        ("GET", "/api/curve", "date=1970-01-01", None, 404),
        ("GET", "/api/history/events/nope", "", None, 404),
        ("GET", "/api/nope", "", None, 404),
        ("POST", "/api/portfolio/analyze", "", {"positions": []}, 422),
        ("POST", "/api/portfolio/analyze", "", {"positions": [dict(positions[0], maturity="2020-01-01")]}, 422),
        ("POST", "/api/policy/simulate", "", {"policy_move_bp": 25, "interpretation": "nope", "positions": positions}, 422),
        ("GET", "/api/macro/dashboard", "window=2", None, 422),
    ]
    for method, path, query, body, code in cases:
        r, status, _, payload = _both(client, method, path, query, body)
        assert status == r.status_code == code, (path, status, r.status_code)
        assert "detail" in json.loads(payload)


def test_pdf_bytes(client, positions):
    status, ctype, payload = handle("POST", "/api/report/pdf", "", json.dumps({"positions": positions, "shocks_bp": {"2Y": -25}}))
    assert status == 200 and ctype == "application/pdf" and payload[:4] == b"%PDF"
