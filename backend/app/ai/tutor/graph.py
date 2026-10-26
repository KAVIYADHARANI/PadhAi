"""LangGraph pipeline for multi-agent routing with layered guardrails.

Architecture:
START -> guard_in -> [conditional: blocked/distress -> guard_out -> END]
                   -> router -> [conditional:
                                 confirm_chip -> confirm_chip_node
                                 tutor -> tutor_node
                                 insights -> insights_node
                                 quiz_gen -> quiz_gen_node
                                 flashcards -> flashcards_node
                                 roadmap -> roadmap_node]
                   -> guard_out -> END

Security & Grounding Guarantees:
1. Fixed deterministic pipeline (no autonomous tool selection or arbitrary write tools).
2. Uploaded documents wrapped in untrusted data delimiters.
3. Chunks with injection_flag are explicitly labelled untrusted="true".
4. If retrieval is insufficient, returns fixed refusal with 0 MODEL_SMART calls.
5. All [doc p.N] citations must map to retrieved source chunks; ungrounded answers
   fall back to a safe "could not verify" message.
6. Guardrail events recorded to DB with layer, rule, action — NO message/document text.
7. Router classifies queries via UI intent -> rules -> cache -> fast LLM, ensuring
   write agents require confirmation when confidence < ROUTER_CONFIRM_BELOW.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from app.ai.embedding.embedder import get_embedder
from app.ai.guardrails.input_guard import (
    GuardrailAuditRecord,
    check_input_guardrails,
)
from app.ai.guardrails.output_guard import check_output_guardrails
from app.ai.harness.gateway import LLMGateway
from app.ai.insights.insights_gen import generate_insights_summary
from app.ai.router.router import route_message
from app.ai.router.schemas import RouteDecision
from app.buddy.tone import ToneContext, select_tone
from app.db.models import GuardrailEvent
from app.persona.prompt_builder import build_tutor_system_prompt
from app.retrieval.search import SearchResult, broad_course_search, hybrid_search, is_broad_query
from app.retrieval.sufficiency import check_sufficiency

logger = logging.getLogger(__name__)

INSUFFICIENT_REFUSAL = (
    "The uploaded materials do not cover this topic. "
    "Would you like me to search other documents or answer from general knowledge?"
)


class TutorState(TypedDict, total=False):
    """Execution state flowing through the orchestrator graph."""

    db: Session
    gateway: LLMGateway
    user_id: int
    course_id: int
    message: str
    tone_context: ToneContext
    intent: str | None
    history: list[dict[str, str]] | None

    # Routing fields
    route_decision: RouteDecision | None
    route_agent: str | None
    route_source: str | None
    route_confidence: float | None
    confirmation_chip: str | None
    follow_up_chip: str | None
    topic_hint: str | None

    # Intermediate / Output fields
    is_blocked: bool
    is_sufficient: bool
    grounding_status: str
    tone: str
    retrieved_chunks: list[SearchResult]
    raw_response: str
    clean_answer: str
    final_reply: str
    citations: list[str]
    sources: list[dict[str, Any]]
    audit_records: list[GuardrailAuditRecord]


def guard_in_node(state: TutorState) -> dict[str, Any]:
    """Execute input guardrails: length check, wellbeing distress, injection scan."""
    message = state.get("message", "")
    guard_result = check_input_guardrails(message)

    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))
    records.extend(guard_result.audit_records)

    if guard_result.is_blocked:
        return {
            "is_blocked": True,
            "final_reply": guard_result.response_override or "",
            "clean_answer": guard_result.response_override or "",
            "citations": [],
            "sources": [],
            "is_sufficient": False,
            "grounding_status": "blocked",
            "audit_records": records,
        }

    return {
        "is_blocked": False,
        "audit_records": records,
    }


def route_after_guard_in(state: TutorState) -> str:
    """Routing condition after guard_in."""
    if state.get("is_blocked", False):
        return "guard_out"
    return "router"


async def router_node(state: TutorState) -> dict[str, Any]:
    """Classifies user intent via UI -> rules -> cache -> fast LLM."""
    message = state["message"]
    history = state.get("history")
    explicit_intent = state.get("intent")
    gateway = state.get("gateway")
    user_id = state.get("user_id")

    decision = await route_message(
        message=message,
        history=history,
        explicit_intent=explicit_intent,
        gateway=gateway,
        user_id=user_id,
    )
    return {
        "route_decision": decision,
        "route_agent": decision.agent,
        "route_source": decision.source,
        "route_confidence": decision.confidence,
        "confirmation_chip": decision.confirmation_chip,
        "follow_up_chip": decision.follow_up_chip,
        "topic_hint": decision.topic_hint,
    }


def route_after_router(state: TutorState) -> str:
    """Routes to chosen specialist agent or confirmation prompt."""
    if state.get("confirmation_chip"):
        return "confirm_chip"
    agent = state.get("route_agent", "tutor")
    if agent in ("tutor", "insights", "quiz_gen", "flashcards", "roadmap"):
        return agent
    return "tutor"


async def insights_node(state: TutorState) -> dict[str, Any]:
    """Generates pure SQL aggregates and short fast summary."""
    db: Session = state["db"]
    user_id = state["user_id"]
    course_id = state["course_id"]
    gateway = state.get("gateway")

    text, _ = await generate_insights_summary(
        course_id=course_id,
        user_id=user_id,
        db=db,
        gateway=gateway,
    )
    return {
        "final_reply": text,
        "clean_answer": text,
        "citations": [],
        "sources": [],
        "is_sufficient": True,
        "grounding_status": "grounded",
    }


async def quiz_gen_node(state: TutorState) -> dict[str, Any]:
    """Prepares and navigates student to practice quiz."""
    topic = state.get("topic_hint")
    topic_str = f" on {topic}" if topic else ""
    text = (
        f"I'm ready to quiz you{topic_str}! "
        f"You can jump into the Practice Quiz tab to take a dedicated quiz, "
        f"or let me know if you would like me to ask practice questions directly here."
    )
    return {
        "final_reply": text,
        "clean_answer": text,
        "citations": [],
        "sources": [],
        "is_sufficient": True,
        "grounding_status": "grounded",
    }


async def flashcards_node(state: TutorState) -> dict[str, Any]:
    """Prepares flashcards and provides deck review summary."""
    topic = state.get("topic_hint")
    topic_str = f" for {topic}" if topic else ""
    text = (
        f"Your flashcards{topic_str} are available in the Flashcards tab. "
        f"You can review your spaced repetition cards and track your retention intervals there!"
    )
    return {
        "final_reply": text,
        "clean_answer": text,
        "citations": [],
        "sources": [],
        "is_sufficient": True,
        "grounding_status": "grounded",
    }


async def roadmap_node(state: TutorState) -> dict[str, Any]:
    """Surfaces study roadmap milestones and replan options."""
    text = (
        "Here is your personalized study roadmap. "
        "Head over to the Roadmap tab to view your daily schedule, track completed milestones, "
        "or request an automatic re-plan when your mastery updates!"
    )
    return {
        "final_reply": text,
        "clean_answer": text,
        "citations": [],
        "sources": [],
        "is_sufficient": True,
        "grounding_status": "grounded",
    }


def confirm_chip_node(state: TutorState) -> dict[str, Any]:
    """Renders confirmation prompt for write agents below confidence threshold."""
    chip = state.get("confirmation_chip", "Would you like me to proceed?")
    text = f"Before I proceed: {chip}"
    return {
        "final_reply": text,
        "clean_answer": text,
        "citations": [],
        "sources": [],
        "is_sufficient": True,
        "grounding_status": "grounded",
    }


async def tutor_node(state: TutorState) -> dict[str, Any]:
    """Retrieval, sufficiency gating, and grounded answer generation."""
    db: Session = state["db"]
    gateway: LLMGateway = state.get("gateway") or LLMGateway()
    user_id = state["user_id"]
    course_id = state["course_id"]
    message = state["message"]
    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))

    # 1. Scoped hybrid or broad retrieval
    is_broad = is_broad_query(message)
    if is_broad:
        results = broad_course_search(
            course_id=course_id,
            user_id=user_id,
            db=db,
            limit=10,
        )
        sufficiency = check_sufficiency(results, is_broad=True)
    else:
        embedder = get_embedder()
        vectors = await embedder.embed_texts([message])
        q_vec = vectors[0] if vectors else [0.0] * 1024

        results = hybrid_search(
            query_text=message,
            query_vector=q_vec,
            course_id=course_id,
            user_id=user_id,
            db=db,
            limit=6,
        )
        sufficiency = check_sufficiency(results)

        # 2. If insufficient, attempt 1 query rewrite with fast model
        if not sufficiency.is_sufficient:
            try:
                rewrite_prompt = (
                    f"Rewrite this student question into 2-4 keywords for textbook index search. "
                    f"Question: {message}\nKeywords:"
                )
                rewrite_res = await gateway.chat_completion(
                    messages=[{"role": "user", "content": rewrite_prompt}],
                    role="fast",
                    temperature=0.0,
                    max_tokens=20,
                )
                rewritten_query = rewrite_res.text.strip()
                if rewritten_query:
                    vectors_r2 = await embedder.embed_texts([rewritten_query])
                    q_vec_r2 = vectors_r2[0] if vectors_r2 else q_vec
                    results_round2 = hybrid_search(
                        query_text=rewritten_query,
                        query_vector=q_vec_r2,
                        course_id=course_id,
                        user_id=user_id,
                        db=db,
                        limit=6,
                    )
                    sufficiency_round2 = check_sufficiency(results_round2)
                    if sufficiency_round2.is_sufficient:
                        results = results_round2
                        sufficiency = sufficiency_round2
            except Exception as e:
                logger.debug("Query rewrite fallback skipped: %s", e)

    # 3. Gating check: fail closed without generating hallucinations
    if not sufficiency.is_sufficient:
        records.append(
            GuardrailAuditRecord(layer="retrieval", rule="sufficiency_gate", action="refusal")
        )
        return {
            "is_sufficient": False,
            "grounding_status": "insufficient",
            "final_reply": INSUFFICIENT_REFUSAL,
            "clean_answer": INSUFFICIENT_REFUSAL,
            "citations": [],
            "sources": [],
            "retrieved_chunks": results,
            "audit_records": records,
        }

    # 4. Format chunks with untrusted data delimiters
    formatted_chunks: list[str] = ["<study_material>"]
    for chunk in results:
        untrusted_str = "true" if chunk.injection_flag else "false"
        formatted_chunks.append(
            f'<document_chunk id="{chunk.chunk_id}" document="{chunk.document_name or ""}" '
            f'page="{chunk.page}" heading="{chunk.heading_path or ""}" untrusted="{untrusted_str}">\n'
            f"{chunk.text}\n"
            f"</document_chunk>"
        )
    formatted_chunks.append("</study_material>")
    context_block = "\n".join(formatted_chunks)

    # 5. Tone selection and prompt building
    tone_ctx = state.get("tone_context") or ToneContext()
    chosen_tone = select_tone(tone_ctx)
    system_prompt = build_tutor_system_prompt(
        tone=chosen_tone,
        english_only=(tone_ctx.user_tone_setting == "english_only"),
    )

    user_prompt = (
        f"{context_block}\n\n"
        f"Student question: {message}\n\n"
        f"Answer the question thoroughly, clearly, and concisely using the study materials above. "
        f"Do not invent facts or extrapolate beyond what is supported. "
        f"Write in clean, natural paragraphs without inline citation brackets."
    )

    # 6. Call smart model
    llm_res = await gateway.chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        role="smart",
        temperature=0.2,
    )

    return {
        "is_sufficient": True,
        "grounding_status": "grounded",
        "tone": chosen_tone,
        "retrieved_chunks": results,
        "raw_response": llm_res.text,
        "audit_records": records,
    }


def guard_out_node(state: TutorState) -> dict[str, Any]:
    """Validate citations and sanitize model output."""
    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))
    db: Session = state["db"]
    user_id = state["user_id"]

    # If already set (refusal or blocked or specialist agent), keep final_reply
    if "final_reply" in state:
        final_reply = state["final_reply"]
        clean_answer = state.get("clean_answer", final_reply)
        citations = state.get("citations", [])
        sources = state.get("sources", [])
        grounding_status = state.get("grounding_status", "grounded")
    else:
        raw_reply = state.get("raw_response", "")
        chunks = state.get("retrieved_chunks", [])
        guard_res = check_output_guardrails(raw_reply, chunks)
        final_reply = guard_res.clean_reply
        clean_answer = guard_res.clean_answer
        citations = guard_res.citations
        sources = guard_res.sources
        grounding_status = "grounded" if guard_res.is_grounded else "unverified"
        records.extend(guard_res.audit_records)

    # Persist all audit events without text
    for r in records:
        event = GuardrailEvent(
            user_id=user_id,
            layer=r.layer,
            rule=r.rule,
            action=r.action,
        )
        db.add(event)
    try:
        db.commit()
    except Exception as e:
        logger.warning("Failed to record guardrail event: %s", e)
        db.rollback()

    return {
        "final_reply": final_reply,
        "clean_answer": clean_answer,
        "citations": citations,
        "sources": sources,
        "grounding_status": grounding_status,
        "audit_records": records,
        "route_agent": state.get("route_agent", "tutor"),
        "route_source": state.get("route_source", "rule"),
        "route_confidence": state.get("route_confidence", 1.0),
        "confirmation_chip": state.get("confirmation_chip"),
        "follow_up_chip": state.get("follow_up_chip"),
    }


def build_tutor_graph():
    """Build and compile the multi-agent orchestrator workflow."""
    workflow = StateGraph(TutorState)

    workflow.add_node("guard_in", guard_in_node)
    workflow.add_node("router", router_node)
    workflow.add_node("tutor", tutor_node)
    workflow.add_node("insights", insights_node)
    workflow.add_node("quiz_gen", quiz_gen_node)
    workflow.add_node("flashcards", flashcards_node)
    workflow.add_node("roadmap", roadmap_node)
    workflow.add_node("confirm_chip", confirm_chip_node)
    workflow.add_node("guard_out", guard_out_node)

    workflow.add_edge(START, "guard_in")
    workflow.add_conditional_edges(
        "guard_in",
        route_after_guard_in,
        {"router": "router", "guard_out": "guard_out"},
    )
    workflow.add_conditional_edges(
        "router",
        route_after_router,
        {
            "tutor": "tutor",
            "insights": "insights",
            "quiz_gen": "quiz_gen",
            "flashcards": "flashcards",
            "roadmap": "roadmap",
            "confirm_chip": "confirm_chip",
        },
    )
    workflow.add_edge("tutor", "guard_out")
    workflow.add_edge("insights", "guard_out")
    workflow.add_edge("quiz_gen", "guard_out")
    workflow.add_edge("flashcards", "guard_out")
    workflow.add_edge("roadmap", "guard_out")
    workflow.add_edge("confirm_chip", "guard_out")
    workflow.add_edge("guard_out", END)

    return workflow.compile()


# Precompiled application
tutor_app = build_tutor_graph()
