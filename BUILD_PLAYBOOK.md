# PadhAI Build Playbook

How to build PadhAI (with the Parama-AI study buddy) using Google Antigravity: what you do, what the agent does, and the prompts to paste. Companion to `README.md`, which is the source of truth for the design.

---

## 0. Working method (read this once)

**Antigravity basics that shape this plan** (verify against the current Antigravity docs, since the product is still evolving):

- It has an **Agent Manager** (mission control: one conversation per task, run several in parallel) and an **Editor** view. Switch between them as needed.
- Agents have **Planning** mode (produces a plan and task list as reviewable *Artifacts* before coding) and **Fast** mode (acts directly). Use Planning for anything that touches several files; Fast for small edits.
- You can **comment on Artifacts** (plans, task lists, walkthroughs) to steer the agent without restarting it.
- **Rules** are persistent instructions. Workspace rules live in the repo (commonly `.agent/rules/`), global rules in your home config. Check the docs for the exact current paths.
- Agents can run the terminal and a browser, so ask them to run tests and report results rather than just writing code.

**Ground rules for you**

1. **One phase = one branch = one or more small tasks.** Never hand the agent "build the whole app". Each prompt below is sized for one conversation.
2. **Plan first.** Use Planning mode, read the implementation plan Artifact, comment on anything that drifts from the README, then approve.
3. **Review policy: Request Review** for Phases 0 to 3 (security-critical foundations). Relax later if you trust the pattern.
4. **Tests are the contract.** Every prompt ends with "run the tests and show me the output". If it did not run them, it is not done.
5. **Commit after every green task.** Small commits mean you can roll back an agent that wanders.
6. **Do not let the agent invent library APIs.** For Indra OCR, Rive, MediaPipe, LangGraph and Firebase, the rules below force it to read the official docs first. If it cannot, it must say so.
7. **Free-tier quota is a budget.** Keep tasks bounded, avoid huge screenshot or recording Artifacts unless needed, and use Fast mode for trivial changes.
8. **Parallelise only independent work** (for example the frontend shell and the harness in Phase 0). Never run two agents on the same files.

**The loop for every task**

```text
Paste prompt (Planning mode) -> read plan Artifact -> comment/correct -> approve
-> agent builds + runs tests -> you review diff + test output -> run the review checklist
-> fix via follow-up prompt -> commit -> next task
```

---

## 1. One-time setup (your tasks, before any prompt)

### Accounts and keys

- [ ] GitHub repo `padhai` (private at first). Enable Actions.
- [ ] Firebase project: enable Authentication (email/password + Google). Download the service-account JSON (never commit it).
- [ ] Neon project with pgvector available. Copy the connection string.
- [ ] LLM provider keys: OpenRouter, Groq, Cerebras, Google AI Studio. Note each one's current free-tier limits.
- [ ] An embeddings provider that serves **BAAI/bge-m3** on a free tier. Decide this **before Phase 1**, because the vector dimension is fixed once the index exists.
- [ ] Object storage: Cloudflare R2 or Supabase Storage bucket.
- [ ] Google Cloud project with billing enabled and a **budget alert set immediately** (Cloud Run has no hard cap).
- [ ] Domain and handle clearance in parallel (see Track B below).

### Local tools

- [ ] Antigravity installed, signed in, workspace opened on the `padhai` folder.
- [ ] Docker Desktop, Python 3.11+, Node 20+, `uv` or `pip`, Firebase CLI (for the Auth Emulator), `gh` CLI.
- [ ] Put `README.md` and `BUILD_PLAYBOOK.md` in the repo root and commit them.

### Collect test material now (you will need it in Phases 1 to 3)

- [ ] 3 to 5 real study PDFs: at least one text-layer PDF, one scanned printed PDF, one with tables.
- [ ] 2 to 3 pages of **real handwritten notes** (scanned or photographed).
- [ ] One small "sample course" (about 40 to 80 pages) you will use for all evals.

### Create the rules files (paste these into the repo)

Create `.agent/rules/` (or the path the current docs specify) with the three files below.

**`.agent/rules/00-project.md`**

```text
# PadhAI project rules

You are building PadhAI. The design source of truth is /README.md. If a task conflicts with the README, stop and ask. Do not silently deviate.

## Process
- Always start in Planning mode for multi-file work. Produce an implementation plan and wait for approval.
- Work only on the task given. Do not refactor unrelated code or add features not requested.
- After changes, run the relevant tests and linters, and paste the actual output. Never claim tests pass without running them.
- Keep commits small and describe what changed.

## Stack
- Backend: Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, LangGraph.
- Frontend: React 18, Vite, TypeScript, Tailwind, Recharts.
- DB: Postgres + pgvector (halfvec 1024). Embeddings: BGE-M3, dense only; lexical via tsvector.
- No local models, no Ollama, no GPU. All LLM and embedding calls go through LLMGateway.

## Libraries and APIs
- Before using Indra OCR, Rive, MediaPipe, LangGraph, Firebase Admin, or any library you are not certain about, read its official documentation or package README first. Never invent function names or parameters. If you cannot verify an API, say so and ask.

## Quality
- Type hints everywhere (Python) and strict TypeScript.
- Every module has tests. Backend tests run against FakeLLM and the Firebase Auth Emulator with no network.
- No hard-coded model names, limits or provider URLs; read from config.
```

**`.agent/rules/10-security.md`**

