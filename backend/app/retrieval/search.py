"""Hybrid retrieval module combining dense vector search and lexical full-text search.

Follows README Section 6 ("Query") and Phase 1 Part C:
- Dense search: pgvector cosine distance on embedding
- Lexical search: tsvector matching and ts_rank_cd on tsv
- Non-negotiable security invariant: Filtered by user_id AND course_id at SQL level
- Merges ranked lists using Reciprocal Rank Fusion (RRF, default k=60)
- Optional pluggable reranker hook
- Transparent SQLite fallback for deterministic offline unit testing
"""

import math
import re
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import Chunk


class SearchResult(BaseModel):
    """Retrieved chunk result with ranking metadata and citation context."""

    chunk_id: int = Field(description="Database ID of the chunk")
    document_id: int = Field(description="Document ID chunk belongs to")
    document_name: str | None = Field(default=None, description="Filename of the source document")
    course_id: int = Field(description="Course ID for isolation verification")
    user_id: int = Field(description="User ID for isolation verification")
    page: int = Field(description="1-based page number in source document")
    heading_path: str | None = Field(default=None, description="Heading hierarchy breadcrumbs")
    text: str = Field(description="Extracted chunk text")
    injection_flag: bool = Field(
        default=False, description="Flagged for potential prompt injection"
    )
    low_conf: bool = Field(default=False, description="Flagged for low OCR confidence")
    dense_rank: int | None = Field(
        default=None, description="Rank in dense vector search (1-indexed)"
    )
    lexical_rank: int | None = Field(default=None, description="Rank in lexical search (1-indexed)")
    dense_score: float | None = Field(
        default=None, description="Raw cosine similarity score from dense search"
    )
    score: float = Field(default=0.0, description="RRF or reranked relevance score")


ENGLISH_STOPWORDS = {
    "a",
    "about",
    "above",
    "after",
    "again",
    "against",
    "all",
    "am",
    "an",
    "and",
    "any",
    "are",
    "aren't",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can't",
    "cannot",
    "could",
    "couldn't",
    "did",
    "didn't",
    "do",
    "does",
    "doesn't",
    "doing",
    "don't",
    "down",
    "during",
    "each",
    "few",
    "for",
    "from",
    "further",
    "had",
    "hadn't",
    "has",
    "hasn't",
    "have",
    "haven't",
    "having",
    "he",
    "he'd",
    "he'll",
    "he's",
    "her",
    "here",
    "here's",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "how",
    "how's",
    "i",
    "i'd",
    "i'll",
    "i'm",
    "i've",
    "if",
    "in",
    "into",
    "is",
    "isn't",
    "it",
    "it's",
    "its",
    "itself",
    "let's",
    "me",
    "more",
    "most",
    "mustn't",
    "my",
    "myself",
    "no",
    "nor",
    "not",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "ought",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "same",
    "shan't",
    "she",
    "she'd",
    "she'll",
    "she's",
    "should",
    "shouldn't",
    "so",
    "some",
    "such",
    "than",
    "that",
    "that's",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "there's",
    "these",
    "they",
    "they'd",
    "they'll",
    "they're",
    "they've",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "until",
    "up",
    "very",
    "was",
    "wasn't",
    "we",
    "we'd",
    "we'll",
    "we're",
    "we've",
    "were",
    "weren't",
    "what",
    "what's",
    "when",
    "when's",
    "where",
    "where's",
    "which",
    "while",
    "who",
    "who's",
    "whom",
    "why",
    "why's",
    "with",
    "won't",
    "would",
    "wouldn't",
    "you",
    "you'd",
    "you'll",
    "you're",
    "you've",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "explain",
    "describe",
    "tell",
}


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two vector lists."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2, strict=False))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0
    return dot / (norm1 * norm2)


def _tokenize(text_str: str) -> list[str]:
    """Alphanumeric tokenizer for lexical fallback matching with stopword removal."""
    raw_tokens = re.findall(r"\b[a-zA-Z0-9_]{2,}\b", text_str.lower())
    return [t for t in raw_tokens if t not in ENGLISH_STOPWORDS]


def _sqlite_lexical_score(query_tokens: list[str], content: str) -> float:
    """Compute term-frequency matching score in SQLite against non-stopword query tokens."""
    if not query_tokens or not content:
        return 0.0
    doc_tokens = re.findall(r"\b[a-zA-Z0-9_]{2,}\b", content.lower())
    if not doc_tokens:
        return 0.0
    score = 0.0
    for q in query_tokens:
        count = doc_tokens.count(q)
        if count > 0:
            score += 1.0 + math.log(count)
    return score


