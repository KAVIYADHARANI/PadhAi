"""Ingestion worker entrypoint.

Processes a single document:
- Lifecycle: queued -> processing -> ready / failed
- Enforces MAX_PAGES_PER_DOC page caps and timeouts
- Records pages, pages_ocr, ocr_avg_conf
- Saves extracted chunks with heading_path, low_conf, and injection_flag
"""

import logging
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.storage import StorageBackend, get_storage
from app.db.models import Chunk, Document
from app.db.session import SessionLocal
from app.ingestion.chunker import chunk_document
from app.ingestion.injection_scan import scan_prompt_injection
from app.ingestion.loader import OCREngine, PageLimitExceededError, load_document_pages

logger = logging.getLogger(__name__)


def process_document(
    document_id: int,
    db: Session,
    storage: StorageBackend | None = None,
    ocr_engine: OCREngine | None = None,
) -> Document:
    """Processes an uploaded document through the ingestion pipeline.

    Args:
        document_id: Database ID of the document to process.
        db: SQLAlchemy session.
        storage: Optional storage backend override.
        ocr_engine: Optional OCR engine override for testing.

    Returns:
        The updated Document instance.
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise ValueError(f"Document with ID {document_id} does not exist.")

    # 1. Update status to processing
    document.status = "processing"
    document.error = None
    db.commit()
    db.refresh(document)

    storage_backend = storage or get_storage()

    try:
        with db.begin_nested():
            # 2. Resolve file path
            file_path: Path | str
            if hasattr(storage_backend, "get_path"):
                file_path = storage_backend.get_path(document.file_uri)
            else:
                file_path = document.file_uri

            # 3. Load and extract pages (with text-layer check and OCR fallback)
            pages = load_document_pages(
                file_path=file_path,
                ocr_mode=settings.OCR_MODE,
                min_line_conf=settings.OCR_MIN_LINE_CONF,
                max_pages=settings.MAX_PAGES_PER_DOC,
                ocr_engine=ocr_engine,
            )

            total_pages = len(pages)
            ocr_pages_list = [p for p in pages if p.is_ocr]
            total_ocr_pages = len(ocr_pages_list)

            if total_ocr_pages > 0:
                avg_conf = sum(p.avg_confidence for p in ocr_pages_list) / total_ocr_pages
            else:
                avg_conf = 1.0

            # 4. Heading-aware chunking
            chunk_data_items = chunk_document(
                pages=pages,
                target_min_tokens=400,
                target_max_tokens=800,
            )

            # 5. Scan for prompt injection and persist chunks
            for item in chunk_data_items:
                has_injection = scan_prompt_injection(item.text)
                chunk = Chunk(
                    document_id=document.id,
                    course_id=document.course_id,
                    user_id=document.user_id,
                    page=item.page,
                    heading_path=item.heading_path,
                    text=item.text,
                    low_conf=item.low_conf,
                    injection_flag=has_injection,
                )
                db.add(chunk)

            # 6. Update document metrics and ready status
            document.pages = total_pages
            document.pages_ocr = total_ocr_pages
            document.ocr_avg_conf = round(avg_conf, 4)
            document.status = "ready"
            document.error = None

        db.commit()
        db.refresh(document)
        logger.info(
            "Document %d processed successfully: %d pages, %d chunks, status ready",
            document.id,
            total_pages,
            len(chunk_data_items),
        )
        return document

    except PageLimitExceededError as err:
        document.status = "failed"
        document.error = f"Page limit exceeded: {err}"
        db.commit()
        db.refresh(document)
        logger.warning("Document %d failed page limit: %s", document_id, err)
        return document

    except Exception as err:
        document.status = "failed"
        document.error = str(err)
        db.commit()
        db.refresh(document)
        logger.error("Document %d processing failed: %s", document_id, err, exc_info=True)
        return document


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.worker.ingest_worker <document_id>")
        sys.exit(1)

    doc_id = int(sys.argv[1])
    with SessionLocal() as session:
        result_doc = process_document(doc_id, session)
        print(f"Document {result_doc.id} finished with status: {result_doc.status}")
        if result_doc.error:
            print(f"Error: {result_doc.error}")
