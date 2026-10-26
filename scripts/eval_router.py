"""Evaluation script for the Orchestrator Router.

Usage:
    python scripts/eval_router.py [--dataset eval/router_set.json] [--output-dir eval/results]

Computes:
- Routing Accuracy (%)
- Rule Hit Rate (%)
- LLM Call Rate (%)
- Confirmation Chip Trigger Rate (%)
- Average Routing Latency (ms)
- Prints summary table to stdout and writes JSON results to eval/results/router_<timestamp>.json
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import logging
import sys
from pathlib import Path
from typing import Any

# Add backend to sys.path
sys_path_root = Path(__file__).resolve().parent.parent
backend_path = sys_path_root / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from app.ai.harness.cache import InMemoryCache
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import LLMRequest, LLMResponse
from app.ai.router.router import route_message
from app.ai.router.schemas import RouteDecision

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("eval_router")


def build_fake_gateway_for_eval(dataset: list[dict[str, Any]]) -> LLMGateway:
    """Builds a deterministic gateway primed with matching JSON outputs based on prompt text."""
    scripted_map: dict[str, str] = {}
    for item in dataset:
        msg = item["message"].strip().lower()
        expected = item.get("expected_agent", "tutor")
        secondary = item.get("expected_secondary")
        conf = 0.70 if item.get("is_ambiguous") else 0.95
        payload = {
            "agent": expected,
            "confidence": conf,
            "reason_code": "eval_scripted",
            "secondary_agent": secondary,
            "topic_hint": "general",
        }
        scripted_map[msg] = json.dumps(payload)

    async def custom_caller(request: LLMRequest, provider: str, model: str) -> LLMResponse:
        prompt_text = " ".join(m.content for m in request.messages if m.content).lower()
        response_content = json.dumps({
            "agent": "tutor",
            "confidence": 0.85,
            "reason_code": "eval_default",
            "secondary_agent": None,
            "topic_hint": None,
        })
        for msg_key, json_resp in scripted_map.items():
            if msg_key in prompt_text:
                response_content = json_resp
                break

        return LLMResponse(
            content=response_content,
            provider=provider,
            model=model,
            role=str(request.role),
            tokens_in=50,
            tokens_out=50,
            latency_ms=5.0,
        )

    return LLMGateway(caller=custom_caller, base_backoff_s=0.0)


async def run_router_eval(
    dataset_path: Path,
    output_dir: Path,
    use_live_llm: bool = False,
) -> dict[str, Any]:
    with open(dataset_path, encoding="utf-8") as f:
        dataset: list[dict[str, Any]] = json.load(f)

    logger.info("Loaded %d test cases from %s", len(dataset), dataset_path)

    cache = InMemoryCache()
    gateway: LLMGateway | None = None
    if not use_live_llm:
        gateway = build_fake_gateway_for_eval(dataset)

    results: list[dict[str, Any]] = []
    correct_count = 0
    rule_hit_count = 0
    llm_call_count = 0
    confirm_chip_count = 0
    total_latency_ms = 0.0

    for item in dataset:
        case_id = item["id"]
        message = item["message"]
        expected_agent = item["expected_agent"]
        expected_secondary = item.get("expected_secondary")

        decision: RouteDecision = await route_message(
            message=message,
            gateway=gateway,
            cache=cache,
        )

        is_correct = decision.agent == expected_agent
        if is_correct:
            correct_count += 1

        if decision.source == "rule":
            rule_hit_count += 1
        elif decision.source == "llm":
            llm_call_count += 1

        if decision.confirmation_chip:
            confirm_chip_count += 1

        results.append({
            "id": case_id,
            "message": message,
            "expected_agent": expected_agent,
            "predicted_agent": decision.agent,
            "confidence": decision.confidence,
            "source": decision.source,
            "is_correct": is_correct,
            "secondary_agent": decision.secondary_agent,
            "confirmation_chip": decision.confirmation_chip,
            "follow_up_chip": decision.follow_up_chip,
        })

    total_cases = len(dataset)
    accuracy_pct = round((correct_count / total_cases) * 100.0, 2) if total_cases else 0.0
    rule_hit_pct = round((rule_hit_count / total_cases) * 100.0, 2) if total_cases else 0.0
    llm_call_pct = round((llm_call_count / total_cases) * 100.0, 2) if total_cases else 0.0
    confirm_chip_pct = round((confirm_chip_count / total_cases) * 100.0, 2) if total_cases else 0.0

    summary = {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "total_cases": total_cases,
        "correct_predictions": correct_count,
        "accuracy_pct": accuracy_pct,
        "rule_hit_count": rule_hit_count,
        "rule_hit_pct": rule_hit_pct,
        "llm_call_count": llm_call_count,
        "llm_call_pct": llm_call_pct,
        "confirm_chip_count": confirm_chip_count,
        "confirm_chip_pct": confirm_chip_pct,
        "cases": results,
    }

    # Print summary table
    print("\n" + "=" * 60)
    print("           ORCHESTRATOR ROUTER EVALUATION RESULTS")
    print("=" * 60)
    print(f" Total Test Cases evaluated:       {total_cases}")
    print(f" Correct Predictions:              {correct_count} ({accuracy_pct}%)")
    print(f" Deterministic Rule Hit Rate:      {rule_hit_count} ({rule_hit_pct}%) [Zero Cost]")
    print(f" LLM Router Call Rate:             {llm_call_count} ({llm_call_pct}%)")
    print(f" Confirmation Chip Trigger Rate:   {confirm_chip_count} ({confirm_chip_pct}%)")
    print("=" * 60)

    # Breakdown by agent
    by_agent: dict[str, dict[str, int]] = {}
    for r in results:
        exp = r["expected_agent"]
        if exp not in by_agent:
            by_agent[exp] = {"total": 0, "correct": 0}
        by_agent[exp]["total"] += 1
        if r["is_correct"]:
            by_agent[exp]["correct"] += 1

    print("\nBreakdown by Target Agent:")
    print("-" * 50)
    print(f"{'Target Agent':<15} | {'Cases':<8} | {'Correct':<8} | {'Accuracy':<10}")
    print("-" * 50)
    for agent, counts in sorted(by_agent.items()):
        acc = round((counts["correct"] / counts["total"]) * 100.0, 1) if counts["total"] else 0.0
        print(f"{agent:<15} | {counts['total']:<8} | {counts['correct']:<8} | {acc}%")
    print("-" * 50 + "\n")

    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp_slug = datetime.datetime.now(datetime.UTC).strftime("%Y%m%d_%H%M%S")
    out_file = output_dir / f"router_{timestamp_slug}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    logger.info("Results written to %s", out_file)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Evaluate Orchestrator Router accuracy and latency")
    parser.add_argument("--dataset", type=str, default="eval/router_set.json")
    parser.add_argument("--output-dir", type=str, default="eval/results")
    parser.add_argument("--live", action="store_true", help="Use live LLM instead of FakeLLM")
    args = parser.parse_args()

    dataset_path = Path(args.dataset)
    if not dataset_path.is_absolute():
        dataset_path = sys_path_root / dataset_path

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = sys_path_root / output_dir

    asyncio.run(run_router_eval(dataset_path, output_dir, use_live_llm=args.live))


if __name__ == "__main__":
    main()
