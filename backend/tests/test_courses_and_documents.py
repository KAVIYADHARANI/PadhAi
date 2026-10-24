"""Comprehensive tests for courses, documents, upload validation, and cross-user isolation."""

import io

from fastapi.testclient import TestClient

from app.core.config import settings


def test_routes_require_authentication(client: TestClient):
    """All API routes except /health must reject unauthenticated requests."""
    assert client.get("/api/courses").status_code == 401
    assert client.post("/api/courses", json={"name": "Test"}).status_code == 401
    assert client.get("/api/documents/1").status_code == 401
    assert client.delete("/api/courses/1").status_code == 401


def test_course_creation_and_isolation(
    client: TestClient,
    auth_headers_user1: dict,
    auth_headers_user2: dict,
):
    """Verify that User 1 creates a course and User 2 cannot see it."""
    # User 1 creates course
    res = client.post(
        "/api/courses",
        headers=auth_headers_user1,
        json={"name": "Organic Chemistry", "goal_days": 45, "hours_per_day": 2.0, "level": "intermediate"},
    )
    assert res.status_code == 201
    user1_course = res.json()
    assert user1_course["name"] == "Organic Chemistry"
    assert user1_course["goal_days"] == 45
    course_id = user1_course["id"]

    # User 1 lists courses: sees 1 course
    res_list1 = client.get("/api/courses", headers=auth_headers_user1)
    assert res_list1.status_code == 200
    assert len(res_list1.json()) == 1
    assert res_list1.json()[0]["id"] == course_id

    # User 2 lists courses: sees 0 courses (strict isolation)
    res_list2 = client.get("/api/courses", headers=auth_headers_user2)
    assert res_list2.status_code == 200
    assert len(res_list2.json()) == 0


def test_cross_user_document_and_course_actions_prevented(
    client: TestClient,
    auth_headers_user1: dict,
    auth_headers_user2: dict,
):
    """Assert User 2 cannot upload to, view, or delete User 1's course or documents."""
    # 1. User 1 creates course
    res_course = client.post(
        "/api/courses",
        headers=auth_headers_user1,
        json={"name": "Linear Algebra"},
    )
    course_id = res_course.json()["id"]

    # 2. User 1 uploads valid document
    file_content = b"%PDF-1.4 simulated pdf document content"
    files = {"file": ("algebra_notes.pdf", io.BytesIO(file_content), "application/pdf")}
    res_upload = client.post(
        f"/api/courses/{course_id}/documents",
        headers=auth_headers_user1,
        files=files,
    )
    assert res_upload.status_code == 201
    doc_id = res_upload.json()["id"]
    assert res_upload.json()["status"] == "queued"

    # 3. User 2 attempts to upload document to User 1's course -> 404
    fake_upload = {"file": ("hacked.pdf", io.BytesIO(file_content), "application/pdf")}
    res_cross_upload = client.post(
        f"/api/courses/{course_id}/documents",
        headers=auth_headers_user2,
        files=fake_upload,
    )
    assert res_cross_upload.status_code == 404
    assert res_cross_upload.json()["detail"] == "Course not found"

    # 4. User 2 attempts to view User 1's document -> 404
    res_cross_view = client.get(
        f"/api/documents/{doc_id}",
        headers=auth_headers_user2,
    )
    assert res_cross_view.status_code == 404
    assert res_cross_view.json()["detail"] == "Document not found"

    # User 1 can view their own document -> 200
    res_own_view = client.get(
        f"/api/documents/{doc_id}",
        headers=auth_headers_user1,
    )
    assert res_own_view.status_code == 200
    assert res_own_view.json()["id"] == doc_id
    assert res_own_view.json()["status"] == "queued"

    # 5. User 2 attempts to delete User 1's course -> 404
    res_cross_delete = client.delete(
        f"/api/courses/{course_id}",
        headers=auth_headers_user2,
    )
    assert res_cross_delete.status_code == 404
    assert res_cross_delete.json()["detail"] == "Course not found"

    # 6. User 1 successfully deletes own course -> 204
    res_delete = client.delete(
        f"/api/courses/{course_id}",
        headers=auth_headers_user1,
    )
    assert res_delete.status_code == 204

    # Verify course and document are gone for User 1
    assert client.get(f"/api/documents/{doc_id}", headers=auth_headers_user1).status_code == 404


