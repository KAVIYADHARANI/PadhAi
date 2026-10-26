"""Lightweight Load Test Script for Learning Platform API.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8B and README Section 14:
- Evaluates concurrency, latency (p50, p95, p99), and error rates.
- Strictly adheres to free-tier boundaries (Cloud Run allowance, small Postgres connection pool).
- Uses asyncio and httpx for lightweight local or staging load generation.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from typing import NamedTuple

import httpx


class RequestResult(NamedTuple):
    latency_ms: float
    status_code: int
    success: bool


async def make_request(
    client: httpx.AsyncClient,
    base_url: str,
    path: str,
    headers: dict[str, str] | None = None,
) -> RequestResult:
    """Performs a single timed GET request."""
    url = f"{base_url.rstrip('/')}{path}"
    start = time.perf_counter()
    try:
        resp = await client.get(url, headers=headers, timeout=10.0)
        elapsed = (time.perf_counter() - start) * 1000.0
        return RequestResult(
            latency_ms=elapsed,
            status_code=resp.status_code,
            success=resp.status_code < 400,
        )
    except Exception:
        elapsed = (time.perf_counter() - start) * 1000.0
        return RequestResult(latency_ms=elapsed, status_code=0, success=False)


async def worker_loop(
    worker_id: int,
    client: httpx.AsyncClient,
    base_url: str,
    endpoints: list[str],
    requests_per_worker: int,
    results: list[RequestResult],
) -> None:
    """Worker task sending repeated requests sequentially."""
    for i in range(requests_per_worker):
        path = endpoints[i % len(endpoints)]
        res = await make_request(client, base_url, path)
        results.append(res)
        await asyncio.sleep(0.01)  # Minimal pacing to prevent synthetic connection starvation


def calculate_percentile(data: list[float], percentile: float) -> float:
    """Calculates percentile from sorted float list."""
    if not data:
        return 0.0
    k = (len(data) - 1) * (percentile / 100.0)
    f = int(k)
    c = min(f + 1, len(data) - 1)
    d = k - f
    return data[f] + d * (data[c] - data[f])


async def run_load_test(
    base_url: str,
    concurrency: int = 5,
    requests_per_worker: int = 20,
) -> int:
    """Executes the load test and prints a formatted summary table."""
    endpoints = ["/health"]
    total_expected = concurrency * requests_per_worker

    print(f"==================================================")
    print(f" Free-Tier Load Test (Phase 8 Task 8B)")
    print(f" Target: {base_url}")
    print(f" Concurrency: {concurrency} workers")
    print(f" Total Requests: {total_expected}")
    print(f"==================================================")

    results: list[RequestResult] = []
    start_time = time.perf_counter()

    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency * 2)
    async with httpx.AsyncClient(limits=limits) as client:
        # Pre-flight health check
        pre = await make_request(client, base_url, "/health")
        if not pre.success:
            print(f"ERROR: Target {base_url}/health is unreachable or returned status {pre.status_code}.")
            print("Ensure the backend server is running before executing the load test.")
            return 1

        tasks = [
            worker_loop(w, client, base_url, endpoints, requests_per_worker, results)
            for w in range(concurrency)
        ]
        await asyncio.gather(*tasks)

    total_duration = time.perf_counter() - start_time
    success_count = sum(1 for r in results if r.success)
    error_count = len(results) - success_count
    rps = len(results) / total_duration if total_duration > 0 else 0.0

    latencies = sorted(r.latency_ms for r in results)
    p50 = calculate_percentile(latencies, 50)
    p90 = calculate_percentile(latencies, 90)
    p95 = calculate_percentile(latencies, 95)
    p99 = calculate_percentile(latencies, 99)
    min_lat = latencies[0] if latencies else 0.0
    max_lat = latencies[-1] if latencies else 0.0

    print("\n--- Load Test Results ---")
    print(f"Total Requests:     {len(results)}")
    print(f"Successful:         {success_count} ({success_count / len(results) * 100:.1f}%)")
    print(f"Failed:             {error_count} ({error_count / len(results) * 100:.1f}%)")
    print(f"Duration:           {total_duration:.2f} seconds")
    print(f"Throughput:         {rps:.1f} req/s")
    print("\n--- Latency Distribution (ms) ---")
    print(f"Min:                {min_lat:.1f} ms")
    print(f"p50 (Median):       {p50:.1f} ms")
    print(f"p90:                {p90:.1f} ms")
    print(f"p95:                {p95:.1f} ms")
    print(f"p99:                {p99:.1f} ms")
    print(f"Max:                {max_lat:.1f} ms")
    print("--------------------------------------------------")

    if error_count > 0:
        print(f"FAIL: Load test encountered {error_count} failed requests.")
        return 1

    print("SUCCESS: Load test completed with 0 errors within free-tier budget.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Free-Tier Load Test")
    parser.add_argument("--url", type=str, default="http://localhost:8000", help="Base API URL")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent workers")
    parser.add_argument(
        "--requests", type=int, default=20, help="Requests per worker (default 20 = 100 total)"
    )
    args = parser.parse_args()

    exit_code = asyncio.run(run_load_test(args.url, args.concurrency, args.requests))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