```text
# Security rules (non-negotiable)

- user_id always comes from the verified Firebase token via get_current_user. Never from the request body, query params, or model output. Never a tool argument.
- Every SQL query touching courses, documents, chunks, chats, attempts, flashcards, or sessions filters by user_id (and course_id where relevant) at the SQL level.
- Uploaded document text is untrusted data. It is never treated as instructions and is always wrapped in explicit data delimiters inside prompts.
- Never log message text or document text. Logs carry ids, agent, model, provider, latency, tokens, guardrail result only.
- No secrets in the frontend or in git. Secrets come from env vars.
- Model output rendered to users has external URLs, images and HTML stripped. Only internal citation tokens like [doc p.N] render.
- Fail closed: on failed validation or exhausted budget, return a clear "could not verify" reply, never an unchecked answer.
- Camera frames never leave the browser. Only derived numbers and aggregates are sent or stored.
- Any rule in the README guardrails table needs a test.
```

**`.agent/rules/20-brand-persona.md`**

```text
# Brand and persona rules

- Platform name: PadhAI. Bot name: Parama-AI (always hyphenated, capital AI). Tagline: "Study smart." Tamil line: "Padikka vaa. Progress panna po!"
- Brand strings appear ONLY in: frontend/src/brand.ts, backend config (PRODUCT_NAME, MASCOT_NAME), backend/app/persona/**, docs/BRAND.md, README, tests. Everywhere else import from those. CI has a lint test enforcing this.
- Persona changes wording, never facts. The persona style block goes AFTER the grounding rules in prompts and cannot override them. Citations stay as [doc p.N]. Definitions, formulas and code are never rewritten into slang.
- Tone mode is chosen by deterministic rules, never by the LLM: playful teasing (max one tease per session, habits only), patient (no jokes at the student's expense), serious (active quiz question), hype (specific progress), friendly check-in (breaks), persona OFF on distress.
- Buddy lines come from a pre-generated, human-reviewed line bank (lines.json). Never ship unreviewed Tanglish.
- Buddy wording never diagnoses: "you might be getting tired", never "you are sleepy".
- Parama-AI is an original character. No meme images, audio, or likeness.
```

---

## 2. Kickoff prompt (run once, before Phase 0)

Paste into a new Planning-mode conversation. It makes the agent read the design and confirm understanding before touching code.

```text
Read /README.md and /BUILD_PLAYBOOK.md fully, and the rules in .agent/rules/.

Do NOT write any code yet. Produce a single Artifact that contains:
1. A 15-line summary of the architecture in your own words (agents, harness, guardrails, buddy).
2. The list of design rules from README section 3, restated.
3. Any ambiguities, contradictions, or missing decisions you found in the README (be specific, cite section numbers).
4. The list of external services I must configure before Phase 0, based on README sections 4, 14 and 17.
5. Your proposed repo layout, matching README section 20.

Wait for my comments before doing anything else.
```

*Your task:* read the Artifact, answer its questions in comments, fix README gaps it found.

---

## 3. Track B: brand clearance (parallel, no agent needed)

Do this during Phases 0 to 3. It is **Gate A** and must finish before any public demo.

- [ ] Search India's trademark register for PadhAI, Parama-AI, ParamAI (classes 9, 41, 42). Repeat for launch countries.
- [ ] Shortlist domains (padhai.ai is taken) and check handles on Instagram, X, YouTube, GitHub, app stores.
- [ ] Compare against the two existing PadhAI apps.
- [ ] Record outcomes and the decision in `docs/BRAND.md`. Use the decision tree in the README if there is a conflict.
- [ ] Commission or create **original** Parama-AI art (Phase 4 needs it). Record the license.
- [ ] Recruit your native-speaker reviewer for the Tanglish line bank (Phase 4).

Optional prompt to have the agent draft the document:

```text
Create docs/BRAND.md using the structure from the "Brand Rollout Plan" section of the README: decision, clearance checklist with empty result fields, decision tree, fallback name shortlist (leave blank for me to fill), mascot art license section, native-speaker review log table (reviewer, date, lines reviewed). Do not invent any trademark or availability results.
```

---

## Phase 0: Walking skeleton, harness base, brand base

**Goal:** sign in on a deployed site, create a course, upload a file; CI green on `FakeLLM`.

### Your tasks
- [ ] Complete section 1 setup. Create `.env` from the agent's `.env.example` and fill keys (never commit).
- [ ] Add the deployed domain to Firebase authorized domains once you have a URL.

### Task 0A: Backend skeleton (Planning mode)

```text
Implement README Phase 0, part A: backend skeleton. Follow README sections 4, 5, 17 and 20 and the rules in .agent/rules/.

Build:
1. backend/ project with pyproject.toml, FastAPI app, /health route, structured logging that never logs message text.
2. core/config.py using pydantic-settings reading every variable in README section 17, including PRODUCT_NAME and MASCOT_NAME. Provide .env.example.
3. db/: SQLAlchemy 2 models and the first Alembic migration for ONLY: users, courses, documents, llm_usage, guardrail_events (columns as in README section 5). Enable the pgvector extension in the migration. Do not create other tables yet.
4. core/auth.py: get_current_user dependency that verifies a Firebase ID token with the Firebase Admin SDK and gets-or-creates the users row by firebase_uid. Support the Firebase Auth Emulator via FIREBASE_AUTH_EMULATOR_HOST. Read the Firebase Admin docs before implementing.
5. Routes: GET /api/me, POST/GET /api/courses, POST /api/courses/{id}/documents (upload), GET /api/documents/{id}, DELETE /api/courses/{id}. Every query filters by user_id from the token. Upload validates MIME type, extension and MAX_UPLOAD_MB, stores via a StorageBackend interface (local filesystem implementation now, S3-compatible implementation for R2 next) and creates a documents row with status "queued".
6. docker-compose.yml with postgres (pgvector image), backend, and the Firebase Auth Emulator.
7. Tests (pytest): auth required on all routes except /health, a user cannot read or delete another user's course or document (explicit cross-user tests), upload validation rejects bad MIME and oversized files.

Run: docker compose up for postgres and the emulator, apply migrations, run pytest. Paste the pytest output.
```

**Review checklist:** every route uses `get_current_user`; no `user_id` in any request model; cross-user tests actually assert 404/403; migration creates the extension; no secrets committed.