def search_dense(
    query_vector: list[float],
    course_id: int,
    user_id: int,
    db: Session,
    limit: int = 20,
    min_similarity: float = 0.20,
) -> list[dict[str, Any]]:
    """Execute dense vector similarity search, strictly filtered by user_id and course_id in SQL."""
    dialect_name = db.bind.dialect.name if db.bind else db.get_bind().dialect.name

    if dialect_name == "postgresql":
        # Native pgvector cosine search
        stmt = text(
            """
            SELECT id, document_id, course_id, user_id, page, heading_path, text, low_conf, injection_flag,
                   (1 - (embedding <=> :query_vec)) AS score
            FROM chunks
            WHERE user_id = :user_id AND course_id = :course_id AND embedding IS NOT NULL
              AND (1 - (embedding <=> :query_vec)) >= :min_sim
            ORDER BY embedding <=> :query_vec ASC
            LIMIT :limit
            """
        )
        res = db.execute(
            stmt,
            {
                "user_id": user_id,
                "course_id": course_id,
                "query_vec": str(query_vector),
                "min_sim": min_similarity,
                "limit": limit,
            },
        )
        return [dict(row._mapping) for row in res]

    # SQLite fallback: strictly user_id and course_id scoped at SQL level
    chunks = (
        db.query(Chunk)
        .filter(
            Chunk.user_id == user_id,
            Chunk.course_id == course_id,
            Chunk.embedding.isnot(None),
        )
        .all()
    )

    scored: list[tuple[float, Chunk]] = []
    for c in chunks:
        vec = c.embedding
        if isinstance(vec, list):
            sim = _cosine_similarity(query_vector, vec)
            if sim >= min_similarity:
                scored.append((sim, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    results: list[dict[str, Any]] = []
    for sim, c in scored[:limit]:
        results.append(
            {
                "id": c.id,
                "document_id": c.document_id,
                "course_id": c.course_id,
                "user_id": c.user_id,
                "page": c.page,
                "heading_path": c.heading_path,
                "text": c.text,
                "low_conf": c.low_conf,
                "injection_flag": c.injection_flag,
                "score": sim,
            }
        )
    return results


def search_lexical(
    query_text: str,
    course_id: int,
    user_id: int,
    db: Session,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Execute full-text lexical search, strictly filtered by user_id and course_id in SQL."""
    dialect_name = db.bind.dialect.name if db.bind else db.get_bind().dialect.name

    if dialect_name == "postgresql":
        # Native Postgres tsvector & ts_rank_cd
        stmt = text(
            """
            SELECT id, document_id, course_id, user_id, page, heading_path, text, low_conf, injection_flag,
                   ts_rank_cd(tsv, plainto_tsquery('english', :query_text)) AS score
            FROM chunks
            WHERE user_id = :user_id AND course_id = :course_id
              AND tsv @@ plainto_tsquery('english', :query_text)
            ORDER BY score DESC
            LIMIT :limit
            """
        )
        res = db.execute(
            stmt,
            {"user_id": user_id, "course_id": course_id, "query_text": query_text, "limit": limit},
        )
        return [dict(row._mapping) for row in res]

    # SQLite fallback: strictly user_id and course_id scoped at SQL level
    chunks = db.query(Chunk).filter(Chunk.user_id == user_id, Chunk.course_id == course_id).all()

    query_tokens = _tokenize(query_text)
    if not query_tokens:
        return []

    scored: list[tuple[float, Chunk]] = []
    for c in chunks:
        content = f"{c.heading_path or ''} {c.text}"
        score = _sqlite_lexical_score(query_tokens, content)
        if score > 0.0:
            scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    results: list[dict[str, Any]] = []
    for score, c in scored[:limit]:
        results.append(
            {
                "id": c.id,
                "document_id": c.document_id,
                "course_id": c.course_id,
                "user_id": c.user_id,
                "page": c.page,
                "heading_path": c.heading_path,
                "text": c.text,
                "low_conf": c.low_conf,
                "injection_flag": c.injection_flag,
                "score": score,
            }
        )
    return results


def hybrid_search(
    query_text: str,
    query_vector: list[float],
    course_id: int,
    user_id: int,
    db: Session,
    limit: int = 8,
    dense_candidates: int = 25,
    lexical_candidates: int = 25,
    k_rrf: int = 60,
    reranker: Callable[[str, list[SearchResult]], list[SearchResult]] | None = None,
) -> list[SearchResult]:
    """Execute hybrid retrieval combining dense and lexical search via Reciprocal Rank Fusion.

    Security & Correctness:
    - user_id and course_id MUST be filtered in SQL.
    - Reciprocal Rank Fusion combines dense rank r_d and lexical rank r_l:
      RRF_score = 1.0 / (k_rrf + r_d) + 1.0 / (k_rrf + r_l)
    - Optional reranker hook.
    """
    dense_results = search_dense(
        query_vector=query_vector,
        course_id=course_id,
        user_id=user_id,
        db=db,
        limit=dense_candidates,
    )

    lexical_results = search_lexical(
        query_text=query_text,
        course_id=course_id,
        user_id=user_id,
        db=db,
        limit=lexical_candidates,
    )

    # Track ranks and chunk metadata
    # chunk_id -> { "chunk": data, "dense_rank": int | None, "lexical_rank": int | None, "rrf_score": float }
    merged_map: dict[int, dict[str, Any]] = {}

    for rank_idx, item in enumerate(dense_results, start=1):
        cid = item["id"]
        if cid not in merged_map:
            merged_map[cid] = {
                "data": item,
                "dense_rank": rank_idx,
                "lexical_rank": None,
                "rrf_score": 1.0 / (k_rrf + rank_idx),
            }
        else:
            merged_map[cid]["dense_rank"] = rank_idx
            merged_map[cid]["rrf_score"] += 1.0 / (k_rrf + rank_idx)

    for rank_idx, item in enumerate(lexical_results, start=1):
        cid = item["id"]
        if cid not in merged_map:
            merged_map[cid] = {
                "data": item,
                "dense_rank": None,
                "lexical_rank": rank_idx,
                "rrf_score": 1.0 / (k_rrf + rank_idx),
            }
        else:
            merged_map[cid]["lexical_rank"] = rank_idx
            merged_map[cid]["rrf_score"] += 1.0 / (k_rrf + rank_idx)

    # Look up document names
    doc_ids = {info["data"]["document_id"] for info in merged_map.values()}
    doc_name_map: dict[int, str] = {}
    if doc_ids:
        from pathlib import Path

        from app.db.models import Document

        docs = db.query(Document.id, Document.file_uri).filter(Document.id.in_(doc_ids)).all()
        doc_name_map = {d.id: Path(d.file_uri).name for d in docs}

    # Convert to SearchResult models
    fused_results: list[SearchResult] = []
    for info in merged_map.values():
        item = info["data"]
        doc_id = item["document_id"]
        dense_sim = item.get("score") if info["dense_rank"] is not None else None
        fused_results.append(
            SearchResult(
                chunk_id=item["id"],
                document_id=doc_id,
                document_name=doc_name_map.get(doc_id, f"doc_{doc_id}.pdf"),
                course_id=item["course_id"],
                user_id=item["user_id"],
                page=item["page"],
                heading_path=item["heading_path"],
                text=item["text"],
                injection_flag=item["injection_flag"],
                low_conf=item["low_conf"],
                dense_rank=info["dense_rank"],
                lexical_rank=info["lexical_rank"],
                dense_score=dense_sim,
                score=round(info["rrf_score"], 6),
            )
        )

    # Sort descending by RRF score
    fused_results.sort(key=lambda r: r.score, reverse=True)

    # Apply optional reranker if provided
    if reranker is not None:
        fused_results = reranker(query_text, fused_results)

    return fused_results[:limit]


def is_broad_query(query_text: str) -> bool:
    """Detects whether a student query asks for a broad summary or course-wide overview."""
    q = query_text.strip().lower()
    broad_triggers = [
        "summarize the key",
        "summarize key",
        "key learning concepts",
        "summary of the course",
        "summarize the course",
        "course overview",
        "overview of the materials",
        "what are the main concepts",
        "summarize these materials",
        "summarize this material",
        "syllabus summary",
        "outline of",
        "what did we learn",
        "what did we study",
        "explain the main topics",
    ]
    return any(trigger in q for trigger in broad_triggers)


def broad_course_search(
    course_id: int,
    user_id: int,
    db: Session,
    limit: int = 10,
) -> list[SearchResult]:
    """Retrieves representative chunks spanning multiple sections and topics for broad course queries."""
    from pathlib import Path

    from app.db.models import Document

    chunks = (
        db.query(Chunk)
        .filter(Chunk.course_id == course_id, Chunk.user_id == user_id)
        .order_by(Chunk.page.asc(), Chunk.id.asc())
        .all()
    )
    if not chunks:
        return []

    # Sample evenly across chunks
    step = max(1, len(chunks) // limit)
    sampled = chunks[::step][:limit]

    doc_ids = {c.document_id for c in sampled}
    doc_name_map: dict[int, str] = {}
    if doc_ids:
        docs = db.query(Document.id, Document.file_uri).filter(Document.id.in_(doc_ids)).all()
        doc_name_map = {d.id: Path(d.file_uri).name for d in docs}

    results: list[SearchResult] = []
    for c in sampled:
        results.append(
            SearchResult(
                chunk_id=c.id,
                document_id=c.document_id,
                document_name=doc_name_map.get(c.document_id, f"doc_{c.document_id}.pdf"),
                course_id=c.course_id,
                user_id=c.user_id,
                page=c.page,
                heading_path=c.heading_path,
                text=c.text,
                injection_flag=c.injection_flag,
                low_conf=c.low_conf,
                dense_rank=1,
                lexical_rank=None,
                dense_score=1.0,
                score=0.05,
            )
        )
    return results
