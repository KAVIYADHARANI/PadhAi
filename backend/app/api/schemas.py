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
    chunks_count: int = 0
    is_indexed: bool = False
    created_at: datetime


class TopicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    name: str
    parent_id: int | None = None
    module_name: str | None = None
    description: str | None = None
    learning_objective: str | None = None
    chunks_count: int = 0
    pages: list[int] = Field(default_factory=list)


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


class RoadmapTaskItem(BaseModel):
    id: str
    task: str
    estimated_minutes: int = 30
    completed: bool = False


class RoadmapItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    day: int
    topic_id: int | None = None
    topic_name: str
    title: str
    learning_objectives: list[str] = Field(default_factory=list)
    tasks: list[RoadmapTaskItem] = Field(default_factory=list)
    estimated_minutes: int
    completed: bool
    created_at: datetime
    updated_at: datetime


class RoadmapProgressResponse(BaseModel):
    course_id: int
    total_days: int
    completed_days: int
    total_tasks: int
    completed_tasks: int
    percent_complete: float
    items: list[RoadmapItemResponse]


class RoadmapItemUpdateRequest(BaseModel):
    completed: bool | None = None
    task_id: str | None = None
    task_completed: bool | None = None


class SourceReference(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: int
    document_name: str
    page: int
    chunk_id: int | None = None
    heading: str | None = None


class ChatMessageItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    citations: list[str] = Field(default_factory=list)
    sources: list[SourceReference] = Field(default_factory=list)
    tone: str | None = None
    is_sufficient: bool = True
    grounding_status: str = "grounded"
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    course_id: int
    thread_id: int | None = None
    messages: list[ChatMessageItem]


# --- Study Sessions & Buddy State Schemas ---


class StudySessionCreateRequest(BaseModel):
    course_id: int


class StudySessionUpdateRequest(BaseModel):
    pomodoros: int | None = None
    focus_avg: float | None = None
    drowsy_minutes: float | None = None
    ended: bool = False


class StudySessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    course_id: int
    started_at: datetime
    ended_at: datetime | None = None
    pomodoros: int
    focus_avg: float | None = None
    drowsy_minutes: float | None = None


class BreakEventCreateRequest(BaseModel):
    break_type: str
    outcome: str  # "accepted" | "dismissed" | "ignored"
    cooldown_at_time_s: int


class BreakEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    user_id: int
    break_type: str
    outcome: str
    cooldown_at_time_s: int
    created_at: datetime


class BuddySettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    persona_pack: str
    tone_mode: str
    address_term: str
    sensitivity: str
    camera_enabled: bool


class BuddySettingsUpdateRequest(BaseModel):
    persona_pack: str | None = None
    tone_mode: str | None = None
    address_term: str | None = None
    sensitivity: str | None = None
    camera_enabled: bool | None = None
