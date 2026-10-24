"""Storage backend abstraction.

Supports local filesystem storage in development and S3-compatible object storage
(e.g., Cloudflare R2 / Supabase Storage) in production.
"""

import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings


class StorageBackend(ABC):
    """Abstract interface for document file storage."""

    @abstractmethod
    def save(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        """Saves file bytes and returns the stored file URI."""
        pass

    @abstractmethod
    def get(self, file_uri: str) -> bytes:
        """Retrieves file bytes by URI."""
        pass

    @abstractmethod
    def delete(self, file_uri: str) -> bool:
        """Deletes file by URI. Returns True if deleted or did not exist."""
        pass


class LocalStorageBackend(StorageBackend):
    """Stores files on the local filesystem."""

    def __init__(self, base_dir: str | None = None):
        self.base_dir = Path(base_dir or settings.STORAGE_LOCAL_DIR).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _sanitize_extension(self, filename: str) -> str:
        ext = Path(filename).suffix.lower()
        if not ext or len(ext) > 10:
            return ".bin"
        return ext

    def save(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        ext = self._sanitize_extension(original_filename)
        unique_name = f"{uuid.uuid4().hex}{ext}"
        target_path = self.base_dir / unique_name
        target_path.write_bytes(file_bytes)
        return str(target_path.as_posix())

    def get(self, file_uri: str) -> bytes:
        path = Path(file_uri)
        if not path.is_absolute():
            path = self.base_dir / path
        if not path.exists():
            raise FileNotFoundError(f"Stored file not found: {file_uri}")
        return path.read_bytes()

    def delete(self, file_uri: str) -> bool:
        try:
            path = Path(file_uri)
            if not path.is_absolute():
                path = self.base_dir / path
            if path.exists():
                path.unlink()
            return True
        except Exception:
            return False


class S3StorageBackend(StorageBackend):
    """S3-compatible storage backend for Cloudflare R2 / Supabase Storage."""

    def __init__(self):
        # Stub ready for boto3 integration in production
        self.endpoint_url = settings.S3_ENDPOINT_URL
        self.bucket = settings.S3_BUCKET_NAME

    def save(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError("S3 backend requires boto3 and configured S3 credentials.")

    def get(self, file_uri: str) -> bytes:
        raise NotImplementedError("S3 backend requires boto3 and configured S3 credentials.")

    def delete(self, file_uri: str) -> bool:
        raise NotImplementedError("S3 backend requires boto3 and configured S3 credentials.")


def get_storage() -> StorageBackend:
    """Factory dependency returning the active StorageBackend."""
    if settings.STORAGE_BACKEND.lower() == "s3" and settings.S3_BUCKET_NAME:
        return S3StorageBackend()
    return LocalStorageBackend()
