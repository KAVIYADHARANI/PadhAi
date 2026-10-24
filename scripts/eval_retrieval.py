"""Evaluation script for hybrid retrieval and sufficiency gate.

Usage:
    python scripts/eval_retrieval.py [--dataset eval/retrieval_set.json] [--output-dir eval/results]

Computes:
- Hit@3, Hit@5, Hit@8 on answerable questions
- Citation page correctness (Top-1 page match)
- Sufficiency gate precision, recall, and refusal accuracy on unanswerable questions
- Prints summary table to stdout and writes JSON results to eval/results/retrieval_<timestamp>.json
"""

import argparse
import datetime
import json
import logging
import sys
from pathlib import Path

# Add backend to sys.path so we can import app modules directly
sys_path_root = Path(__file__).resolve().parent.parent
backend_path = sys_path_root / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from app.ai.embedding.embedder import FakeEmbedder
from app.core.config import settings
from app.db.models import Chunk, Course, Document, User
from app.retrieval.search import hybrid_search
from app.retrieval.sufficiency import check_sufficiency

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("eval_retrieval")


# Sample syllabus material used if course is not yet populated
SAMPLE_COURSE_PAGES = [
    {
        "page": 1,
        "heading": "Processor Architecture > Fundamentals",
        "text": (
            "The Central Processing Unit (CPU) executes instructions. The Program Counter (PC) stores "
            "the memory address of the next instruction to fetch. During fetch, the instruction is loaded into "
            "the Instruction Register (IR), which holds the opcode for decoding. The Arithmetic Logic Unit (ALU) "
            "performs arithmetic and logic operations during execute. General purpose registers store immediate operands "
            "to minimize memory bus traffic in a load-store architecture."
        ),
    },
    {
        "page": 2,
        "heading": "Pipelining > Five-Stage Pipeline & Hazards",
        "text": (
            "A standard five-stage RISC instruction pipeline comprises: Instruction Fetch (IF), "
            "Instruction Decode (ID), Execute (EX), Memory Access (MEM), and Writeback (WB). Structural hazards "
            "arise from resource conflicts such as unified memory access. Data hazards occur when an instruction depends "
            "on previous results; operand forwarding resolves RAW dependencies without stalling. Control hazards caused by "
            "branches are mitigated by dynamic branch prediction and speculative execution."
        ),
    },
    {
        "page": 3,
        "heading": "Memory Hierarchy > Caches",
        "text": (
            "Memory hierarchies exploit temporal locality (recently accessed items are reused) and "
            "spatial locality (nearby items are referenced soon). Multi-level caches (L1, L2, L3) minimize Average "
            "Memory Access Time (AMAT). Direct-mapped caches map each block to one line, while N-way set-associative caches "
            "allow flexibility using index and tag checks. Write policies include write-through (immediate memory update) "
            "and write-back (updates memory only on block eviction using a dirty bit)."
        ),
    },
    {
        "page": 4,
        "heading": "Virtual Memory > Translation & Paging",
        "text": (
            "Virtual memory provides process memory isolation and uniform address spaces. The Memory Management "
            "Unit (MMU) translates virtual page numbers to physical frames using page tables. A Translation Lookaside "
            "Buffer (TLB) caches recent translations; a TLB miss forces a hardware or software page table walk. When a "
            "referenced page has its valid bit cleared, a page fault exception triggers the operating system to swap "
            "the page in from secondary storage. Inverted page tables index by physical frame to save memory."
        ),
    },
    {
        "page": 5,
        "heading": "I/O Architecture > Direct Memory Access & Interrupts",
        "text": (
            "Input/Output subsystems interface CPU and peripherals. Programmed I/O requires polling status registers. "
            "Interrupt-driven I/O alerts the CPU when data is ready, indexing an Interrupt Vector Table (IVT) to jump "
            "to the Interrupt Service Routine (ISR). Direct Memory Access (DMA) controllers act as bus masters to transfer "
            "blocks of data directly between peripheral devices and main memory without CPU intervention, dramatically "
            "increasing throughput for disk and network operations."
        ),
    },
]


