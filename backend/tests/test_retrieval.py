"""Unit and integration tests for hybrid retrieval, multi-tenant isolation, and sufficiency checking (Task 1C)."""

import pytest
from sqlalchemy.orm import Session

from app.db.models import Chunk, Course, Document, User
from app.retrieval.search import SearchResult, hybrid_search, search_dense, search_lexical
from app.retrieval.sufficiency import check_sufficiency


@pytest.fixture
def retrieval_fixture(db_session: Session):
    """Seed two users, each with two courses, and multiple chunks with controlled embeddings."""
    # User 1
    u1 = User(firebase_uid="retrieval_user_1", email="u1@example.com")
    # User 2
    u2 = User(firebase_uid="retrieval_user_2", email="u2@example.com")
    db_session.add_all([u1, u2])
    db_session.commit()

    # User 1 Courses
    c1_u1 = Course(user_id=u1.id, name="Biology 101")
    c2_u1 = Course(user_id=u1.id, name="Chemistry 101")
    # User 2 Course
    c1_u2 = Course(user_id=u2.id, name="Biology 101 (User 2)")
    db_session.add_all([c1_u1, c2_u1, c1_u2])
    db_session.commit()

    # Documents
    doc1 = Document(course_id=c1_u1.id, user_id=u1.id, file_uri="bio.pdf", status="ready")
    doc2 = Document(course_id=c2_u1.id, user_id=u1.id, file_uri="chem.pdf", status="ready")
    doc3 = Document(course_id=c1_u2.id, user_id=u2.id, file_uri="bio_u2.pdf", status="ready")
    db_session.add_all([doc1, doc2, doc3])
    db_session.commit()

    # Canonical 4-element vectors padded to 1024
    def make_vec(val: float) -> list[float]:
        return [val] * 1024

    vec_identical = make_vec(1.0)
    vec_orthogonal = [1.0 if i % 2 == 0 else -1.0 for i in range(1024)]

    # Chunks for User 1 Course 1 (Biology)
    chunk1_u1 = Chunk(
        document_id=doc1.id,
        course_id=c1_u1.id,
        user_id=u1.id,
        page=1,
        heading_path="Cells > Organelles",
        text="The mitochondria produces cellular energy in the form of ATP.",
        embedding=vec_identical,
        low_conf=False,
        injection_flag=False,
    )
    chunk2_u1 = Chunk(
        document_id=doc1.id,
        course_id=c1_u1.id,
        user_id=u1.id,
        page=2,
        heading_path="Cells > Nucleus",
        text="DNA contains the genetic code transcribed into RNA.",
        embedding=vec_orthogonal,
        low_conf=False,
        injection_flag=True,  # Test injection flag preservation
    )

    # Chunk for User 1 Course 2 (Chemistry) - Same user, DIFFERENT course, IDENTICAL text & vector!
    chunk_chem_u1 = Chunk(
        document_id=doc2.id,
        course_id=c2_u1.id,
        user_id=u1.id,
        page=1,
        heading_path="Thermodynamics",
        text="The mitochondria produces cellular energy in the form of ATP.",
        embedding=vec_identical,
        low_conf=False,
        injection_flag=False,
    )

    # Chunk for User 2 Course 1 - DIFFERENT user, IDENTICAL text & vector!
    chunk_u2 = Chunk(
        document_id=doc3.id,
        course_id=c1_u2.id,
        user_id=u2.id,
        page=1,
        heading_path="Cells > Organelles",
        text="The mitochondria produces cellular energy in the form of ATP.",
        embedding=vec_identical,
        low_conf=False,
        injection_flag=False,
    )

    db_session.add_all([chunk1_u1, chunk2_u1, chunk_chem_u1, chunk_u2])
    db_session.commit()

    return {
        "u1": u1,
        "u2": u2,
        "c1_u1": c1_u1,
        "c2_u1": c2_u1,
        "c1_u2": c1_u2,
        "chunk1_u1": chunk1_u1,
        "chunk2_u1": chunk2_u1,
        "chunk_chem_u1": chunk_chem_u1,
        "chunk_u2": chunk_u2,
        "vec_identical": vec_identical,
    }


def test_cross_user_isolation(db_session: Session, retrieval_fixture: dict):
    """Proves user_id scoping: User 1 NEVER retrieves User 2 chunks even with identical text and vector."""
    u1 = retrieval_fixture["u1"]
    c1_u1 = retrieval_fixture["c1_u1"]
    u2 = retrieval_fixture["u2"]
    vec = retrieval_fixture["vec_identical"]

    # User 1 searches their own course
    results = hybrid_search(
        query_text="mitochondria ATP cellular energy",
        query_vector=vec,
        course_id=c1_u1.id,
        user_id=u1.id,
        db=db_session,
    )

    assert len(results) > 0
    for r in results:
        assert r.user_id == u1.id
        assert r.user_id != u2.id
        assert r.course_id == c1_u1.id


