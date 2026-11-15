"""End-to-end API tests (snapshot data, no network)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

TENORS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def positions(client):
    return client.get("/api/portfolio/samples").json()["portfolios"]["intermediate"]["positions"]


def test_overview_labels_snapshot(client):
    j = client.get("/api/market/overview").json()
    assert j["provenance"]["treasury"]["mode"] == "snapshot"
    assert set(j["curve"]["par_pct"]) == set(TENORS)
    assert j["policy"]["upper"] - j["policy"]["lower"] == pytest.approx(0.25)


def test_scenario_endpoint(client, positions):
    j = client.post("/api/portfolio/scenario", json={"positions": positions, "shocks_bp": {t: 50 for t in TENORS}}).json()
    assert j["totals"]["pnl_full"] < 0
    assert j["commentary"] and j["provenance"]["mode"] == "snapshot"


def test_custom_curve_is_labeled_user(client, positions):
    j = client.post("/api/portfolio/analyze", json={
        "positions": positions, "curve": {"custom_par_pct": {t: 4.0 for t in TENORS}}}).json()
    assert j["provenance"]["mode"] == "user"


def test_policy_simulation(client, positions):
    j = client.post("/api/policy/simulate", json={
        "policy_move_bp": -50, "interpretation": "expected", "positions": positions}).json()
    assert j["translation"]["surprise_bp"] == 0
    assert all(v == 0 for v in j["translation"]["shocks_bp"].values())
    j = client.post("/api/policy/simulate", json={
        "policy_move_bp": 50, "interpretation": "hawkish_surprise", "positions": positions,
        "pass_through": {"10Y": 0.1}}).json()
    assert j["scenario"]["totals"]["pnl_full"] < 0
    assert j["translation"]["loadings"]["pass_through"]["10Y"] == 0.1
    assert any("not a forecast" in j["translation"]["disclaimer"] for _ in [0])


def test_validation_errors(client, positions):
    assert client.post("/api/portfolio/analyze", json={"positions": []}).status_code == 422
    bad = dict(positions[0], coupon_pct=-1)
    assert client.post("/api/portfolio/analyze", json={"positions": [bad]}).status_code == 422
    dup = [positions[0], positions[0]]
    assert client.post("/api/portfolio/analyze", json={"positions": dup}).status_code == 422
    assert client.post("/api/policy/simulate", json={"policy_move_bp": 25, "interpretation": "nope",
                                                     "positions": positions}).status_code == 422
    assert client.get("/api/history/events/nope").status_code == 404
    assert client.get("/api/curve?date=1970-01-01").status_code == 404


def test_history_and_optimizer(client, positions):
    j = client.post("/api/history/apply", json={"event_id": "covid_2020", "portfolios": {"Mine": positions}}).json()
    assert "Mine" in j["hypothetical"]["results"]
    assert j["observed"]["policy_change_bp"] == -150
    j = client.post("/api/optimize", json={"objective": "min_concentration", "target_duration": 5}).json()
    assert j["status"] == "optimal"


def test_pdf_report(client, positions):
    r = client.post("/api/report/pdf", json={"positions": positions, "shocks_bp": {"10Y": 25}})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    j = client.post("/api/report/brief", json={"positions": positions, "shocks_bp": {"10Y": 25}}).json()
    assert {"market_environment", "limitations", "implications", "sources"} <= set(j["sections"])


def test_stress_grid_signs(client, positions):
    j = client.post("/api/portfolio/stress", json={"positions": positions}).json()
    by = {r["key"]: r for r in j["rows"]}
    assert by["parallel_p100"]["pnl_full"] < 0 < by["parallel_m100"]["pnl_full"]
    # convexity: symmetric shocks are asymmetric in P&L
    assert by["parallel_m100"]["pnl_full"] > -by["parallel_p100"]["pnl_full"]
    assert j["provenance"]["mode"] == "snapshot"


def test_pdf_is_single_page_for_samples(client):
    samples = client.get("/api/portfolio/samples").json()["portfolios"]
    for key in ("ladder", "barbell"):
        r = client.post("/api/report/pdf", json={"positions": samples[key]["positions"],
                                                 "policy": {"policy_move_bp": -50, "interpretation": "recession_shock"}})
        import re
        assert len(re.findall(rb"/Type\s*/Page(?!s)", r.content)) == 1
