"""Courses and document upload API router."""

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.schemas import CourseCreate, CourseResponse, DocumentResponse, TopicResponse
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.logging import get_logger
from app.core.storage import StorageBackend, get_storage
from app.db.models import Course, Document, Topic, User
from app.db.session import get_db

logger = get_logger(__name__)

router = APIRouter(prefix="/api/courses", tags=["courses"])

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/tiff",
}

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tiff"}


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseResponse:
    """Creates a new course belonging to the current authenticated user."""
    course = Course(
        user_id=current_user.id,
        name=payload.name,
        goal_days=payload.goal_days,
        hours_per_day=payload.hours_per_day,
        level=payload.level,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseResponse.model_validate(course)


@router.get("", response_model=list[CourseResponse])
def list_courses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CourseResponse]:
    """Lists all courses owned by the authenticated user."""
    courses = db.query(Course).filter(Course.user_id == current_user.id).all()
    return [CourseResponse.model_validate(c) for c in courses]


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    """Deletes a course and its associated documents, strictly scoped to user_id."""
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Delete physical storage for course documents
    docs = (
        db.query(Document)
        .filter(Document.course_id == course.id, Document.user_id == current_user.id)
        .all()
    )
    for doc in docs:
        storage.delete(doc.file_uri)

    db.delete(course)
    db.commit()


def _run_ingestion_background(doc_id: int) -> None:
    from app.db.session import SessionLocal
    from app.worker.ingest_worker import process_document_sync

    with SessionLocal() as session:
        try:
            process_document_sync(doc_id, session)
        except Exception as exc:
            logger.error("Background ingestion failed for doc %d: %s", doc_id, exc, exc_info=True)


@router.get("/{course_id}/documents", response_model=list[DocumentResponse])
def list_course_documents(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentResponse]:
    """Lists all documents belonging to a user's course, ordered by creation date desc."""
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    docs = (
        db.query(Document)
        .filter(Document.course_id == course.id, Document.user_id == current_user.id)
        .order_by(Document.created_at.desc())
        .all()
    )
    responses: list[DocumentResponse] = []
    for doc in docs:
        c_count = len(doc.chunks) if doc.chunks else 0
        resp = DocumentResponse(
            id=doc.id,
            course_id=doc.course_id,
            filename=doc.filename,
            size_bytes=doc.size_bytes,
            pages=doc.pages,
            pages_ocr=doc.pages_ocr,
            ocr_avg_conf=doc.ocr_avg_conf,
            status=doc.status,
            error=doc.error,
            chunks_count=c_count,
            is_indexed=(doc.status == "ready" and c_count > 0),
            created_at=doc.created_at,
        )
        responses.append(resp)
    return responses


@router.get("/{course_id}/topics", response_model=list[TopicResponse])
def list_course_topics(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopicResponse]:
    """Lists all syllabus topics for a course with modules, objectives, and page evidence."""
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    topics = db.query(Topic).filter(Topic.course_id == course_id).all()
    responses: list[TopicResponse] = []
    for t in topics:
        chunk_pages = sorted(list({c.page for c in t.chunks if c.page}))
        responses.append(
            TopicResponse(
                id=t.id,
                course_id=t.course_id,
                name=t.name,
                parent_id=t.parent_id,
                module_name=t.module_name or "General Concepts",
                description=t.description,
                learning_objective=t.learning_objective,
                chunks_count=len(t.chunks),
                pages=chunk_pages,
            )
        )
    return responses


@router.post("/{course_id}/documents/{document_id}/reprocess", response_model=DocumentResponse)
def reprocess_document(
    course_id: int,
    document_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentResponse:
    """Safely re-extracts, chunks, embeds, and updates topics for an existing document."""
    doc = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.course_id == course_id,
            Document.user_id == current_user.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found in this course",
        )

    doc.status = "queued"
    doc.error = None
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(_run_ingestion_background, doc.id)

    return DocumentResponse(
        id=doc.id,
        course_id=doc.course_id,
        filename=doc.filename,
        size_bytes=doc.size_bytes,
        pages=doc.pages,
        pages_ocr=doc.pages_ocr,
        ocr_avg_conf=doc.ocr_avg_conf,
        status="queued",
        error=None,
        chunks_count=0,
        is_indexed=False,
        created_at=doc.created_at,
    )


@router.post("/{course_id}/reprocess-topics", response_model=list[TopicResponse])
async def reprocess_course_topics(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopicResponse]:
    """Re-extracts and normalizes syllabus topics across all existing course chunks."""
    from app.ai.harness.gateway import LLMGateway
    from app.ai.topics.topic_grouping import group_chunks_into_topics
    from app.db.models import Chunk

    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    chunks = (
        db.query(Chunk)
        .filter(Chunk.course_id == course_id, Chunk.user_id == current_user.id)
        .order_by(Chunk.id.asc())
        .all()
    )
    if not chunks:
        return []

    gateway = LLMGateway()
    updated_topics = await group_chunks_into_topics(
        course_id=course_id,
        chunks=chunks,
        gateway=gateway,
        db=db,
        course_name=course.name,
    )

    responses: list[TopicResponse] = []
    for t in updated_topics:
        chunk_pages = sorted(list({c.page for c in t.chunks if c.page}))
        responses.append(
            TopicResponse(
                id=t.id,
                course_id=t.course_id,
                name=t.name,
                parent_id=t.parent_id,
                module_name=t.module_name or "General Concepts",
                description=t.description,
                learning_objective=t.learning_objective,
                chunks_count=len(t.chunks),
                pages=chunk_pages,
            )
        )
    return responses


@router.post(
    "/{course_id}/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_document(
    course_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> DocumentResponse:
    """Validates and uploads a document to a user's course, creating a queued document row."""
    # Strict ownership check on course
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    filename = file.filename or "uploaded_file"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file extension '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported MIME type '{content_type}'. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}",
        )

    # Read and check size
    file_bytes = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File exceeds maximum size limit of {settings.MAX_UPLOAD_MB} MB",
        )

    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # Store via StorageBackend
    file_uri = storage.save(file_bytes, filename, content_type)

    try:
        doc = Document(
            course_id=course.id,
            user_id=current_user.id,
            file_uri=file_uri,
            status="queued",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
    except Exception:
        db.rollback()
        storage.delete(file_uri)
        raise

    background_tasks.add_task(_run_ingestion_background, doc.id)

    return DocumentResponse.model_validate(doc)