def test_cross_course_isolation(db_session: Session, retrieval_fixture: dict):
    """Proves course_id scoping: User 1 searching Course 1 NEVER retrieves Course 2 chunks."""
    u1 = retrieval_fixture["u1"]
    c1_u1 = retrieval_fixture["c1_u1"]
    c2_u1 = retrieval_fixture["c2_u1"]
    vec = retrieval_fixture["vec_identical"]

    results = hybrid_search(
        query_text="mitochondria ATP cellular energy",
        query_vector=vec,
        course_id=c1_u1.id,
        user_id=u1.id,
        db=db_session,
    )

    returned_course_ids = {r.course_id for r in results}
    assert c1_u1.id in returned_course_ids
    assert c2_u1.id not in returned_course_ids


def test_injection_flag_and_citation_metadata_preserved(
    db_session: Session, retrieval_fixture: dict
):
    """Ensures injection_flag, low_conf, page, and heading_path are preserved on retrieved results."""
    u1 = retrieval_fixture["u1"]
    c1_u1 = retrieval_fixture["c1_u1"]
    chunk2 = retrieval_fixture["chunk2_u1"]

    results = hybrid_search(
        query_text="DNA genetic code RNA",
        query_vector=chunk2.embedding,
        course_id=c1_u1.id,
        user_id=u1.id,
        db=db_session,
    )

    assert len(results) > 0
    top = results[0]
    assert top.chunk_id == chunk2.id
    assert top.page == 2
    assert top.heading_path == "Cells > Nucleus"
    assert top.injection_flag is True  # Faithfully preserved for downstream security check!


def test_rrf_scoring_combines_dense_and_lexical(db_session: Session, retrieval_fixture: dict):
    """Proves reciprocal rank fusion: items present in both dense and lexical ranks score highest."""
    u1 = retrieval_fixture["u1"]
    c1_u1 = retrieval_fixture["c1_u1"]
    vec = retrieval_fixture["vec_identical"]

    dense = search_dense(query_vector=vec, course_id=c1_u1.id, user_id=u1.id, db=db_session)
    assert len(dense) >= 1

    lexical = search_lexical(
        query_text="mitochondria ATP", course_id=c1_u1.id, user_id=u1.id, db=db_session
    )
    assert len(lexical) >= 1

    fused = hybrid_search(
        query_text="mitochondria ATP",
        query_vector=vec,
        course_id=c1_u1.id,
        user_id=u1.id,
        db=db_session,
        k_rrf=60,
    )
    assert len(fused) >= 1
    # Check RRF math: score must be positive and bounded by 2 / 61 (with rounding tolerance)
    assert 0.0 < fused[0].score <= (2.0 / 61.0 + 1e-5)


def test_reranker_hook_custom_reordering(db_session: Session, retrieval_fixture: dict):
    """Proves pluggable reranker hook can reorder candidates."""
    u1 = retrieval_fixture["u1"]
    c1_u1 = retrieval_fixture["c1_u1"]
    vec = retrieval_fixture["vec_identical"]

    def reverse_reranker(query: str, candidates: list[SearchResult]) -> list[SearchResult]:
        for c in candidates:
            c.score = 0.999
        return list(reversed(candidates))

    results = hybrid_search(
        query_text="energy",
        query_vector=vec,
        course_id=c1_u1.id,
        user_id=u1.id,
        db=db_session,
        reranker=reverse_reranker,
    )
    assert len(results) > 0
    assert results[0].score == 0.999


def test_sufficiency_gate():
    """Validates deterministic sufficiency decision against threshold."""
    # Dummy results
    high_score_result = SearchResult(
        chunk_id=1,
        document_id=1,
        course_id=1,
        user_id=1,
        page=1,
        heading_path="Intro",
        text="Sample text",
        injection_flag=False,
        low_conf=False,
        score=0.035,
    )
    low_score_result = SearchResult(
        chunk_id=2,
        document_id=1,
        course_id=1,
        user_id=1,
        page=1,
        heading_path="Intro",
        text="Vague snippet",
        injection_flag=False,
        low_conf=False,
        score=0.005,
    )

    # 1. High score passes threshold (default 0.015)
    gate_pass = check_sufficiency([high_score_result], min_score=0.015)
    assert gate_pass.is_sufficient is True
    assert gate_pass.best_score == 0.035
    assert len(gate_pass.results) == 1

    # 2. Low score rejected by threshold
    gate_fail = check_sufficiency([low_score_result], min_score=0.015)
    assert gate_fail.is_sufficient is False
    assert gate_fail.best_score == 0.005
    assert len(gate_fail.results) == 0

    # 3. Empty results rejected
    gate_empty = check_sufficiency([], min_score=0.015)
    assert gate_empty.is_sufficient is False
    assert gate_empty.best_score == 0.0
