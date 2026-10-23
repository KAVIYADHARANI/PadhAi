"""Tests for health check endpoint."""

from fastapi.testclient import TestClient

from app.core.config import settings


def test_health_check_requires_no_auth(client: TestClient):
    """Assert /health requires no auth and returns ok status with brand names."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["product"] == settings.PRODUCT_NAME
    assert data["mascot"] == settings.MASCOT_NAME