### Task 0B: Agent harness base (Planning mode, can run in parallel with 0A on separate folders)

```text
Implement README Phase 0, part B: the agent harness in backend/app/ai/harness/. Follow README section 7 exactly.

Build, each with unit tests:
1. LLMGateway: one OpenAI-compatible async client over an ordered failover chain defined by LLM_CHAIN. Per-provider rate-limit tracking read from config (not constants), circuit breaker, timeout (LLM_TIMEOUT_S), jittered retry (LLM_MAX_RETRIES), optional multiple keys per provider. Model slugs per role (MODEL_SMART, MODEL_FAST, MODEL_VISION) parsed from the "provider:slug|provider:slug" env format.
2. StructuredCall: JSON-schema mode when the provider supports it, else prompt-and-parse. Validate with Pydantic; on failure retry with the validation error appended, max 2 retries, then raise StructuredOutputError.
3. Budget: per-request caps on calls, tokens, tool rounds, wall-clock; per-user daily quota using the llm_usage table.
4. Cache: interface plus in-memory implementation (embeddings by text hash, router decisions by normalized message, generated sets by key).
5. Tracer: logs agent, model, provider, latency, tokens, retries, guardrail results. It must be impossible to pass message or document text to it (design the API so it only accepts ids and numbers).
6. GuardrailHooks: pre-call and post-call hook registry that every call passes through. Empty hooks for now.
7. FakeLLM: scripted responses and scripted failures for tests.

Tests must prove: failover on 429 and on timeout, circuit breaker opens and recovers, structured retry then StructuredOutputError, budget exhaustion raises a clear error, no network used. Run pytest and paste the output.
```

**Review checklist:** failover tested with scripted failures; limits come from config; tracer API cannot accept text; FakeLLM used everywhere in tests.

### Task 0C: Frontend shell and brand base (Planning mode, parallel)

```text
Implement README Phase 0, part C: frontend shell. Use React 18, Vite, TypeScript, Tailwind.

Build:
1. frontend/src/brand.ts exporting PRODUCT_NAME="PadhAI", MASCOT_NAME="Parama-AI", TAGLINE="Study smart.", TAGLINE_TA="Padikka vaa. Progress panna po!". All UI text uses these constants.
2. Firebase init in services/firebase.ts from VITE_ env vars, with Auth Emulator support in dev.
3. Pages: Login (email/password + Google), Dashboard (list courses, create course form with name, goal_days, hours_per_day, level), Course (upload a file, show document status polling GET /api/documents/{id}).
4. services/api.ts that attaches the Firebase ID token as a Bearer header.
5. A clean, simple layout with a placeholder area reserved for the future Parama-AI mascot. No mascot yet.

Also add the brand lint test in backend/tests/test_brand_lint.py: scan the repo and fail if "PadhAI" or "Parama" appear outside the allowed files in .agent/rules/20-brand-persona.md.

Run the frontend build and the brand lint test and paste the output.
```

### Task 0D: CI and first deploy (Planning mode)

```text
Implement README Phase 0, part D: CI and first deploy.

1. GitHub Actions workflow: backend (ruff, mypy or pyright, pytest against FakeLLM and the Firebase Auth Emulator) and frontend (typecheck, build). Cache dependencies.
2. backend/Dockerfile (Cloud Run ready: PORT env, non-root user).
3. A docs/DEPLOY.md with exact step-by-step commands to deploy the API to Google Cloud Run (min-instances=0, max-instances=2) and the frontend to Firebase Hosting, including how to set secrets, how to set a billing budget alert, and how to add the domain to Firebase authorized domains. Do not run any deploy commands yourself; I will run them.
4. Make sure no secrets or service-account files can be committed (.gitignore, a pre-commit or CI secret scan).

Run the full CI steps locally and paste the output.
```

### Your tasks after
- [ ] Run the deploy commands from `docs/DEPLOY.md` yourself.
- [ ] Verify end to end on the deployed site. Set the Cloud Run budget alert.

**Done when:** sign-in works on the deployed site, create course, upload file, CI green, brand lint passes.

---

## Phase 1: Ingestion and retrieval

**Goal:** a scanned PDF becomes searchable chunks and retrieval hit rate meets your target.

### Your tasks
- [ ] Decide the embeddings provider and confirm BGE-M3 and its limits (blocker).
- [ ] Label **about 30 questions** on your sample course: question, the correct document and page, and about 10 deliberately unanswerable questions. Save as `eval/retrieval_set.json`.
- [ ] Test Indra OCR yourself on your handwritten pages after Task 1A, and decide whether handwriting is good enough or you need the vision fallback.

### Task 1A: Ingestion worker (Planning mode)

```text
Implement README Phase 1, part A: ingestion worker in backend/app/ingestion/ and backend/app/worker/. Follow README section 6.

BEFORE coding: read the official Indra OCR documentation (PyPI page and project README). Summarise in your plan the real install command, Python API, output format, how to get per-line confidences, auto mode behaviour for text-layer PDFs, and the model directory env var. Do not guess any API.

Build:
1. Alembic migration adding chunks (with halfvec(1024) embedding, tsv tsvector, low_conf, injection_flag), topics, chunk_topics. HNSW index on embedding, GIN on tsv, btree on (user_id, course_id). Fall back to vector(1024) behind a config flag if halfvec is unavailable.
2. loader.py: use the PDF text layer where present, Indra OCR only for scanned pages (OCR_MODE=auto). Capture per-line confidence; flag lines under OCR_MIN_LINE_CONF as low_conf.
3. injection_scan.py: heuristic scan for prompt-injection phrases; sets injection_flag but never drops the chunk.
4. chunker.py: heading-aware, about 400 to 800 tokens, preserving page and heading_path.
5. worker entrypoint that processes one document id: status queued -> processing -> ready/failed, with timeouts, page caps (MAX_PAGES_PER_DOC) and a clear error message on failure. Records pages, pages_ocr, ocr_avg_conf.
6. Dockerfile.worker that bakes the Indra model files into the image and sets INDRA_OCR_MODEL_DIR.
7. Tests with small fixture PDFs: text-layer PDF skips OCR; scanned PDF goes through OCR (mock OCR in CI, real OCR in a separate marked test); injection fixture sets the flag; chunker keeps page numbers.

Run pytest and paste the output. Do not embed yet; that is part B.
```

