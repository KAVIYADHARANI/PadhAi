"""Pydantic v2 schemas for API requests and responses."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    firebase_uid: str
    email: str | None = None
    display_name: str | None = None
    created_at: datetime


class CourseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    goal_days: int = Field(default=30, ge=1, le=365)
    hours_per_day: float = Field(default=1.0, gt=0, le=24.0)
    level: str = Field(default="beginner", max_length=50)


class CourseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    goal_days: int
    hours_per_day: float
    level: str
    created_at: datetime


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    filename: str
    size_bytes: int | None = None
    pages: int | None = None
    pages_ocr: int | None = None
    ocr_avg_conf: float | None = None
    status: str
    error: str | None = None
    created_at: datetime


class TopicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    name: str
    parent_id: int | None = None


class QuizGenerateRequest(BaseModel):
    course_id: int
    topic_id: int
    count: int = Field(default=5, ge=1, le=20)


class QuizQuestionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    topic_id: int
    stem: str
    question_type: str = "mcq"
    options: list[str]
    difficulty: float = 1.0


class QuizResponse(BaseModel):
    course_id: int
    topic_id: int
    questions: list[QuizQuestionItem]


class AttemptSubmitRequest(BaseModel):
    question_id: int
    selected_answer: str
    time_ms: int = Field(default=0, ge=0)


class AttemptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    selected_answer: str
    correct: bool
    answer: str
    explanation: str
    source_chunk_ids: list[int]
    new_mastery_score: float
    time_ms: int
    created_at: datetime


class TopicMasteryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    topic_id: int
    topic_name: str
    score: float
    attempts_count: int
    updated_at: datetime | None = None


class ProgressResponse(BaseModel):
    course_id: int
    topics: list[TopicMasteryItem]
    weak_topics: list[int]

