"""Insights Agent package."""

from app.ai.insights.insights_gen import (
    compute_course_insights_aggregates,
    format_deterministic_insights_overview,
    generate_insights_summary,
)

__all__ = [
    "compute_course_insights_aggregates",
    "format_deterministic_insights_overview",
    "generate_insights_summary",
]