def test_upload_validations(
    client: TestClient,
    auth_headers_user1: dict,
):
    """Validate bad extensions, bad MIME types, empty files, and oversized uploads."""
    # Create course
    course = client.post("/api/courses", headers=auth_headers_user1, json={"name": "Validation Test"}).json()
    course_id = course["id"]

    # 1. Invalid extension
    bad_ext_file = {"file": ("malicious.exe", io.BytesIO(b"binary"), "application/pdf")}
    res_bad_ext = client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=bad_ext_file)
    assert res_bad_ext.status_code == 400
    assert "Unsupported file extension" in res_bad_ext.json()["detail"]

    # 2. Invalid MIME type
    bad_mime_file = {"file": ("notes.pdf", io.BytesIO(b"content"), "text/plain")}
    res_bad_mime = client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=bad_mime_file)
    assert res_bad_mime.status_code == 400
    assert "Unsupported MIME type" in res_bad_mime.json()["detail"]

    # 3. Empty file
    empty_file = {"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")}
    res_empty = client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=empty_file)
    assert res_empty.status_code == 400
    assert "Uploaded file is empty" in res_empty.json()["detail"]

    # 4. Oversized file
    oversized_data = b"0" * ((settings.MAX_UPLOAD_MB * 1024 * 1024) + 100)
    big_file = {"file": ("huge.pdf", io.BytesIO(oversized_data), "application/pdf")}
    res_big = client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=big_file)
    assert res_big.status_code == 413
    assert "exceeds maximum size limit" in res_big.json()["detail"]


def test_list_course_documents_and_isolation(
    client: TestClient,
    auth_headers_user1: dict,
    auth_headers_user2: dict,
):
    """Test GET /api/courses/{course_id}/documents returns course docs with safe metadata and enforces user isolation."""
    # 1. User 1 creates course
    res_course = client.post("/api/courses", headers=auth_headers_user1, json={"name": "Quantum Physics"})
    course_id = res_course.json()["id"]

    # 2. Before upload, documents list is empty
    res_empty_list = client.get(f"/api/courses/{course_id}/documents", headers=auth_headers_user1)
    assert res_empty_list.status_code == 200
    assert res_empty_list.json() == []

    # 3. User 1 uploads 2 documents
    file1 = {"file": ("lecture1.pdf", io.BytesIO(b"%PDF-1.4 sample content 1"), "application/pdf")}
    file2 = {"file": ("lecture2.pdf", io.BytesIO(b"%PDF-1.4 sample content 2"), "application/pdf")}
    client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=file1)
    client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=file2)

    # 4. User 1 lists documents -> sees 2 docs
    res_list = client.get(f"/api/courses/{course_id}/documents", headers=auth_headers_user1)
    assert res_list.status_code == 200
    docs = res_list.json()
    assert len(docs) == 2

    for doc in docs:
        assert doc["course_id"] == course_id
        assert "filename" in doc
        assert "status" in doc
        # Security requirement: Local filesystem paths must not be exposed to frontend
        assert "file_uri" not in doc
        assert "/" not in doc["filename"]
        assert "\\" not in doc["filename"]

    # 5. User 2 attempts to list User 1's course documents -> 404
    res_cross_list = client.get(f"/api/courses/{course_id}/documents", headers=auth_headers_user2)
    assert res_cross_list.status_code == 404
    assert res_cross_list.json()["detail"] == "Course not found"


def test_upload_failure_cleans_up_file(
    client: TestClient,
    auth_headers_user1: dict,
    monkeypatch,
):
    """If database save fails, stored file must be deleted to prevent orphaned files."""
    from app.core.storage import LocalStorageBackend

    course = client.post("/api/courses", headers=auth_headers_user1, json={"name": "Cleanup Test"}).json()
    course_id = course["id"]

    saved_uris = []
    orig_save = LocalStorageBackend.save
    orig_delete = LocalStorageBackend.delete

    def tracking_save(self, file_bytes, filename, content_type):
        uri = orig_save(self, file_bytes, filename, content_type)
        saved_uris.append(uri)
        return uri

    deleted_uris = []

    def tracking_delete(self, file_uri):
        deleted_uris.append(file_uri)
        return orig_delete(self, file_uri)

    monkeypatch.setattr(LocalStorageBackend, "save", tracking_save)
    monkeypatch.setattr(LocalStorageBackend, "delete", tracking_delete)

    # Simulate database error on commit
    def failing_commit(*args, **kwargs):
        raise RuntimeError("Simulated DB failure")

    from sqlalchemy.orm import Session
    monkeypatch.setattr(Session, "commit", failing_commit)

    file_payload = {"file": ("test.pdf", io.BytesIO(b"%PDF-1.4 file content"), "application/pdf")}
    try:
        client.post(f"/api/courses/{course_id}/documents", headers=auth_headers_user1, files=file_payload)
    except Exception:
        pass

    assert len(saved_uris) == 1
    assert len(deleted_uris) == 1
    assert saved_uris[0] == deleted_uris[0]
