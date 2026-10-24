"""Weak topics ranking based on mastery gaps, exam relevance, and practice recency.

Follows README Section 12:
- Weak topics: below a mastery threshold, ranked by exam relevance and recency.
"""

from __future__ import annotations

from typing import TypeVar

T = TypeVar("T")  # Can be topic_id (int) or topic_name (str)


def weak_topics(
    mastery_by_topic: dict[T, float],
    threshold: float = 0.60,
    relevance: dict[T, float] | None = None,
    recency: dict[T, float] | None = None,
) -> list[T]:
    """Rank topics that fall below the mastery threshold in descending order of urgency.

    Args:
        mastery_by_topic: Mapping of topic identifier to mastery score in [0.0, 1.0].
        threshold: Score threshold below which a topic is considered weak (default 0.60).
        relevance: Optional topic relevance/weight (e.g. syllabus weight, default 1.0).
        recency: Optional days since last practiced (higher = longer unpracticed, default 0.0).

    Returns:
        List of topic identifiers sorted by urgency (highest priority first).
    """
    relevance_map = relevance or {}
    recency_map = recency or {}

    candidates: list[tuple[float, T]] = []

    for topic_id, score in mastery_by_topic.items():
        if score < threshold:
            gap = threshold - score
            rel = max(0.1, relevance_map.get(topic_id, 1.0))
            days_unpracticed = max(0.0, recency_map.get(topic_id, 0.0))

            # Recency multiplier: gentle boost for topics not touched recently (up to 30 days)
            recency_multiplier = 1.0 + 0.05 * min(days_unpracticed, 30.0)

            priority = gap * rel * recency_multiplier
            candidates.append((priority, topic_id))

    # Sort descending by priority
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [topic_id for _, topic_id in candidates]
