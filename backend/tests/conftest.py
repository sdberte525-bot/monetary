import os

# Tests never touch the network: they run against the bundled official-data snapshot.
os.environ["MONETARY_DATA_MODE"] = "snapshot"

import pytest  # noqa: E402

from app.data.store import MarketDataStore  # noqa: E402


@pytest.fixture(scope="session")
def store() -> MarketDataStore:
    return MarketDataStore()
