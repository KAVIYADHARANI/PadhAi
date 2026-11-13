"""Tests for health check endpoint."""

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.db.session import get_db
from app.main import app


def test_health_check_requires_no_auth(client: TestClient):
    """Assert /health requires no auth and returns ok status with connected DB and brand names."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert data["product"] == settings.PRODUCT_NAME
    assert data["mascot"] == settings.MASCOT_NAME


def test_health_check_reports_disconnected_db(client: TestClient):
    """Assert /health never fakes database connectivity when SELECT 1 fails."""
    class _BrokenSession:
        def execute(self, *_args, **_kwargs):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def override_broken_db() -> Generator[_BrokenSession, None, None]:
        yield _BrokenSession()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_broken_db
    try:
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["database"] == "disconnected"
    finally:
        if previous_override is not None:
            app.dependency_overrides[get_db] = previous_override
        else:
            app.dependency_overrides.pop(get_db, None)
