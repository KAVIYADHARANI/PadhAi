"""Tests for Caching and deterministic key generation with user isolation."""

import time

from app.ai.harness.cache import (
    InMemoryCache,
    make_embedding_cache_key,
    make_generated_set_cache_key,
    make_router_cache_key,
)


def test_in_memory_cache_crud_and_ttl():
    cache = InMemoryCache(max_size=5)

    cache.set("key1", "val1")
    assert cache.get("key1") == "val1"

    # Delete
    assert cache.delete("key1") is True
    assert cache.get("key1") is None
    assert cache.delete("key1") is False

    # TTL expiration
    cache.set("key_temp", "temp_value", ttl_s=0.1)
    assert cache.get("key_temp") == "temp_value"
    time.sleep(0.12)
    assert cache.get("key_temp") is None

    # Clear
    cache.set("k1", "v1")
    cache.set("k2", "v2")
    cache.clear()
    assert cache.get("k1") is None
    assert cache.get("k2") is None


def test_deterministic_embedding_cache_key():
    key1 = make_embedding_cache_key("Cellular Respiration and ATP", "openrouter", "bge-m3")
    key2 = make_embedding_cache_key("  Cellular Respiration and ATP  ", "openrouter", "bge-m3")
    key3 = make_embedding_cache_key("Different topic", "openrouter", "bge-m3")

    assert key1 == key2
    assert key1 != key3


def test_cache_user_isolation():
    # Router keys
    user1_key = make_router_cache_key("Quiz me on chapter 2", user_id=101)
    user2_key = make_router_cache_key("Quiz me on chapter 2", user_id=102)
    global_key = make_router_cache_key("Quiz me on chapter 2")

    assert user1_key != user2_key
    assert user1_key != global_key
    assert "u101" in user1_key
    assert "u102" in user2_key

    # Generated set keys
    gen_u1 = make_generated_set_cache_key(
        topic_id=4, chunk_hash="abc123hash", kind="quiz", user_id=101
    )
    gen_u2 = make_generated_set_cache_key(
        topic_id=4, chunk_hash="abc123hash", kind="quiz", user_id=102
    )

    assert gen_u1 != gen_u2
    assert "u101" in gen_u1
    assert "u102" in gen_u2
