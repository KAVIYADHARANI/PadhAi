"""Cache interfaces and deterministic key generators for AI Agent Harness.

Supports in-memory caching with TTL and user-isolated cache keys.
"""

import hashlib
import json
import re
import threading
import time
from abc import ABC, abstractmethod
from typing import Any


class CacheInterface(ABC):
    """Abstract interface for LLM response and artifact caching."""

    @abstractmethod
    def get(self, key: str) -> Any | None:
        """Retrieve an item from cache if present and unexpired."""
        raise NotImplementedError

    @abstractmethod
    def set(self, key: str, value: Any, ttl_s: int | None = None) -> None:
        """Store an item in cache with optional TTL in seconds."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete an item from cache."""
        raise NotImplementedError

    @abstractmethod
    def clear(self) -> None:
        """Clear all cached entries."""
        raise NotImplementedError


class InMemoryCache(CacheInterface):
    """Thread-safe in-memory cache with TTL expiration."""

    def __init__(self, max_size: int = 10_000):
        self._cache: dict[str, tuple[Any, float | None]] = {}
        self._lock = threading.RLock()
        self._max_size = max_size

    def get(self, key: str) -> Any | None:
        with self._lock:
            if key not in self._cache:
                return None
            val, expires_at = self._cache[key]
            if expires_at is not None and time.time() > expires_at:
                del self._cache[key]
                return None
            return val

    def set(self, key: str, value: Any, ttl_s: int | None = None) -> None:
        with self._lock:
            # Simple eviction when exceeding max size
            if len(self._cache) >= self._max_size:
                # Evict expired first
                now = time.time()
                expired = [k for k, (_, exp) in self._cache.items() if exp and now > exp]
                for k in expired:
                    del self._cache[k]
                # If still over limit, drop oldest entry
                if len(self._cache) >= self._max_size:
                    first_key = next(iter(self._cache))
                    del self._cache[first_key]

            expires_at = (time.time() + ttl_s) if ttl_s is not None else None
            self._cache[key] = (value, expires_at)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Deterministic Cache Key Generators


def hash_text(text: str) -> str:
    """Compute deterministic SHA-256 hex digest of normalized string."""
    normalized = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def make_embedding_cache_key(text: str, provider_or_model: str, model: str | None = None) -> str:
    """Cache key for embedding calls. Embeddings are mathematically deterministic per model."""
    if model is None:
        provider = "default"
        resolved_model = provider_or_model
    else:
        provider = provider_or_model
        resolved_model = model
    text_hash = hash_text(text)
    return f"embed:{provider}:{resolved_model}:{text_hash}"


def make_router_cache_key(normalized_message: str, user_id: int | None = None) -> str:
    """Cache key for router decisions on normalized message phrases.

    Includes user_id when user-specific context is active to ensure user isolation.
    """
    msg_hash = hash_text(normalized_message.lower())
    if user_id is not None:
        return f"router:u{user_id}:{msg_hash}"
    return f"router:global:{msg_hash}"


def make_generated_set_cache_key(
    topic_id: int,
    chunk_hash: str | list[str] | set[str] | tuple[str, ...],
    kind: str = "quiz",
    user_id: int | None = None,
) -> str:
    """Cache key for generated quiz questions or flashcards from topic chunks.

    Maintains strict user isolation when user_id is supplied.
    """
    if isinstance(chunk_hash, (list, set, tuple)):
        resolved_hash = hashlib.sha256(",".join(sorted(chunk_hash)).encode("utf-8")).hexdigest()
    else:
        resolved_hash = str(chunk_hash)

    user_prefix = f"u{user_id}:" if user_id is not None else ""
    return f"gen:{user_prefix}{kind}:t{topic_id}:{resolved_hash}"


def make_structured_call_cache_key(
    schema_name: str,
    messages_payload: list[dict[str, str]],
    model: str,
    user_id: int | None = None,
) -> str:
    """Cache key for structured output calls with user isolation."""
    canonical_json = json.dumps(messages_payload, sort_keys=True)
    payload_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    user_prefix = f"u{user_id}:" if user_id is not None else "global:"
    return f"struct:{user_prefix}{model}:{schema_name}:{payload_hash}"
