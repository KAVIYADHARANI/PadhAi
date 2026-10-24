"""Embeddings generation module with caching and dimension assertion.

Follows README Section 6 & 7:
- Batch calls to configured embeddings provider (EMBED_PROVIDER, EMBED_MODEL, EMBED_DIM).
- Caches by normalized text hash via InMemoryCache.
- Asserts returned dimension == EMBED_DIM and fails loudly otherwise.
- Never mixes embedding models in one index.
"""

import hashlib
import logging
import math
import struct
from typing import Protocol

import httpx

from app.ai.harness.cache import CacheInterface, InMemoryCache, make_embedding_cache_key
from app.core.config import settings

logger = logging.getLogger(__name__)


class DimensionMismatchError(ValueError):
    """Raised when an embedding provider returns a vector of incorrect dimensionality."""


class EmbeddingProviderError(RuntimeError):
    """Raised when the embedding API request fails."""


class Embedder(Protocol):
    """Protocol for embedding generation engines."""

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generates embedding vectors for a batch of strings."""
        ...


class BGEEmbedder:
    """Client for hosted embeddings (e.g., BGE-M3 1024-dim) with caching and validation."""

    def __init__(
        self,
        provider: str | None = None,
        model: str | None = None,
        expected_dim: int | None = None,
        cache: CacheInterface | None = None,
        timeout_s: float = 30.0,
        batch_size: int = 32,
    ) -> None:
        self.provider = provider or settings.EMBED_PROVIDER or "default"
        self.model = model or settings.EMBED_MODEL
        self.expected_dim = expected_dim or settings.EMBED_DIM
        self.cache = cache or InMemoryCache()
        self.timeout_s = timeout_s
        self.batch_size = batch_size

    def _resolve_api_url_and_key(self) -> tuple[str, str]:
        """Resolves endpoint URL and authorization key based on EMBED_PROVIDER."""
        provider_lower = self.provider.lower()
        if provider_lower == "openrouter" or "openrouter" in settings.LLM_CHAIN:
            return "https://openrouter.ai/api/v1/embeddings", settings.OPENROUTER_API_KEY
        if provider_lower == "groq":
            return "https://api.groq.com/openai/v1/embeddings", settings.GROQ_API_KEY
        # Fallback to OpenRouter or generic OpenAI compatible
        return "https://openrouter.ai/api/v1/embeddings", settings.OPENROUTER_API_KEY

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embeds a list of texts in batches with caching and dimension verification."""
        if not texts:
            return []

        results: list[list[float] | None] = [None] * len(texts)
        uncached_indices: list[int] = []
        uncached_texts: list[str] = []

        # 1. Check cache for each text
        for idx, text in enumerate(texts):
            cache_key = make_embedding_cache_key(text, self.provider, self.model)
            cached_vec = self.cache.get(cache_key)
            if cached_vec is not None:
                if len(cached_vec) != self.expected_dim:
                    raise DimensionMismatchError(
                        f"Cached embedding dimension mismatch for model {self.model}: "
                        f"expected {self.expected_dim}, got {len(cached_vec)}"
                    )
                results[idx] = cached_vec
            else:
                uncached_indices.append(idx)
                uncached_texts.append(text)

        if not uncached_texts:
            return [vec for vec in results if vec is not None]

        # 2. Call embedding API in batches
        url, api_key = self._resolve_api_url_and_key()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            for b_start in range(0, len(uncached_texts), self.batch_size):
                b_end = b_start + self.batch_size
                batch_chunk = uncached_texts[b_start:b_end]
                batch_idxs = uncached_indices[b_start:b_end]

                payload = {
                    "model": self.model,
                    "input": batch_chunk,
                }

                try:
                    resp = await client.post(url, json=payload, headers=headers)
                except Exception as err:
                    raise EmbeddingProviderError(f"Embedding request failed: {err}") from err

                if resp.status_code != 200:
                    raise EmbeddingProviderError(
                        f"Embedding provider {self.provider} returned status {resp.status_code}: {resp.text}"
                    )

                data = resp.json()
                items = data.get("data", [])
                if len(items) != len(batch_chunk):
                    raise EmbeddingProviderError(
                        f"Expected {len(batch_chunk)} vectors, received {len(items)}"
                    )

                # 3. Validate dimension and cache
                for text_str, orig_idx, item in zip(batch_chunk, batch_idxs, items, strict=False):
                    vec = item.get("embedding", [])
                    if len(vec) != self.expected_dim:
                        raise DimensionMismatchError(
                            f"Embedding model '{self.model}' dimension mismatch: "
                            f"expected {self.expected_dim}, got {len(vec)}."
                        )
                    results[orig_idx] = vec
                    cache_key = make_embedding_cache_key(text_str, self.provider, self.model)
                    self.cache.set(cache_key, vec)

        return [vec for vec in results if vec is not None]


class FakeEmbedder:
    """Deterministic, zero-network fake embedder for tests and offline validation."""

    def __init__(
        self,
        dim: int | None = None,
        force_dim: int | None = None,
        cache: CacheInterface | None = None,
    ) -> None:
        self.expected_dim = dim or settings.EMBED_DIM
        self.force_dim = force_dim
        self.cache = cache or InMemoryCache()
        self.call_count = 0
        self.texts_embedded: list[str] = []

    def _generate_vector(self, text: str, length: int) -> list[float]:
        """Generates a deterministic unit-normalized float vector from text hash."""
        seed_bytes = hashlib.sha256(text.encode("utf-8")).digest()
        # Expand seed to required length
        repeated = (seed_bytes * ((length * 4 // len(seed_bytes)) + 1))[: length * 4]
        floats: list[float] = []
        for i in range(0, length * 4, 4):
            val = struct.unpack("!f", repeated[i : i + 4])[0]
            if math.isnan(val) or math.isinf(val):
                val = 0.05
            floats.append(val)

        norm = math.sqrt(sum(x * x for x in floats)) or 1.0
        return [round(x / norm, 6) for x in floats]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        results: list[list[float]] = []
        for text in texts:
            cache_key = make_embedding_cache_key(text, "fake", "fake-model")
            cached = self.cache.get(cache_key)
            if cached is not None:
                target_len = len(cached)
                if self.force_dim is not None and target_len != self.expected_dim:
                    raise DimensionMismatchError(
                        f"Dimension mismatch: expected {self.expected_dim}, got {target_len}"
                    )
                results.append(cached)
                continue

            self.call_count += 1
            self.texts_embedded.append(text)
            vec_length = self.force_dim if self.force_dim is not None else self.expected_dim
            if vec_length != self.expected_dim:
                raise DimensionMismatchError(
                    f"Embedding dimension mismatch: expected {self.expected_dim}, got {vec_length}"
                )

            vec = self._generate_vector(text, vec_length)
            self.cache.set(cache_key, vec)
            results.append(vec)

        return results


def get_embedder() -> Embedder:
    """Return configured embedder instance based on settings."""
    if settings.EMBED_PROVIDER == "fake" or not settings.OPENROUTER_API_KEY:
        return FakeEmbedder(dim=settings.EMBED_DIM)
    return BGEEmbedder(
        provider=settings.EMBED_PROVIDER,
        model=settings.EMBED_MODEL,
        expected_dim=settings.EMBED_DIM,
    )