async def ensure_eval_course(db, course_name: str, embedder) -> tuple[int, int]:
    """Ensure evaluation course and sample chunks exist in the database."""
    user = db.query(User).filter(User.firebase_uid == "eval_system_user").first()
    if not user:
        user = User(
            firebase_uid="eval_system_user",
            email="eval@learnos.internal",
            display_name="Eval Benchmark Runner",
        )
        db.add(user)
        db.commit()

    course = (
        db.query(Course)
        .filter(Course.user_id == user.id, Course.name == course_name)
        .first()
    )
    if not course:
        course = Course(user_id=user.id, name=course_name, goal_days=30, hours_per_day=1.0)
        db.add(course)
        db.commit()

    # Check if chunks exist
    existing_chunks = db.query(Chunk).filter(Chunk.course_id == course.id).count()
    if existing_chunks == 0:
        logger.info("Seeding evaluation course '%s' with benchmark syllabus pages...", course_name)
        doc = Document(course_id=course.id, user_id=user.id, file_uri="benchmark_syllabus.pdf", status="ready")
        db.add(doc)
        db.commit()

        texts = [p["text"] for p in SAMPLE_COURSE_PAGES]
        vectors = await embedder.embed_texts(texts)

        for page_data, vec in zip(SAMPLE_COURSE_PAGES, vectors, strict=False):
            chunk = Chunk(
                document_id=doc.id,
                course_id=course.id,
                user_id=user.id,
                page=page_data["page"],
                heading_path=page_data["heading"],
                text=page_data["text"],
                embedding=vec,
                low_conf=False,
                injection_flag=False,
            )
            db.add(chunk)
        db.commit()

    return user.id, course.id


def get_eval_session_factory(db_url: str | None = None):
    """Obtain session factory with automatic fallback to SQLite if Postgres is unavailable."""
    from app.db.session import Base
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    target_url = db_url or "sqlite:///eval/eval_benchmark.db"
    engine = create_engine(target_url, echo=False)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