### Task 1B: Embeddings and topics (Planning mode)

```text
Implement README Phase 1, part B: embeddings and topic grouping.

1. embedder.py: batch calls to the configured embeddings provider (EMBED_PROVIDER, EMBED_MODEL, EMBED_DIM). Cache by normalized text hash. Retries and rate-limit handling via the existing gateway patterns. Assert returned dimension equals EMBED_DIM and fail loudly otherwise. Never mix embedding models in one table.
2. Wire embedding into the worker after chunking; write chunks with embeddings.
3. topics.py: group headings into topics with ONE MODEL_FAST StructuredCall using a Pydantic schema; save topics and chunk_topics. Validate that every chunk maps to at least one topic.
4. Tests using FakeLLM and a fake embedder: dimension mismatch fails, topic grouping validates, a document ends in status ready with chunk and topic counts recorded.

Run pytest and paste the output.
```

### Task 1C: Hybrid retrieval and eval (Planning mode)

```text
Implement README Phase 1, part C: hybrid retrieval in backend/app/retrieval/ and scripts/eval_retrieval.py.

1. search.py: dense search (pgvector cosine) plus full-text search (tsvector) in SQL, ALWAYS filtered by user_id and course_id in the SQL itself. Merge with reciprocal rank fusion. Optional rerank hook (off by default). Return top k with scores, page, heading_path and injection_flag.
2. sufficiency.py: deterministic gate using RETRIEVAL_MIN_SCORE; returns sufficient/insufficient with the best score.
3. Unit tests proving another user's chunks and another course's chunks are never returned (seed two users and two courses).
4. scripts/eval_retrieval.py: loads eval/retrieval_set.json, reports hit rate at k (k=3,5,8), citation page correctness, and the sufficiency gate's precision/recall on the unanswerable questions. Output a table and write results to eval/results/retrieval_<date>.json.

Run pytest and the eval script against my sample course data if available. Paste outputs.
```

### Your tasks after
- [ ] Run the eval on your real course. Tune `RETRIEVAL_MIN_SCORE`, chunk size and k with the agent's help (use a follow-up prompt: "Here are the eval results. Propose parameter changes, change one at a time, re-run, and show a before/after table.").

**Done when:** a scanned PDF becomes searchable chunks and hit rate at k meets your target.

---

## Phase 2: Tutor with guardrails v1 and persona pack v1

**Goal:** unanswerable questions are refused, every citation validates, injection suite passes.

