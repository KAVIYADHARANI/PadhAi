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
    file_uri: str
    pages: int | None = None
    pages_ocr: int | None = None
    ocr_avg_conf: float | None = None
    status: str
    error: str | None = None
    created_at: datetime