async def run_evaluation(
    dataset_path: Path,
    output_dir: Path,
    min_score: float | None = None,
    db_url: str | None = None,
):
    """Run full retrieval evaluation over benchmark dataset."""
    if not dataset_path.exists():
        logger.error("Dataset not found at: %s", dataset_path)
        sys.exit(1)

    items = json.loads(dataset_path.read_text(encoding="utf-8"))
    logger.info("Loaded %d evaluation items from %s", len(items), dataset_path)

    embedder = FakeEmbedder(dim=1024)
    threshold = min_score if min_score is not None else (settings.RETRIEVAL_MIN_SCORE or 0.015)

    eval_session_maker = get_eval_session_factory(db_url)
    with eval_session_maker() as db:
        first_course_name = items[0].get("course_name", "Computer Systems")
        user_id, course_id = await ensure_eval_course(db, first_course_name, embedder)

        total_answerable = 0
        hits_at_3 = 0
        hits_at_5 = 0
        hits_at_8 = 0
        top1_correct_page = 0

        # Sufficiency Gate Tracking
        # Answerable: expected is_sufficient=True (Positive)
        # Unanswerable: expected is_sufficient=False (Negative)
        tp = 0  # answerable & sufficient
        fn = 0  # answerable & insufficient (false refusal)
        tn = 0  # unanswerable & insufficient (correct refusal)
        fp = 0  # unanswerable & sufficient (hallucination leak)

        eval_records = []

        for item in items:
            q_text = item["question"]
            is_answerable = item["answerable"]
            exp_page = item.get("expected_page")

            # Embed query
            q_vec = (await embedder.embed_texts([q_text]))[0]

            # Execute hybrid retrieval
            results = hybrid_search(
                query_text=q_text,
                query_vector=q_vec,
                course_id=course_id,
                user_id=user_id,
                db=db,
                limit=8,
            )

            # Sufficiency check
            gate = check_sufficiency(results, min_score=threshold)

            # Metric accounting
            if is_answerable:
                total_answerable += 1
                pages_top3 = [r.page for r in results[:3]]
                pages_top5 = [r.page for r in results[:5]]
                pages_top8 = [r.page for r in results[:8]]

                hit_3 = exp_page in pages_top3
                hit_5 = exp_page in pages_top5
                hit_8 = exp_page in pages_top8
                page_correct = len(results) > 0 and results[0].page == exp_page

                if hit_3:
                    hits_at_3 += 1
                if hit_5:
                    hits_at_5 += 1
                if hit_8:
                    hits_at_8 += 1
                if page_correct:
                    top1_correct_page += 1

                if gate.is_sufficient:
                    tp += 1
                else:
                    fn += 1
            else:
                if not gate.is_sufficient:
                    tn += 1
                else:
                    fp += 1

            eval_records.append(
                {
                    "id": item["id"],
                    "question": q_text,
                    "answerable": is_answerable,
                    "expected_page": exp_page,
                    "retrieved_pages": [r.page for r in results],
                    "top_score": gate.best_score,
                    "gate_sufficient": gate.is_sufficient,
                }
            )

    # Compute aggregate percentages
    hit_rate_3 = (hits_at_3 / total_answerable) * 100 if total_answerable else 0.0
    hit_rate_5 = (hits_at_5 / total_answerable) * 100 if total_answerable else 0.0
    hit_rate_8 = (hits_at_8 / total_answerable) * 100 if total_answerable else 0.0
    citation_acc = (top1_correct_page / total_answerable) * 100 if total_answerable else 0.0

    total_unanswerable = tn + fp
    unanswerable_refusal_rate = (tn / total_unanswerable) * 100 if total_unanswerable else 0.0
    precision = (tp / (tp + fp)) * 100 if (tp + fp) else 0.0
    recall = (tp / (tp + fn)) * 100 if (tp + fn) else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) else 0.0

    summary = {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "total_questions": len(items),
        "answerable_questions": total_answerable,
        "unanswerable_questions": total_unanswerable,
        "threshold": threshold,
        "metrics": {
            "hit_rate_at_3_pct": round(hit_rate_3, 2),
            "hit_rate_at_5_pct": round(hit_rate_5, 2),
            "hit_rate_at_8_pct": round(hit_rate_8, 2),
            "citation_page_accuracy_pct": round(citation_acc, 2),
            "unanswerable_refusal_rate_pct": round(unanswerable_refusal_rate, 2),
            "gate_precision_pct": round(precision, 2),
            "gate_recall_pct": round(recall, 2),
            "gate_f1_score": round(f1, 2),
        },
        "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
    }

    banner_title = f"{settings.PRODUCT_NAME.upper()} RETRIEVAL & SUFFICIENCY EVALUATION"
    table_lines = [
        "",
        "====================================================================",
        f"             {banner_title:^50}             ",
        "====================================================================",
        f" Dataset: {dataset_path.name} | Questions: {len(items)} (Answerable: {total_answerable}, Unanswerable: {total_unanswerable})",
        f" Sufficiency Threshold: {threshold}",
        "--------------------------------------------------------------------",
        " Metric                               | Result                      ",
        "--------------------------------------+-----------------------------",
        f" Hit Rate @ 3                         | {hit_rate_3:6.2f}% ({hits_at_3}/{total_answerable})",
        f" Hit Rate @ 5                         | {hit_rate_5:6.2f}% ({hits_at_5}/{total_answerable})",
        f" Hit Rate @ 8                         | {hit_rate_8:6.2f}% ({hits_at_8}/{total_answerable})",
        f" Citation Page Correctness (Top-1)    | {citation_acc:6.2f}% ({top1_correct_page}/{total_answerable})",
        f" Unanswerable Refusal Rate            | {unanswerable_refusal_rate:6.2f}% ({tn}/{total_unanswerable})",
        f" Gate Precision                       | {precision:6.2f}%",
        f" Gate Recall                          | {recall:6.2f}%",
        f" Gate F1 Score                        | {f1:6.2f}%",
        "====================================================================",
        "",
    ]
    print("\n".join(table_lines))

    # Save JSON results
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = output_dir / f"retrieval_{timestamp_str}.json"
    full_output = {**summary, "records": eval_records}
    out_file.write_text(json.dumps(full_output, indent=2), encoding="utf-8")
    logger.info("Saved evaluation results to: %s", out_file)


if __name__ == "__main__":
    import asyncio

    parser = argparse.ArgumentParser(description="Evaluate hybrid retrieval performance.")
    parser.add_argument("--dataset", type=Path, default=Path("eval/retrieval_set.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("eval/results"))
    parser.add_argument("--min-score", type=float, default=None, help="Sufficiency minimum score threshold")
    parser.add_argument("--db-url", type=str, default=None, help="Database connection URL")
    args = parser.parse_args()

    asyncio.run(run_evaluation(args.dataset, args.output_dir, args.min_score, args.db_url))
