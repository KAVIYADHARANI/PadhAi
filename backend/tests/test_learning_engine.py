"""Tests for mastery calculation and weak topic ranking (Task 3A)."""

from __future__ import annotations

import json
from pathlib import Path

from app.learning.mastery import AttemptRecord, mastery_score
from app.learning.weak_topics import weak_topics

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_empty_attempts_returns_default_mastery():
    """Empty history returns neutral default."""
    assert mastery_score([]) == 0.0
    assert mastery_score([], default_mastery=0.5) == 0.5


def test_mastery_is_bounded_and_deterministic():
    """Score must always be in [0.0, 1.0] and return identical values on identical inputs."""
    attempts = [
        AttemptRecord(is_correct=True, difficulty=2.0, days_ago=1.0),
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=2.0),
    ]
    s1 = mastery_score(attempts)
    s2 = mastery_score(attempts)

    assert s1 == s2
    assert 0.0 <= s1 <= 1.0


def test_monotonicity_in_correct_answers():
    """Adding or flipping an attempt to correct never decreases the score."""
    base_attempts = [
        AttemptRecord(is_correct=False, difficulty=1.5, days_ago=1.0),
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=2.0),
    ]
    base_score = mastery_score(base_attempts)

    # Flip one to correct
    improved_attempts = [
        AttemptRecord(is_correct=True, difficulty=1.5, days_ago=1.0),
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=2.0),
    ]
    improved_score = mastery_score(improved_attempts)
    assert improved_score > base_score

    # Add another correct attempt
    added_correct = base_attempts + [AttemptRecord(is_correct=True, difficulty=2.0, days_ago=0.5)]
    assert mastery_score(added_correct) > base_score


def test_recency_weighting_dominates():
    """Recent correct answers raise the score more than older correct answers."""
    # Pattern A: Recent correct, old incorrect
    recent_correct = [
        AttemptRecord(is_correct=True, difficulty=1.0, days_ago=0.1),
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=14.0),
    ]
    # Pattern B: Old correct, recent incorrect
    old_correct = [
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=0.1),
        AttemptRecord(is_correct=True, difficulty=1.0, days_ago=14.0),
    ]

    score_recent = mastery_score(recent_correct, half_life_days=7.0)
    score_old = mastery_score(old_correct, half_life_days=7.0)

    assert score_recent > score_old


def test_difficulty_weighting():
    """Harder questions carry proportionally greater weight in mastery."""
    # Correct on hard (2.0) vs incorrect on easy (1.0)
    hard_correct = [
        AttemptRecord(is_correct=True, difficulty=2.0, days_ago=1.0),
        AttemptRecord(is_correct=False, difficulty=1.0, days_ago=1.0),
    ]
    # Correct on easy (1.0) vs incorrect on hard (2.0)
    easy_correct = [
        AttemptRecord(is_correct=True, difficulty=1.0, days_ago=1.0),
        AttemptRecord(is_correct=False, difficulty=2.0, days_ago=1.0),
    ]

    assert mastery_score(hard_correct) > mastery_score(easy_correct)


def test_weak_topics_ranking_and_threshold():
    """Topics above threshold are excluded; topics below are ranked by urgency."""
    scores = {
        "Topic A": 0.85,  # Strong
        "Topic B": 0.40,  # Weak
        "Topic C": 0.20,  # Very weak
    }
    ranked = weak_topics(scores, threshold=0.60)
    assert "Topic A" not in ranked
    assert ranked == ["Topic C", "Topic B"]


def test_replay_fixtures_scripted_attempt_history():
    """Replays attempt_history.json and asserts exact match against expected_weak.json."""
    with open(FIXTURES_DIR / "attempt_history.json", encoding="utf-8") as f:
        history_data = json.load(f)

    with open(FIXTURES_DIR / "expected_weak.json", encoding="utf-8") as f:
        expected_data = json.load(f)

    # Group attempts by topic
    topic_attempts: dict[str, list[AttemptRecord]] = {}
    for item in history_data["attempts"]:
        topic = item["topic"]
        if topic not in topic_attempts:
            topic_attempts[topic] = []
        topic_attempts[topic].append(
            AttemptRecord(
                is_correct=item["is_correct"],
                difficulty=item["difficulty"],
                days_ago=item["days_ago"],
            )
        )

    # Calculate mastery for each topic
    mastery_by_topic = {
        topic: mastery_score(attempts, half_life_days=7.0)
        for topic, attempts in topic_attempts.items()
    }

    threshold = expected_data.get("threshold", 0.60)
    actual_weak = weak_topics(mastery_by_topic, threshold=threshold)

    assert actual_weak == expected_data["ranked_weak_topics"]
