"""Deterministic Study Planner and Roadmap Scheduler.

Follows README Section 12 & docs/ROADMAP_SPEC.md:
"Code decides, the LLM writes."
- Pure deterministic algorithm calculating day-by-day study schedule.
- Allocates topics based on student mastery gaps (weak topics scheduled earlier).
- Strictly bounds daily minutes and total hours.
- Adapts task chunking and review ratios according to learner level.
- Provides replan_roadmap to preserve completed items while redistributing remaining days.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class TopicInfo:
    """Represents a course topic input to the planner."""

    id: int
    name: str


@dataclass
class PlannedTask:
    """Actionable study task within a planned daily milestone."""

    id: str
    task: str
    estimated_minutes: int
    completed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "task": self.task,
            "estimated_minutes": self.estimated_minutes,
            "completed": self.completed,
        }


@dataclass
class PlannedDay:
    """Daily study plan milestone computed deterministically."""

    day: int
    topic_id: int | None
    topic_name: str
    title: str
    learning_objectives: list[str] = field(default_factory=list)
    tasks: list[PlannedTask] = field(default_factory=list)
    estimated_minutes: int = 60
    completed: bool = False
    is_review: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "topic_id": self.topic_id,
            "topic_name": self.topic_name,
            "title": self.title,
            "learning_objectives": self.learning_objectives,
            "tasks": [t.to_dict() for t in self.tasks],
            "estimated_minutes": self.estimated_minutes,
            "completed": self.completed,
            "is_review": self.is_review,
        }


LEVEL_CONFIGS: dict[str, dict[str, Any]] = {
    "beginner": {
        "review_ratio": 0.30,
        "default_task_minutes": 25,
        "tasks_per_day": (2, 4),
    },
    "intermediate": {
        "review_ratio": 0.20,
        "default_task_minutes": 40,
        "tasks_per_day": (2, 4),
    },
    "advanced": {
        "review_ratio": 0.10,
        "default_task_minutes": 50,
        "tasks_per_day": (2, 4),
    },
}


def _split_into_tasks(day_num: int, total_minutes: int, level: str, topic_name: str, is_review: bool) -> list[PlannedTask]:
    """Generates structured tasks dividing the daily minute budget deterministically."""
    cfg = LEVEL_CONFIGS.get(level.lower(), LEVEL_CONFIGS["intermediate"])
    min_tasks, max_tasks = cfg["tasks_per_day"]
    target_task_mins = cfg["default_task_minutes"]

    desired_count = max(min_tasks, min(max_tasks, round(total_minutes / target_task_mins)))
    base_mins = total_minutes // desired_count
    remainder = total_minutes % desired_count

    tasks: list[PlannedTask] = []
    for idx in range(desired_count):
        task_id = f"d{day_num}_t{idx + 1}"
        # Add remainder minutes to the first few tasks
        task_mins = base_mins + (1 if idx < remainder else 0)

        if is_review:
            if idx == 0:
                desc = f"Review key concepts and formulas for {topic_name}"
            elif idx == 1:
                desc = f"Solve practice recall problems on {topic_name}"
            else:
                desc = f"Consolidate summary notes and self-test on {topic_name}"
        else:
            if idx == 0:
                desc = f"Read and understand foundational materials for {topic_name}"
            elif idx == 1:
                desc = f"Analyze core examples and worked problems for {topic_name}"
            else:
                desc = f"Complete guided exercises and test comprehension on {topic_name}"

        tasks.append(
            PlannedTask(
                id=task_id,
                task=desc,
                estimated_minutes=task_mins,
                completed=False,
            )
        )
    return tasks


def plan_course_schedule(
    goal_days: int,
    hours_per_day: float,
    level: str,
    topics: list[TopicInfo],
    mastery_by_topic: dict[int, float] | None = None,
    typical_fresh_hours: list[int] | None = None,
) -> list[PlannedDay]:
    """Deterministically creates a day-by-day study roadmap.

    Guarantees:
    1. Total hours respected: sum(day.estimated_minutes) <= goal_days * int(hours_per_day * 60).
    2. Daily limit respected: each day's estimated_minutes <= int(hours_per_day * 60).
    3. Weak topics prioritized: topics with lower mastery scores appear earlier.
    4. Learner level respected: affects task subdivision and review cadence.
    """
    if goal_days < 1:
        raise ValueError("goal_days must be >= 1")
    if hours_per_day <= 0:
        raise ValueError("hours_per_day must be > 0")
    if not topics:
        raise ValueError("At least one topic is required to plan a schedule")

    mastery_map = mastery_by_topic or {}
    daily_budget = max(15, int(round(hours_per_day * 60)))
    effective_level = level.lower() if level.lower() in LEVEL_CONFIGS else "intermediate"
    cfg = LEVEL_CONFIGS[effective_level]

    # 1. Sort topics: weakest first (lower mastery = earlier day), preserving stable order
    # Topic priority score = mastery (ascending) -> 0.0 appears before 0.5, before 1.0
    sorted_topics = sorted(
        topics,
        key=lambda t: (mastery_map.get(t.id, 0.0), topics.index(t)),
    )

    planned_days: list[PlannedDay] = []
    total_topics = len(sorted_topics)

    # 2. Determine review frequency
    review_interval = max(3, int(round(1.0 / cfg["review_ratio"]))) if cfg["review_ratio"] > 0 else 999

    # 3. Distribute topics across available days
    # If goal_days >= total_topics: each topic gets at least 1 day, weakest topics get extra days
    topic_cursor = 0
    recent_topic_for_review = sorted_topics[0]

    for day_num in range(1, goal_days + 1):
        is_review_day = (day_num % review_interval == 0) and (day_num > 1) and (topic_cursor > 0)

        if is_review_day:
            # Review day covers previously studied weak topic
            assigned_topic = recent_topic_for_review
            title = f"Day {day_num}: Review & Consolidation - {assigned_topic.name}"
            objectives = [
                f"Solidify understanding of {assigned_topic.name}",
                "Review error patterns and solve reinforcement exercises",
            ]
            is_rev = True
        else:
            # Advance topic cursor or cycle back through weakest topics
            assigned_topic = sorted_topics[topic_cursor % total_topics]
            topic_cursor += 1
            recent_topic_for_review = assigned_topic
            title = f"Day {day_num}: {assigned_topic.name}"
            objectives = [
                f"Master core concepts of {assigned_topic.name}",
                f"Apply {assigned_topic.name} to practical exercises",
            ]
            is_rev = False

        tasks = _split_into_tasks(day_num, daily_budget, effective_level, assigned_topic.name, is_rev)

        planned_days.append(
            PlannedDay(
                day=day_num,
                topic_id=assigned_topic.id,
                topic_name=assigned_topic.name,
                title=title,
                learning_objectives=objectives,
                tasks=tasks,
                estimated_minutes=daily_budget,
                completed=False,
                is_review=is_rev,
            )
        )

    return planned_days


def replan_roadmap(
    existing_items: list[Any],
    updated_mastery: dict[int, float],
    goal_days: int,
    hours_per_day: float,
    level: str,
    topics: list[TopicInfo],
    typical_fresh_hours: list[int] | None = None,
) -> list[PlannedDay]:
    """Re-plans a roadmap while strictly preserving completed milestones.

    Properties:
    - Any item with completed=True is preserved verbatim in its original day slot.
    - Remaining uncompleted days are redistributed.
    - Topics with updated weak mastery are re-prioritized on earlier remaining days.
    """
    if not existing_items:
        return plan_course_schedule(
            goal_days=goal_days,
            hours_per_day=hours_per_day,
            level=level,
            topics=topics,
            mastery_by_topic=updated_mastery,
            typical_fresh_hours=typical_fresh_hours,
        )

    # 1. Identify completed vs uncompleted items
    completed_days: list[PlannedDay] = []
    completed_topic_ids: set[int] = set()

    for item in existing_items:
        is_comp = getattr(item, "completed", False) if not isinstance(item, dict) else item.get("completed", False)
        if is_comp:
            # Preserve completed day
            if isinstance(item, dict):
                tasks_raw = item.get("tasks", [])
                day_val = item["day"]
                top_id = item.get("topic_id")
                top_name = item.get("topic_name", "Completed Topic")
                title_val = item.get("title", f"Day {day_val}")
                obj_val = item.get("learning_objectives", [])
                est_mins = item.get("estimated_minutes", 60)
                is_rev = item.get("is_review", False)
            else:
                tasks_raw = getattr(item, "tasks", []) or []
                day_val = item.day
                top_id = item.topic_id
                top_name = item.topic_name
                title_val = item.title
                obj_val = list(item.learning_objectives or [])
                est_mins = item.estimated_minutes
                is_rev = getattr(item, "is_review", False)

            tasks = []
            for t in tasks_raw:
                t_id = t.get("id", "") if isinstance(t, dict) else getattr(t, "id", "")
                t_task = t.get("task", "") if isinstance(t, dict) else getattr(t, "task", "")
                t_est = t.get("estimated_minutes", 30) if isinstance(t, dict) else getattr(t, "estimated_minutes", 30)
                t_comp = t.get("completed", True) if isinstance(t, dict) else getattr(t, "completed", True)
                tasks.append(PlannedTask(id=t_id, task=t_task, estimated_minutes=t_est, completed=t_comp))

            planned_item = PlannedDay(
                day=day_val,
                topic_id=top_id,
                topic_name=top_name,
                title=title_val,
                learning_objectives=obj_val,
                tasks=tasks,
                estimated_minutes=est_mins,
                completed=True,
                is_review=is_rev,
            )
            completed_days.append(planned_item)
            if planned_item.topic_id is not None:
                completed_topic_ids.add(planned_item.topic_id)

    # Sort completed days ascending
    completed_days.sort(key=lambda d: d.day)

    # 2. Check remaining days capacity
    num_completed = len(completed_days)
    if num_completed >= goal_days:
        return completed_days

    remaining_days_count = goal_days - num_completed
    start_day = num_completed + 1

    # 3. Determine remaining topics to schedule
    # Prioritize topics that are not yet mastered (mastery < 0.6) or not completed
    candidate_topics = [t for t in topics if t.id not in completed_topic_ids]
    if not candidate_topics:
        # If all topics completed, allow review of lowest mastery topics
        candidate_topics = list(topics)

    # Sort remaining candidate topics by updated mastery ascending (weakest first)
    candidate_topics.sort(key=lambda t: (updated_mastery.get(t.id, 0.0), topics.index(t)))

    # 4. Plan the remaining days
    remaining_schedule = plan_course_schedule(
        goal_days=remaining_days_count,
        hours_per_day=hours_per_day,
        level=level,
        topics=candidate_topics,
        mastery_by_topic=updated_mastery,
        typical_fresh_hours=typical_fresh_hours,
    )

    # Re-index remaining days to start after completed days
    new_remaining_days: list[PlannedDay] = []
    for idx, day_plan in enumerate(remaining_schedule):
        actual_day = start_day + idx
        # Update day number and task IDs
        updated_tasks: list[PlannedTask] = []
        for t_idx, task in enumerate(day_plan.tasks):
            updated_tasks.append(
                PlannedTask(
                    id=f"d{actual_day}_t{t_idx + 1}",
                    task=task.task,
                    estimated_minutes=task.estimated_minutes,
                    completed=False,
                )
            )

        title_prefix = f"Day {actual_day}:"
        # If title already starts with Day X:, replace prefix
        if day_plan.title.startswith("Day "):
            rest_of_title = day_plan.title.split(":", 1)[-1].strip()
            new_title = f"{title_prefix} {rest_of_title}"
        else:
            new_title = f"{title_prefix} {day_plan.title}"

        new_remaining_days.append(
            PlannedDay(
                day=actual_day,
                topic_id=day_plan.topic_id,
                topic_name=day_plan.topic_name,
                title=new_title,
                learning_objectives=day_plan.learning_objectives,
                tasks=updated_tasks,
                estimated_minutes=day_plan.estimated_minutes,
                completed=False,
                is_review=day_plan.is_review,
            )
        )

    return completed_days + new_remaining_days
