"""Pytest configuration and test fixtures for PadhAI backend."""

import os
from collections.abc import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Force test configuration
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = "localhost:9099"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["STORAGE_LOCAL_DIR"] = "./test_storage"

from app.core.storage import LocalStorageBackend, get_storage
from app.db.session import Base, get_db
from app.main import app

# In-memory SQLite engine for tests
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session: Session, tmp_path) -> Generator[TestClient, None, None]:
    # Override database dependency
    def override_get_db():
        yield db_session

    # Override storage dependency to use temp directory
    test_storage = LocalStorageBackend(base_dir=str(tmp_path / "storage"))
    def override_get_storage():
        return test_storage

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_storage] = override_get_storage

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def mock_firebase_verify():
    """Mocks Firebase Admin verify_id_token for deterministic offline authentication tests."""
    def fake_verify_id_token(token: str, *args, **kwargs):
        if token == "token_user_1":
            return {
                "uid": "firebase_uid_1",
                "email": "user1@example.com",
                "name": "User One",
            }
        elif token == "token_user_2":
            return {
                "uid": "firebase_uid_2",
                "email": "user2@example.com",
                "name": "User Two",
            }
        raise ValueError("Invalid test Firebase token")

    with patch("firebase_admin.auth.verify_id_token", side_effect=fake_verify_id_token) as mock:
        yield mock


@pytest.fixture
def auth_headers_user1():
    return {"Authorization": "Bearer token_user_1"}


@pytest.fixture
def auth_headers_user2():
    return {"Authorization": "Bearer token_user_2"}