### Your tasks
- [ ] Write 15 to 20 adversarial cases for `tests/redteam/` (or let the agent draft and you extend): injection inside a document, "ignore previous instructions", cross-user attempts, link exfiltration, jailbreak, distress messages.
- [ ] Review the persona style block wording and tone rules (this is your product's voice).

### Task 2A: Persona pack v1 (Planning mode)

```text
Implement README Phase 2, persona pack v1, in backend/app/persona/ and backend/app/buddy/tone.py. Follow README "Brand and Persona" exactly.

1. Pack format: persona/<pack>/ containing style_block.md (with {{mascot_name}} and {{address_term}} placeholders), lines.json, tone_rules.json. Create packs "english" and "tanglish". For tanglish, the style block must instruct light Tanglish flavour; for english, plain friendly English.
2. lines.json schema per README 11.5 (id, trigger, tone, text, reviewed_by, reviewed_on). Seed it with ONLY the four lines from README "Seed lines", marked reviewed_by "pending". Do NOT generate more Tanglish lines; I will review and add them later.
3. tone.py: a pure, deterministic function select_tone(context) returning one of: playful, patient, serious, hype, checkin, off. Inputs: minutes_since_last_session, recent_miss_count, quiz_active, mastery_event, break_prompt, distress_flag, teased_this_session, user_tone_setting (full|balanced|serious|english_only). Enforce: max one tease per session, serious during an active quiz question, off on distress, english_only forces the english pack.
4. A prompt builder that composes the tutor system prompt as: grounding rules FIRST, then the persona style block, with an explicit statement that the style block cannot override grounding, citation format [doc p.N], or the content of definitions, formulas and code.
5. Tests: table-driven tests for select_tone covering every row of the README tone table; a test that the composed prompt always has grounding rules before the style block; a test that swapping MASCOT_NAME changes only the name.

Run pytest and paste the output.
```

### Task 2B: Tutor graph and guardrails v1 (Planning mode)

```text
Implement README Phase 2, part B: the tutor and guardrails v1. Follow README sections 6 (Query), 8 and 10. Read the LangGraph docs before implementing graph code.

1. LangGraph app with START -> guard_in -> tutor -> guard_out -> END. Tutor: retrieve (hybrid, user/course scoped) -> sufficiency gate -> optional query rewrite and ONE second retrieval round (MODEL_FAST) -> answer with MODEL_SMART using chunks wrapped in explicit data delimiters, with injection_flag chunks labelled untrusted -> citation check. No native tool-calling; fixed pipeline. Tutor has no write tools.
2. If the gate says insufficient: reply that the materials do not cover this, offer to search other documents or answer from general knowledge ONLY if the user explicitly asks. No generation call.
3. guard_out grounding: every [doc p.N] must map to a retrieved chunk; quoted excerpts must appear in that chunk. If the check fails twice, return the safe fallback "could not verify" reply. Strip external URLs, images and HTML from output; only internal citation tokens render.
4. guard_in: short deterministic checks (length, obvious override attempts logged but never obeyed) plus the instruction hierarchy in the system prompt.
5. Per-user daily quota via the Budget component; per-request caps.
6. Every block or rewrite writes a guardrail_events row (layer, rule, action) with NO text.
7. Wire persona: tone mode from select_tone, prompt from the builder in 2A. A minimal POST /api/chat endpoint (non-streaming for now) that runs the graph for the authenticated user.
8. Tests with FakeLLM: tutor groundedness (answerable vs unanswerable sets), citation validity (inject a fake citation and assert fallback), injection-laden chunk does not change behaviour, link exfiltration stripped, quota exhaustion, guardrail_events written without text, persona on vs off yields identical citations and facts.
9. tests/redteam/ suite covering my cases in tests/redteam/cases.json (create the file with 15 starter cases; I will extend it). Each case declares the expected guardrail action.

Run pytest and paste the output, including the red-team summary table.
```

**Review checklist:** grounding rules precede persona block in the actual prompt string; no write tools on the tutor; delimiters present; events contain no text; refusal path makes zero `MODEL_SMART` calls.

**Done when:** unanswerable questions are refused, all citations validate, injection suite passes, persona evals pass with a dummy `MASCOT_NAME`.

---

## Phase 3: Quiz and mastery

**Goal:** weak topics change correctly after a scripted attempt history.

### Your tasks
- [ ] Decide mastery parameters: weights for recency and difficulty, the weak-topic threshold. Write them in a short note so the agent implements *your* intent.
- [ ] Hand-write one scripted attempt history (for example 20 attempts across 3 topics) with the weak topics you *expect*. This is the acceptance test.

### Task 3A: Mastery engine (pure Python, Planning mode)

```text
Implement README Phase 3, part A: the learning engine core in backend/app/learning/mastery.py and weak_topics.py. Pure functions, no database, no LLM.

Spec:
- mastery_score(attempts) -> float in [0,1]: recent attempts weigh more (exponential decay with a configurable half-life), harder questions weigh more (difficulty weight). Parameters from config.
- weak_topics(mastery_by_topic, threshold, relevance, recency) -> ranked list.
- Write property-style tests: score is monotonic in correct answers, more recent correct answers raise the score more than old ones, empty history returns a neutral default, results are deterministic.
- Add a test that replays tests/fixtures/attempt_history.json (I will provide it) and asserts the expected weak-topic ranking in tests/fixtures/expected_weak.json.

Create placeholders for the two fixture files with a clear TODO if I have not added them yet. Run pytest and paste the output.
```

### Task 3B: Quiz generation, attempts, API (Planning mode)

```text
Implement README Phase 3, part B: quiz generation and attempts.

1. Alembic migration for questions, attempts, mastery.
2. quiz_gen agent: given a topic (from the UI, not routing), retrieve chunks for that topic (user/course scoped), ONE MODEL_SMART StructuredCall returning questions with Pydantic schema (type, stem, options, answer, explanation, source_chunk_ids). Validate: answer is among options; explanation is non-empty and references at least one source chunk id that was actually retrieved; no duplicate stems. On failure retry with the error (max 2), then fail closed. Cache generated sets by (topic, chunk hash). Save to questions.
3. Questions and explanations are generated in neutral language (no persona).
4. Endpoints: POST /api/quizzes (course_id, topic_id, count), POST /api/attempts (question_id, answer, time_ms) which grades deterministically, stores the attempt and updates mastery using the 3A functions. GET /api/progress/{course_id} returning mastery by topic and weak topics.
5. Tests: validation catches bad answer-not-in-options, bad source ids; attempts update mastery; cross-user attempt submission is rejected; scripted history through the API yields the expected weak topics.

Run pytest and paste the output.
```

### Task 3C: Quiz UI (Planning mode)

```text
Build the Quiz and Progress pages in the frontend per README section 2: choose a topic, take a quiz one question at a time (no persona banter while a question is active), submit, see graded feedback with the explanation and source citation, and a Progress page with Recharts mastery-by-topic and a weak-topics list. Use brand.ts constants for any product text. Typecheck and build, then paste the output.
```

**Done when:** weak topics change correctly after a scripted attempt history, end to end.

---

## Phase 4: Study Buddy v1 (Parama-AI)

**Goal:** the buddy runs a full Pomodoro session, reacts to quiz results, suggests breaks within cooldown rules; replay tests pass. **This is your first public demo, so Gate A (brand clearance) must be done.**

### Your tasks
- [ ] **Create the mascot art.** Original design, in Rive (state machine with inputs `mood`, `energy`, `isTalking`, `lookX`, `lookY` and triggers `tap`, `wave`, `celebrate`, `stretch`, `yawn`) or commission it. The agent cannot design your mascot. Until it exists, have the agent build a **placeholder** (simple SVG/CSS blob) behind the same interface so everything else can proceed.
- [ ] Record the art license in `docs/BRAND.md`.
- [ ] **Native-speaker review of the Tanglish line bank.** Have the agent draft candidates (Task 4B), then you or your reviewer edit and mark `reviewed_by` / `reviewed_on`.
- [ ] Decide default break cadence (25/5 default is fine).

### Task 4A: Break engine and Buddy rule engine in TypeScript (Planning mode)

```text
Implement README Phase 4, part A: the browser-side Buddy rule engine in frontend/src/hooks/ and a pure module frontend/src/buddy/engine.ts. Follow README sections 11.1, 11.3 and 11.4. This module must be pure and deterministic: input events and a clock, output state and suggestions. No React inside the engine.

Build:
1. State machine for Buddy states: idle, ready, studying, deep_focus, curious_check, gentle_nudge, tired_check, break_time, welcome_back, celebrate, sleepy, rest, away.
2. Pomodoro timer (default 25/5, configurable) driving states.
3. Signals available in v1 (no camera yet): tab visibility, keyboard/mouse activity, time since last interaction, quiz events (answer submitted, miss, streak, mastery gain), session time.
4. Nudge ladder exactly per README 11.3 with the ladder never exceeding step 3 and a 15-minute quiet period after an ignored step.
5. Break engine per README 11.4: at most one proactive prompt per 15 minutes; never interrupt an active question (queue until submitted); user-initiated breaks always work; every suggestion includes "I'm fine"; adaptive thresholds from break outcome history (accepted | dismissed | ignored) using plain arithmetic.
6. Tests (Vitest): a replay harness that feeds recorded or synthetic event time-series and asserts state transitions, nudge timing, cooldowns, adaptive threshold changes, and that the ladder never exceeds step 3. Include at least 8 scenarios.

Run the tests and paste the output.
```

### Task 4B: Mascot component, interactivity, line bank (Planning mode)

```text
Implement README Phase 4, part B: the mascot UI.

1. components/buddy/Buddy.tsx with a MascotRenderer interface so the art can be swapped. Provide a PlaceholderMascot (simple SVG) now and a RiveMascot adapter that I will connect to my .riv file later. Before writing the Rive adapter, read the official @rive-app/react-canvas documentation; do not guess the API. The adapter maps engine states to the state machine inputs and triggers listed in README 11.1.
2. Interactivity: eyes follow the cursor while idle (look at the active card during quizzes); tap/poke reaction with a short line; quick-action bubble (Quiz me, Explain this, Flashcards, Take a break, I'm done); reacts to quiz events (celebrate on streaks and mastery, offers a flashcard after two misses, sympathetic animation after a hard result, never scolding); shares breaks (stretch/sip/nap, then wave back).
3. Lines come ONLY from the persona pack lines.json via a typed loader, filtered by trigger and tone from the tone selector (mirror the backend rules in TypeScript or fetch the chosen tone from the API). The animation never waits on the network.
4. Settings panel: persona mode (Full Parama, Balanced, Serious, English only), address term, sensitivity slider (stub for now), camera off by default. Persist to buddy_state via PATCH /api/buddy/settings (add the endpoint and migration for buddy_state, study_sessions, break_events).
5. Session logging: POST /api/sessions, PATCH /api/sessions/{id}, POST /api/sessions/{id}/breaks storing aggregates only.
6. Separately, generate a CANDIDATE line bank file persona/tanglish/lines.candidates.json with 6 variants per trigger x tone, short (under 12 words), non-guilt-tripping, gender-neutral by default, using {{address_term}}. Mark every entry reviewed_by "pending". These are drafts for a native speaker, not shippable.

Typecheck, run the tests, and paste the output.
```

### Your tasks after
- [ ] Review and edit `lines.candidates.json`, move approved lines into `lines.json` with reviewer and date.
- [ ] Play a full Pomodoro session yourself. Note anything that feels naggy and file it as a rule change, not a code rewrite.

**Done when:** full Pomodoro session works, quiz reactions work, cooldown rules hold, replay tests pass. **Then run your first small public demo (after Gate A).**

---

## Phase 5: Flashcards and roadmap

### Your tasks
- [ ] Decide the roadmap logic you want (for example how much review vs new material per day by `level`). Write it as a short spec.

### Task 5A: Spaced repetition and flashcards (Planning mode)

```text
Implement README Phase 5, part A. 
1. learning/srs.py: pure SM-2 implementation mapped to the flashcards columns (due, stability, difficulty) with the ease/interval math documented in comments. Design the interface so FSRS can replace it later without touching callers.
2. Migration for flashcards.
3. flashcards agent: from weak topics, ONE MODEL_SMART StructuredCall, validate (non-empty front/back, front under a length limit), dedupe against existing cards by normalized front text, save. Neutral language, no persona in the card text.
4. Endpoints: POST /api/flashcards/generate, GET /api/flashcards/due, POST /api/flashcards/{id}/review (quality 0 to 5).
5. Tests: SM-2 table-driven tests against known sequences, dedupe, user scoping, due-date correctness.
6. Frontend Flashcards page with review flow, and the Buddy hook: after two misses on a topic, the Buddy offers a flashcard (use the existing event system from Phase 4).

Run backend and frontend tests and paste the output.
```

### Task 5B: Planner and roadmap node (Planning mode)

```text
Implement README Phase 5, part B.
1. learning/planner.py: PURE deterministic planner building day-by-day roadmap_items from goal_days, hours_per_day, level, mastery by topic, and (when available) typical fresh hours from study_sessions. Re-plan function that preserves completed items and redistributes the rest when mastery changes. Implement the spec in docs/ROADMAP_SPEC.md (create it from the spec I paste below, or ask me if it is missing).
2. roadmap node: the planner computes the schedule; ONE MODEL_FAST call writes only the wording for each day. Validate that the wording call cannot change topics, days or counts.
3. Endpoint GET /api/roadmap/{course_id}, and a Roadmap view in the frontend with item status updates.
4. Tests: planner properties (total hours respected, no day over hours_per_day, weak topics scheduled earlier, completed items preserved on re-plan).

Run tests and paste the output.
```

**Done when:** due cards schedule correctly and the roadmap re-plans from new mastery data.

---

## Phase 6: Orchestrator and `/api/chat`

### Your tasks
- [ ] Write about 30 labelled messages for the router eval, including ambiguous and multi-intent ones. Save as `eval/router_set.json`.
- [ ] Decide wording for the confirmation chips and the wellbeing response (this is sensitive copy, so write or heavily edit it yourself).

### Task 6A: Router (Planning mode)

```text
Implement README Phase 6, part A, following README section 9 exactly.
1. Resolution order: explicit UI intent (intent field, no LLM) -> rules (regex/keywords, zero cost) -> ONE MODEL_FAST StructuredCall returning RouteDecision{agent, confidence, reason_code} at temperature 0, input limited to the latest message plus at most 3 short prior messages and NEVER document text -> low-confidence handling (read-only agents run; write agents return a confirmation chip below ROUTER_MIN_CONFIDENCE; honor ROUTER_CONFIRM_BELOW for write agents).
2. Multi-intent: run the primary intent, offer the second as a follow-up chip, never chain automatically.
3. Cache router decisions by normalized message. Log agent, confidence, source (ui|rule|llm), latency, cache hit, never message text.
4. Wire into the LangGraph app: START -> guard_in -> router -> {tutor, quiz_gen, flashcards, roadmap, insights} -> guard_out -> END, with the insights node (SQL aggregates, then one short summary call).
5. scripts/eval_router.py over eval/router_set.json reporting accuracy, rule hit rate, LLM-call rate, latency, confirmation-chip rate.
6. Tests with FakeLLM proving write agents never run below the confirmation threshold.

Run tests and the eval and paste outputs.
```

### Task 6B: Streaming chat and guardrails v2 (Planning mode)

```text
Implement README Phase 6, part B.
1. SSE streaming for POST /api/chat with events for token, citations, agent, route_source, chip, and done. Grounding checks must still run on the final text; if they fail after streaming begins, send a replace event with the safe fallback.
2. Wellbeing guardrail: lightweight deterministic detector for distress/self-harm language that routes to a FIXED supportive response (copy provided in backend/app/ai/guardrails/wellbeing_copy.md, which I will write; use a clearly marked placeholder if missing) encouraging contact with local help or a trusted person, turns persona OFF, and does not continue the tutor flow as if nothing happened.
3. Academic-integrity option: when the user says the work is graded and the setting is on, explain and quiz instead of producing submit-ready answers.
4. Add the distress cases and integrity cases to tests/redteam/cases.json.
5. Chat UI with streaming, citation chips that open the source page excerpt, confirmation chips, and Buddy talking animation while streaming.

Run tests and paste the output.
```

**Done when:** router eval meets your accuracy target; write agents never run below the confirmation threshold; distress cases pass.

---

## Phase 7: Study Buddy v2 (drowsiness and concentration)

### Your tasks
- [ ] Be ready to **record real study sessions** (yourself, a friend or two, with consent) across lighting conditions, glasses, camera angles. Only derived numbers get saved, never video.
- [ ] Decide default sensitivity and which study modes to ship first.
- [ ] Remember: thresholds are heuristics, **not clinically validated**, and the product must not claim to diagnose.

### Task 7A: Signal worker (Planning mode)

```text
Implement README Phase 7, part A: the MediaPipe signal worker in frontend/src/workers/face-signals.worker.ts. Follow README 11.2.

BEFORE coding: read the official MediaPipe Face Landmarker Web documentation. Summarise the real API, blendshape names for eye-blink and jaw-open, and the facial transformation matrix output in your plan. Do not guess.

Build:
1. A Web Worker running Face Landmarker at about 5 to 10 FPS, pausing entirely when the tab is hidden. Frames never leave the worker; only derived numbers are posted out. No frame is ever stored or uploaded.
2. Derived signals: eyes-closed fraction inputs, blink events and durations, jaw-open (yawn) events, head pitch/yaw from the transform matrix, face-present flag, landmark quality score. Keep an eye-aspect-ratio fallback computation.
3. Camera permission flow: opt-in, always-visible indicator, easy off switch. Camera off is the default.
4. A recorder utility that saves ONLY the derived numeric time-series (JSON) locally for my threshold-tuning sessions; make it explicit and off by default.

Typecheck and build. Describe how I can manually test it. Paste outputs.
```

### Task 7B: Scores, calibration, quality gate (Planning mode)

```text
Implement README Phase 7, part B in frontend/src/buddy/ as pure modules with tests.
1. calibration.ts: 20 to 30 second baseline at session start; all thresholds expressed relative to baseline.
2. drowsiness.ts: score 0 to 100 from PERCLOS over a rolling 60 s window, average blink duration, long closures, yawns, head nods, reduced blink-rate variability. Smoothed over 30 to 60 s with hysteresis; never reacts to a single frame.
3. attention.ts: score 0 to 100 from face presence, head yaw/gaze direction, tab visibility, keyboard/mouse activity, time since last interaction.
4. quality gate: if landmark quality is low (light, face out of frame, glare), drop to presence-only, stop judging drowsiness, and have the Buddy say it cannot see well and will stay quiet.
5. Study modes: Screen, Book/notes (looking down is normal), Presence-only, Camera off. Relaxed/Balanced/Strict sensitivity scaling.
6. Integrate with the existing engine so drowsiness and attention drive nudges and the break engine per README 11.3 and 11.4 (movement break for sustained drowsiness, topic switch for low attention, eye rest after long stretches). Wording never diagnoses ("you might be getting tired").
7. Extend the replay harness: feed synthetic and my recorded time-series (eval/buddy_recordings/*.json) and assert transitions, cooldowns, quality-gate silence in bad conditions, and the ladder cap.
8. Feed session aggregates (focus_avg, drowsy_minutes) into study_sessions and expose them to the planner.

Run the tests and paste the output.
```

### Task 7C: Rewards and weekly recap (Planning mode)

```text
Implement the rest of README 11.1 progress hooks: daily-goal ring, streak with grace (a missed day pauses it, never resets with guilt), XP, unlockable hats and desk items (as data-driven unlock definitions), and the weekly recap. The weekly recap is the only routine LLM use: ONE MODEL_FAST call over aggregates only (no text), cached, with a fallback template if it fails. Tests for streak grace logic and recap fallback.
```

### Your tasks after
- [ ] Tune thresholds from real recordings (follow-up prompt: "Here are the replay results across recordings. Propose threshold changes, change one at a time, re-run, show before/after.").
- [ ] Track the **field metric**: "I'm fine" dismissals under 20%.

**Done when:** in real use, dismissals stay under 20% and the quality gate stays quiet in bad lighting.

---

## Phase 8: Dashboard and hardening

### Your tasks
- [ ] Write the privacy page text yourself or review it closely. It must say plainly that content goes to hosted model providers and that camera frames never leave the browser.
- [ ] Choose the production privacy posture (free tiers vs a no-training provider).
- [ ] Complete the final brand audit and sign it off in `docs/BRAND.md`.

### Task 8A: Dashboard, deletion, privacy (Planning mode)

```text
Implement README Phase 8, part A.
1. Dashboard: mastery by topic, due cards, streaks, focus and fatigue trends (Recharts), driven by aggregates.
2. DELETE /api/courses/{id} must remove documents, chunks, embeddings, topics, questions, attempts, flashcards, roadmap items, chat threads and messages, and stored files in object storage, for that course. Write a test that seeds a full course, deletes it, and asserts zero rows or files remain, and that another user's data is untouched.
3. Privacy page (frontend) using the text in docs/PRIVACY_TEXT.md (placeholder with TODO if missing), plus an account-level "delete everything" option.
4. Remove orphaned chunks on document delete.

Run tests and paste the output.
```

### Task 8B: Observability, quotas, nightly evals (Planning mode)

```text
Implement README Phase 8, part B.
1. Error monitoring hook (Sentry or equivalent via env var; no message or document text in events).
2. Per-user quotas and rate limits finalised for chat, upload and Buddy-line endpoints, with clear user-facing errors.
3. A GitHub Actions nightly workflow running the live eval scripts (retrieval, router, tutor groundedness) against the real free-tier APIs under a hard call budget, writing results to eval/results/ and failing the job on regression beyond a tolerance. Never run live evals on pull requests.
4. A short load test (k6 or locust) that stays within free-tier limits.
5. docs/RUNBOOK.md: how to rotate keys, swap a model slug, add a provider to the chain, handle a provider outage, and respond to a cost alert.

Run what can run locally and paste outputs.
```

**Done when:** cost alert configured; full course delete verified; nightly eval green; brand audit signed.

---

## 4. Utility prompts (use any time)

**Agent drifted from the README**

```text
Stop. Compare what you just changed against /README.md sections [N, M]. List every place the change deviates from the design. Do not fix anything yet; show me the list and a proposed correction plan as an Artifact.
```

**Security review of a phase (run at the end of Phases 0, 2, 3, 6, 8)**

```text
Do a security review of everything changed in this branch against .agent/rules/10-security.md and README section 10. For each rule, find the code that enforces it and the test that proves it, or state that one is missing. Specifically hunt for: any query missing user_id/course_id filters, any place user_id comes from request data, any logging of message or document text, any unescaped model output rendered to the UI. Output a table: rule | enforcing code | test | status. Then propose fixes for the gaps but do not apply them until I approve.
```

**Test failure triage**

```text
These tests fail: [paste output]. Do not change the tests unless the test itself is wrong. First explain the root cause in two sentences, then propose the smallest fix. If the test expectation conflicts with the README, tell me instead of picking a side.
```

**Make a plan smaller**

```text
This plan is too large for one pass. Split it into the smallest independently testable tasks, ordered, each with its own acceptance test. Implement only task 1 and stop.
```

**Library uncertainty**

```text
Before continuing, read the official documentation for [library] and list the exact functions and parameters you will use, with links. If anything you wrote earlier does not match the docs, list it and fix it.
```

**Tune an eval-driven parameter**

```text
Here are the latest eval results: [paste]. Propose at most three parameter changes ranked by expected impact. Apply ONE, re-run the eval, and show a before/after table. Stop and wait for me before applying the next.
```

**Pre-merge checklist**

```text
Before I merge this branch: run the full test suite, linters, type checks and the brand lint; list any TODOs or placeholders you left; list any config values that need real values from me; confirm no secrets are in the diff; summarise the changes in 10 lines.
```

---

## 5. Suggested cadence and rough timeline

| Week | Focus | Your hands-on time |
|------|-------|--------------------|
| 1 | Setup, Phase 0, start Track B | Accounts, keys, deploy commands |
| 2 to 3 | Phase 1 | Collect PDFs, label retrieval set, test handwriting |
| 3 to 4 | Phase 2 | Red-team cases, review persona wording |
| 5 | Phase 3 | Mastery spec and attempt-history fixture |
| 6 to 7 | Phase 4 | Mascot art, Tanglish line review, Gate A, first demo |
| 8 | Phase 5 | Roadmap spec |
| 9 to 10 | Phase 6 | Router set, wellbeing copy |
| 10 to 13 | Phase 7 | Recording sessions, threshold tuning |
| 14 to 15 | Phase 8 | Privacy text, brand audit, launch checklist |

These are rough solo estimates and will shift with your available hours and free-tier quota.

## 6. Things only you can do (do not delegate to the agent)

- Trademark, domain and handle clearance, and the final naming decision.
- Mascot art and its license.
- Native-speaker review of every shipped Tanglish line.
- Wellbeing response copy and privacy page wording.
- Labelling the retrieval and router eval sets, and the scripted attempt history.
- Recording and consenting study-session data for threshold tuning.
- Running deploys, setting billing alerts, rotating keys.
- Choosing the production privacy posture for provider data handling.

## 7. Definition of "ready for first public demo"

- [ ] Phases 0 to 4 done and deployed.
- [ ] Gate A (brand clearance) complete.
- [ ] Tanglish line bank reviewed and logged.
- [ ] Red-team suite and persona evals green.
- [ ] Cloud Run budget alert set, quotas enforced.
- [ ] Privacy statement visible, camera off by default.
