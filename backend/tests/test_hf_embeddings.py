"""Tests for Hugging Face local BGE-M3 embedding provider and dimension validation."""

from unittest.mock import MagicMock, patch

import pytest

from app.ai.embedding.embedder import (
    DimensionMismatchError,
    HuggingFaceBGEEmbedder,
    get_embedder,
)
from app.ai.harness.cache import InMemoryCache
from app.core.config import settings


@pytest.mark.asyncio
async def test_hf_embedder_cpu_fallback_and_caching():
    """Verify device defaults safely to CPU and caching avoids redundant model calls."""
    cache = InMemoryCache()
    embedder = HuggingFaceBGEEmbedder(
        model_name="BAAI/bge-m3",
        expected_dim=1024,
        cache=cache,
        device="cpu",
    )

    assert embedder._resolve_device() == "cpu"
    assert embedder.expected_dim == 1024

    # Mock the underlying SentenceTransformer model
    mock_model = MagicMock()
    # Return 1024-dim dummy vector
    mock_model.encode.return_value = [[0.01] * 1024]

    with patch.object(embedder, "_get_model", return_value=mock_model):
        res1 = await embedder.embed_texts(["What is computer architecture?"])
        assert len(res1) == 1
        assert len(res1[0]) == 1024
        assert mock_model.encode.call_count == 1

        # Second call with same text should hit in-memory cache and not call encode again
        res2 = await embedder.embed_texts(["What is computer architecture?"])
        assert len(res2) == 1
        assert len(res2[0]) == 1024
        assert mock_model.encode.call_count == 1


@pytest.mark.asyncio
async def test_hf_embedder_rejects_dimension_mismatch():
    """Assert DimensionMismatchError is raised if model produces vector != 1024 dimensions."""
    cache = InMemoryCache()
    embedder = HuggingFaceBGEEmbedder(
        model_name="BAAI/bge-m3",
        expected_dim=1024,
        cache=cache,
        device="cpu",
    )

    # Return 768-dim vector instead of 1024
    mock_model = MagicMock()
    mock_model.encode.return_value = [[0.05] * 768]

    with patch.object(embedder, "_get_model", return_value=mock_model):
        with pytest.raises(DimensionMismatchError, match="dimension mismatch"):
            await embedder.embed_texts(["Test invalid dimension"])


def test_get_embedder_huggingface_factory():
    """Verify get_embedder() instantiates HuggingFaceBGEEmbedder when configured."""
    original_provider = settings.EMBEDDING_PROVIDER
    try:
        settings.EMBEDDING_PROVIDER = "huggingface"
        embedder = get_embedder()
        assert isinstance(embedder, HuggingFaceBGEEmbedder)
        assert embedder.expected_dim == 1024
    finally:
        settings.EMBEDDING_PROVIDER = original_provider
