"""Deterministic retrieval sufficiency evaluation gate.

Follows README Section 6 ("Query"):
- Evaluates best retrieval score against RETRIEVAL_MIN_SCORE.
- If below threshold, skips LLM generation to avoid hallucinations.
- Returns clear sufficient/insufficient decision and top score.
"""

from pydantic import BaseModel, Field

from app.core.config import settings
from app.retrieval.search import SearchResult


class SufficiencyResult(BaseModel):
    """Result of the deterministic retrieval sufficiency check."""

    is_sufficient: bool = Field(description="True if top retrieval score meets or exceeds threshold")
    best_score: float = Field(default=0.0, description="Highest score among retrieved chunks")
    threshold: float = Field(description="Score threshold applied")
    results: list[SearchResult] = Field(
        default_factory=list,
        description="Filtered or retained results if sufficient",
    )


def check_sufficiency(
    results: list[SearchResult],
    min_score: float | None = None,
) -> SufficiencyResult:
    """Deterministically checks if retrieved search results are sufficient to answer a question.

    Args:
        results: Ranked list of SearchResult items.
        min_score: Optional explicit threshold override. If None, reads settings.RETRIEVAL_MIN_SCORE or 0.015.

    Returns:
        SufficiencyResult indicating decision, best score, and applicable results.
    """
    threshold = (
        min_score
        if min_score is not None
        else (settings.RETRIEVAL_MIN_SCORE if settings.RETRIEVAL_MIN_SCORE is not None else 0.015)
    )

    if not results:
        return SufficiencyResult(
            is_sufficient=False,
            best_score=0.0,
            threshold=threshold,
            results=[],
        )

    best_score = results[0].score
    is_sufficient = best_score >= threshold

    return SufficiencyResult(
        is_sufficient=is_sufficient,
        best_score=best_score,
        threshold=threshold,
        results=results if is_sufficient else [],
    )
