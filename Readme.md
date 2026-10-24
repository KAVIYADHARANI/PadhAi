# PadhAI: AI Personalized Learning Companion

> **Study smart.** · *Padikka vaa. Progress panna po!*

An adaptive study platform that turns a student's own materials (PDFs, scans, notes) into a personal tutor, quiz engine, flashcard deck and study plan, with an animated, interactive **Parama-AI** (the Study Buddy mascot and the tutor's voice) that studies alongside you, notices when you are tired or drifting, and suggests breaks.

> **Status: Phase 0 (rebuild from scratch).** The architecture below is the target design. Nothing here is implemented until its box is ticked in [Build Phases](#16-build-phases).

**Brand (decided):** platform **PadhAI** · bot **Parama-AI** · tagline **"Study smart."** Trademark, domain and handle clearance is still pending: see [Brand Rollout Plan](#brand-rollout-plan).

**Highlights of this design**

- **No local models.** All LLM and embedding calls go to hosted open-model APIs through one gateway with failover. No Ollama, no GPU.
- **OCR is Indra OCR** (CPU-only, pip-installable). Text-layer PDF pages skip OCR entirely.
- **An agent harness and an eval harness** are first-class parts of the repo, not afterthoughts.
- **Guardrails** are specified per layer (input, retrieval, tools, output, cost, wellbeing, persona).
- **A small orchestrator**: UI intents bypass it, cheap rules run first, one small LLM call handles the rest.
- **Parama-AI**, an interactive mascot with a Tamil college-senior persona, drowsiness and concentration detection, and an adaptive break engine.
- **Deployment targets free tiers.**

---

## Table of Contents

- [Brand and Persona](#brand-and-persona)
- [Brand Rollout Plan](#brand-rollout-plan)
- [1. Core Loop](#1-core-loop)
- [2. Features](#2-features)
- [3. Architecture](#3-architecture)
- [4. Tech Stack](#4-tech-stack)
- [5. Database Schema](#5-database-schema)
- [6. Ingestion and RAG Pipeline](#6-ingestion-and-rag-pipeline)
- [7. Agent Harness](#7-agent-harness)
- [8. Agents](#8-agents)
- [9. Orchestrator Design](#9-orchestrator-design)
- [10. Guardrails](#10-guardrails)
- [11. Study Buddy (Parama-AI)](#11-study-buddy-parama-ai)
- [12. Learning Engine](#12-learning-engine)
- [13. Security and Privacy](#13-security-and-privacy)
- [14. Deployment (free-first)](#14-deployment-free-first)
- [15. Evaluation Harness](#15-evaluation-harness)
- [16. Build Phases](#16-build-phases)
- [17. Configuration](#17-configuration)
- [18. Quickstart (target)](#18-quickstart-target)
- [19. API Outline (planned)](#19-api-outline-planned)
- [20. Repository Structure](#20-repository-structure)
- [21. Open Questions](#21-open-questions)
- [22. License](#22-license)

---

## Brand and Persona

**Platform name:** **PadhAI** = *padhai* (study, Hindi) + *padi* (study/read, Tamil) + AI. Easy to say, easy to brand, and directly about learning.

**Bot name:** **Parama-AI**. The spelling is always `Parama-AI` (hyphenated, capital AI) in docs, UI and code constants.

**Tagline:** "Study smart." **Secondary line (Tamil):** "Padikka vaa. Progress panna po!"

**Naming status: decided, clearance pending.** These are creative choices, not verified marks. Known issues to resolve before a public launch:

- **"PadhAI" is already in use.** There is an AI exam-prep app called PadhAI (Android app, web app and padhai.ai, aimed at UPSC aspirants), and a separate "PadhAI" AI reading-assessment app from Pratham. Same word, same broad space (AI education in India). This is a trademark and discoverability risk.
- **The "Parama, padi da" meme concept** is already used by a public Chrome extension for study focus. Parama-AI as its own character name avoids copying it, but do not use any meme image, audio or likeness.
- Check the trademark register (India's IP office, plus any country you launch in), domains and social handles before locking anything in. See the [Brand Rollout Plan](#brand-rollout-plan).
- Keep the brand in one place (`persona/` pack, `frontend/src/brand.ts`, `docs/BRAND.md`, this README) so a rename later is a find-and-replace, not a refactor.

### Parama-AI

One character, two surfaces: the **tutor's voice in chat** and the **Study Buddy mascot** on screen. Personality: *the college senior*. Funny when you procrastinate, patient when you struggle, serious when it is quiz time.

Seed lines (these become the first entries of the line bank):

| Moment | Example line |
|--------|--------------|
| Struggling with a topic | "Dei thambi, indha topic innum puriyalaya? Vera example solren." |
| Low quiz score | "Quiz-la 3/10 dhaana? Seri, namma basics-ku thirumbi polam." |
| Mastery gained | "Semma! Indha topic unakku master aayiduchu." |
| Long unbroken study | "20 minutes continuous-ah padichitta. Break venuma, boss?" |

### Tone modes (what makes the persona safe to ship)

The persona changes **wording**, never **facts**. The tone mode is chosen by deterministic rules from context, not by the LLM.

| Context | Tone | Rules |
|---------|------|-------|
| Returning after a gap, procrastinating | Playful teasing | At most one tease per session. Tease the *habit*, never the person's ability, intelligence, marks or background. Always followed by a way in ("5-minute warm-up?"). |
| Struggling (repeated misses, "I don't understand") | Patient | No jokes at the student's expense. Re-explain with a different example. A light joke is allowed only after they get it. |
| Quiz in progress | Serious | Short, neutral, no banter until the answer is submitted. Feedback after submit may be light. |
| Mastery or streak | Hype | Celebrate specific progress, not generic praise. |
| Break suggestions | Friendly check-in | Same rules as the Buddy nudge ladder. No guilt. |
| Distress detected (see wellbeing guardrail) | **Persona off** | Plain, warm, supportive language. No humour, no slang. |

User controls: **Full Parama** (Tanglish plus banter), **Balanced**, **Serious**, and **English only**. The student can switch at any time and the choice is stored in `buddy_state`.

### Language and address

- **Persona packs** are data, not code: `persona/<pack>/` holds a prompt style block, `lines.json` and tone rules. Launch with **Tanglish** and **English**; add **Hinglish** later as another pack.
- **Gender-neutral by default.** "Boss" and "machi" work for any student; "thambi" assumes a younger male. The address term is a setting (`PERSONA_ADDRESS_TERM`).
- **Quality of Tanglish from open models is uneven.** So the Buddy's lines are pre-generated and reviewed by a native speaker, and only the tutor's free-form replies rely on the model's style. Run the persona evals on every model change.
- **The style block goes after the grounding rules** in the system prompt and cannot override them. Citations stay in the `[doc p.N]` format, and definitions, formulas and code are never "translated" into slang. The `guard_out` grounding checks run on the content regardless of tone.
- Quiz questions and explanations are generated in neutral language. Parama-AI's persona wraps the feedback around them, not the questions.

---

## Brand Rollout Plan

**Decision (working names, locked):** Platform **PadhAI** · Bot **Parama-AI** · Tagline **"Study smart."** · Tamil line **"Padikka vaa. Progress panna po!"**

**Rule:** the brand lives in one place: persona packs, `frontend/src/brand.ts`, config, README and `docs/BRAND.md`. Nothing else hard-codes names.

### Clearance checklist (Gate A: complete before any public demo)

- [ ] Search India's trademark register (relevant classes: 9, 41, 42) for PadhAI, Parama-AI and ParamAI
- [ ] Repeat for any country you launch in
- [ ] Check domains. padhai.ai is taken, so shortlist alternatives (for example padhai.app, getpadhai, parama.ai)
- [ ] Check handles: Instagram, X, YouTube, GitHub, Play Store, App Store, Chrome Web Store
- [ ] Compare against the two known PadhAI apps (UPSC exam-prep, Pratham reading assessment)
- [ ] Check "Parama" against the focus-extension meme use
- [ ] Record results and the final decision in `docs/BRAND.md`

### Decision tree

- Clear on all fronts: keep PadhAI as the platform name.
- Conflict on the platform name only: make **Parama-AI the product name** and demote "PadhAI" to a descriptor or retire it.
- Conflict on both: pick from the fallback shortlist kept in `docs/BRAND.md`.

### Rename-proofing

- `frontend/src/brand.ts` exports `PRODUCT_NAME`, `MASCOT_NAME`, `TAGLINE` and `TAGLINE_TA`.
- The backend reads `PRODUCT_NAME` and `MASCOT_NAME` from config for emails, prompts and API titles.
- Persona style blocks use `{{mascot_name}}` placeholders.
- A CI check fails if "PadhAI" or "Parama" appear outside the allowed files (`brand.ts`, persona packs, `docs/BRAND.md`, README, tests).

### Content and legal hygiene

- Parama-AI is an original character: no meme image, audio, voice or likeness.
- Mascot art is original (commissioned or self-made), with its license recorded in `docs/BRAND.md`.
- Tanglish lines are reviewed by a native speaker; the reviewer and date are logged in `lines.json`.
- The privacy page, terms, emails and store listings use the final cleared name.
- "Study smart" is generic and weak as a mark. Treat the Tamil line and the Parama-AI character as the distinctive parts of the identity.

### Voice rules (summary of the persona spec)

- Tease habits, never ability, marks or background; at most one tease per session.
- Persona off on distress and during an active quiz question.
- Address term defaults to neutral "boss"; "thambi" and "machi" are options.

---

## 1. Core Loop

```text
Upload -> Indra OCR / text extract -> Chunk + Embed (API) -> RAG Tutor -> Quiz
      -> Weak-topic detection -> Flashcards (spaced repetition) -> Adaptive roadmap
      -> Progress dashboard
                              ^
              Study Buddy (focus + drowsiness + session data feeds the roadmap
                           and the break engine)
```

## 2. Features

| Area | What it does |
|------|--------------|
| Ingestion | Upload PDFs, scans and images. Pages with a text layer are used directly; scanned pages go through Indra OCR. Low-confidence OCR lines are flagged. |
| RAG Tutor | Answers only from the student's materials, with citations (document, page, excerpt). Says so when the material does not cover a question. |
| Quizzes | Topic-tagged questions grounded in retrieved chunks, graded with explanations. |
| Weak-topic detection | Deterministic mastery scoring per topic from attempts. No LLM involved. |
| Flashcards | Generated from weak topics, scheduled with spaced repetition (SM-2 first, FSRS later). |
| Adaptive roadmap | Day-by-day plan from the course goal (days, hours/day, level), re-planned from mastery and focus data. |
| Dashboard | Mastery by topic, due cards, streaks, focus and fatigue trends. |
| Study Buddy (Parama-AI) | Interactive mascot: reacts to taps and quiz results, works while you work, detects drowsiness and lost focus locally, and suggests breaks without nagging. |
| Guardrails | Grounding checks, prompt-injection defense, quotas, wellbeing handling, all tested by an adversarial suite. |

## 3. Architecture

```text
Browser (React + Firebase Auth SDK)
  ├─ Rive Buddy (state machine)
  ├─ Signal worker: MediaPipe Face Landmarker, runs locally, emits numbers only
  └─ Rule engine: focus/drowsiness scores -> Buddy state -> break suggestions
   │  REST / SSE   (Authorization: Bearer <Firebase ID token>)
FastAPI ── get_current_user (verify token, load user row) ── rate limits + quotas
   │
Agent harness  (llm gateway · structured output · budgets · tracing · guardrail hooks)
   │
LangGraph app
   START -> guard_in -> router ─┬─ tutor       retrieve -> sufficiency gate -> LLM -> cite check
                                ├─ quiz_gen    structured output -> validate -> save
                                ├─ flashcards  structured output -> validate -> save
                                ├─ roadmap     reads mastery + sessions -> structured plan
                                └─ insights    SQL stats -> short summary
          -> guard_out -> END
   │
Learning engine (plain Python): mastery, SM-2/FSRS, weak topics, planner, break policy
   │
Neon Postgres + pgvector     Ingest worker (Indra OCR -> chunk -> embed API)     Object storage
   │
External APIs (via gateway): OpenRouter · Groq · Cerebras · Google AI Studio · embeddings provider
```

### Design rules

1. **Code decides, the LLM writes.** Mastery, scheduling, weak-topic detection and break policy are deterministic. The LLM generates content (answers, questions, card text, plan wording).
2. **Only the tutor is agentic**, and boundedly so: at most two retrieval rounds. Quiz, flashcards, roadmap and insights are single structured calls plus validation plus a DB write.
3. **UI intent beats routing.** A button press ("Quiz me") already says which agent to run. The router only handles free-text chat.
4. **Documents are untrusted data.** Text from uploaded files is never treated as instructions.
5. **Every query is user-scoped.** `user_id` comes from the verified token, never from model output or the request body, and is never a tool argument.
6. **Fail closed, fail cheap.** On a failed validation or exhausted budget, return a clear "could not verify" reply rather than an unchecked answer.
7. **The Buddy lives outside the graph.** A browser rule engine decides animation and nudges instantly. The LLM is almost never in that loop.
8. **Free-tier aware.** Every LLM call has a quota, a cache where possible, and a fallback provider.
9. **The persona changes wording, never facts.** Tone is chosen by rules, and grounding checks run regardless of tone.

## 4. Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18, Vite, Tailwind CSS, Recharts, Rive (Buddy), MediaPipe Face Landmarker (WASM, in-browser) |
| Auth | Firebase Authentication (email/password, Google), verified server-side with the Firebase Admin SDK |
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2 |
| Database | PostgreSQL with pgvector on Neon (free tier to start) |
| Agents | LangGraph. The Postgres checkpointer is optional (see [Orchestrator](#9-orchestrator-design)) |
| LLM | Hosted open models behind `LLMGateway`: OpenRouter primary; Groq, Cerebras, Google AI Studio as failovers |
| Embeddings | BGE-M3 (1024-dim, multilingual) from a hosted provider; dense vectors only; Postgres `tsvector` provides the lexical side |
| Reranker | Optional hosted cross-encoder, or skip and use RRF alone |
| OCR | Indra OCR (CPU, ONNX Runtime). Text-layer pages skip OCR entirely |
| Infra | Docker Compose locally. Production: see [Deployment](#14-deployment-free-first) |

### Model roles

Model names change often on free tiers, so roles are configured by env var and nothing is hard-coded.

| Role | Used for | Requirements |
|------|----------|--------------|
| `MODEL_SMART` | Tutor answers, quiz generation, roadmap wording | Strong instruction following, reliable JSON output |
| `MODEL_FAST` | Router, topic grouping, query rewrite, sufficiency check | Low latency, cheap, structured output |
| `MODEL_VISION` (optional) | Fallback for handwritten pages Indra reads poorly | Open vision-language model |
| Embeddings | Chunks and queries | One model per index. Never mix embedding models in the same table |

Buddy dialogue does **not** need a model role. See [Study Buddy](#11-study-buddy-parama-ai).

### Authentication flow

1. The client signs in with the Firebase JS SDK.
2. The client sends the Firebase **ID token** in the `Authorization: Bearer` header.
3. `get_current_user` verifies it with the Admin SDK, then gets or creates the `users` row keyed by `firebase_uid`.
4. Authorization (who owns which course or document) lives in our own database.

Notes: the backend never sees passwords; local dev and tests use the Firebase Auth Emulator; production needs the deployed domain in Firebase's authorized domains and the service-account credentials as a secret; auth stays behind `get_current_user` so it can be swapped later.

## 5. Database Schema

```text
users(id, firebase_uid UNIQUE, email, display_name, created_at)
courses(id, user_id, name, goal_days, hours_per_day, level)
documents(id, course_id, user_id, file_uri, pages, pages_ocr, ocr_avg_conf,
          status, error)
chunks(id, document_id, course_id, user_id, page, heading_path, text, low_conf bool,
       injection_flag bool, embedding halfvec(1024), tsv tsvector)
topics(id, course_id, name, parent_id) · chunk_topics(chunk_id, topic_id)
questions(id, topic_id, type, stem, options, answer, explanation, source_chunk_ids)
attempts(id, user_id, question_id, correct, time_ms, created_at)
mastery(user_id, topic_id, score, updated_at)
flashcards(id, user_id, topic_id, front, back, due, stability, difficulty)
roadmap_items(id, course_id, day, topic_id, kind, status)
study_sessions(id, user_id, started_at, ended_at, pomodoros, focus_avg,
               drowsy_minutes, mode)                      -- aggregates only
break_events(id, session_id, trigger, kind, outcome, created_at)
                                   -- outcome: accepted | dismissed | ignored
chat_threads(id, user_id, course_id) · chat_messages(id, thread_id, role, content, citations)
buddy_state(user_id, together_minutes, streak, xp, unlocks, sensitivity,
            persona_pack, tone_mode, address_term)
llm_usage(user_id, day, provider, model, calls, tokens_in, tokens_out)
guardrail_events(id, user_id, layer, rule, action, created_at)   -- no message text
```

Notes:
- `halfvec` halves vector storage, which matters on a 0.5 GB free database (requires pgvector 0.7+; fall back to `vector(1024)` if unavailable).
- Indexes: HNSW on `chunks.embedding`, GIN on `chunks.tsv`, B-tree on `(user_id, course_id)` everywhere.
- LangGraph checkpoint tables are only added if you adopt interrupts or resumable runs.

## 6. Ingestion and RAG Pipeline

### Ingestion (async worker)

1. Store the file in object storage; create a `documents` row with status `queued`. Reject files over `MAX_UPLOAD_MB` or `MAX_PAGES_PER_DOC`.
2. Run Indra OCR in `auto` mode: it uses the PDF text layer where present and OCRs only the rest. Output is Markdown with tables, reading order and per-line confidences.
3. Flag pages or lines under `OCR_MIN_LINE_CONF` (`low_conf`). Show these to the user so they can correct them. Optionally send low-confidence handwritten pages to `MODEL_VISION`.
4. Scan chunks for prompt-injection patterns; set `injection_flag` (still stored, never trusted).
5. Chunk by headings, about 400 to 800 tokens, keeping `page` and `heading_path`.
6. Embed through the embeddings API in batches; write to `chunks`.
7. Group headings into `topics` with one `MODEL_FAST` call.
8. Mark the document `ready` and record page, OCR and chunk counts.

**Indra OCR notes**

- Install with `pip install indra-ocr` (Python 3.10+, no PyTorch, no GPU).
- The first run downloads about 76 MB of model files from Hugging Face. **Bake them into the Docker image** and set `INDRA_OCR_MODEL_DIR` so cold starts and locked-down networks never depend on a download.
- Use `--format json` (or the Python API) to get lines, boxes, layout blocks and confidences. Enable math mode only for STEM courses, since it is slower.
- Handwriting is its weak spot. Treat handwritten scans as best-effort, always surface confidence, and test on real student notes before promising anything.
- License: code is Apache-2.0; **model weights use a modified OpenRAIL-M** that is free for research, personal use and startups under a funding/revenue threshold, and forbids using it to build a competing OCR service. Re-read the weights license before any commercial launch.
- With the Python API, wrap multi-process conversion in `if __name__ == "__main__":` because worker processes re-import the file.

### Query

1. Embed the question through the embeddings API (cache by normalized text).
2. Dense search (pgvector) plus full-text search (`tsvector`), always filtered by `user_id` and `course_id` at the SQL level.
3. Merge with reciprocal rank fusion, optionally rerank, keep top k.
4. **Sufficiency gate (deterministic):** if the best fused or rerank score is below a threshold, skip generation and answer "your materials do not cover this", offering to search other documents or explain from general knowledge only if the user explicitly asks.
5. Prompt `MODEL_SMART` with the chunks wrapped in data delimiters. Answer only from context and cite `[doc p.N]`.
6. Run the citation check (see [Guardrails](#10-guardrails)). If it fails twice, return the safe fallback.

## 7. Agent Harness

The harness is the code around the model calls. It lives in `backend/app/ai/harness/` and is what makes free, unreliable, rate-limited open-model APIs behave like a dependable component.

| Component | Responsibility |
|-----------|----------------|
| `LLMGateway` | One OpenAI-compatible client over several providers. Ordered failover chain, per-provider rate-limit tracking, circuit breaker, timeout, jittered retry, optional multiple keys per provider. |
| `StructuredCall` | JSON-schema mode when the provider supports it, otherwise prompt-and-parse. Validate with Pydantic; on failure retry with the validation error appended (max 2), then raise `StructuredOutputError`. |
| `Budget` | Per-request caps on calls, tokens, tool rounds and wall-clock time. Per-user daily quota from `llm_usage`. |
| `Cache` | Embeddings by text hash; router decisions by normalized message; generated quiz/flashcard sets by (topic, chunk hash). |
| `Tracer` | Logs agent, model, provider, latency, tokens, retries, guardrail results. Never logs message or document text. |
| `GuardrailHooks` | Pre-call and post-call hooks that every node passes through (see section 10). |
| `FakeLLM` | Scripted responses for tests and CI. The whole backend test suite runs against it. |

Rules of thumb:
- Do not depend on native tool-calling from free models. The tutor uses a fixed retrieve-then-answer pipeline with one optional second retrieval round, which is more reliable on small models.
- Pin a model slug per role in config and record it in traces so regressions are attributable.
- Provider free-tier limits and model lineups change frequently, so `LLMGateway` reads limits from config, not constants.

## 8. Agents

| Node | Behaviour |
|------|-----------|
| `tutor` | Hybrid retrieve, sufficiency gate, optional query rewrite and second retrieval, answer with citations, citation check. Read-only. |
| `quiz_gen` | Retrieve chunks for a topic, one structured call, validate (answer must be among options, explanation must reference a source chunk), save. |
| `flashcards` | From weak topics, one structured call, dedupe against existing cards, save. |
| `roadmap` | Planner computes the schedule deterministically; one call only writes the wording. |
| `insights` | SQL aggregates, then one short summary call. |

State: `messages`, `user_id`, `course_id`, `intent`, `route`, `route_confidence`, `route_source`, `budget`.

## 9. Orchestrator Design

The orchestrator is a router, not a manager. It picks exactly one specialist per message.

**Resolution order (stop at the first match):**

1. **Explicit UI intent.** Buttons and slash commands (`/quiz`, `/cards`, `/plan`, `/progress`) carry an `intent` field. No routing call at all.
2. **Rules.** A small set of regexes and keyword patterns for unambiguous phrasing ("quiz me on...", "make flashcards", "how am I doing"). Zero cost, sub-millisecond.
3. **LLM router.** One `MODEL_FAST` structured call, temperature 0, returning `RouteDecision{agent, confidence, reason_code}`. Input is the latest message plus at most the last three short messages, never document text.
4. **Low confidence (below `ROUTER_MIN_CONFIDENCE`, default 0.6):**
   - If the best guess is a read-only agent (`tutor`, `insights`), run it.
   - If it would write to the database (`quiz`, `flashcards`, `roadmap`), reply with a one-line confirmation chip ("Make a 10-question quiz on photosynthesis?") instead of acting.
5. **Multi-intent messages.** Run the primary intent and offer the second as a follow-up chip. Do not chain agents automatically.

**Why this shape:** rules plus one cheap hosted call give most of the accuracy, cost almost nothing, and make the "confirm before writing" safety net simple. Add a dedicated classifier model later only if the router eval shows it is worth it.

**State and memory:** store messages in `chat_messages` and rebuild the short context window per request. Add the LangGraph Postgres checkpointer only when you need resumable or interruptible runs; it adds tables and connections you may not want on a small free database.

**Logging:** each decision logs agent, confidence, source (`ui | rule | llm`), latency and cache hit. Never message text.

## 10. Guardrails

Guardrails are implemented as hooks in the harness and nodes in the graph, and every rule has a test in the red-team suite ([Evaluation](#15-evaluation-harness)).

| Layer | Risk | Control |
|-------|------|---------|
| Upload | Oversized or malformed files, zip bombs | Allow-listed MIME types and extensions, size and page caps, per-user upload rate limit, parse in the worker with a timeout |
| Ingestion | Prompt injection hidden in documents | Heuristic injection scan sets `injection_flag`; flagged chunks are still searchable but are wrapped and labelled as untrusted |
| Input (`guard_in`) | Jailbreaks, instruction override in chat | Short deterministic checks plus the system prompt's instruction hierarchy; user text never replaces system rules |
| Context | Document text treated as instructions | Chunks wrapped in explicit data delimiters; system prompt states that material is data only |
| Retrieval | Cross-user data leakage | `user_id` and `course_id` enforced in SQL; unit tests prove another user's chunks are never returned |
| Tools | Model acting on the wrong user, or writing unexpectedly | Tools take no `user_id` argument; tutor has no write tools; writes only in dedicated nodes after validation |
| Grounding (`guard_out`) | Hallucinated answers or citations | Every `[doc p.N]` must map to a retrieved chunk; quoted excerpts must appear in that chunk; sufficiency gate blocks generation when retrieval is weak |
| Output | Data exfiltration via rendered links or images | Strip external URLs, images and HTML from model output; only internal citation tokens render |
| Structured output | Malformed or unsafe JSON | Pydantic validation, bounded retries, domain checks (answer within options, no empty explanations) |
| Cost and abuse | Free-tier exhaustion, runaway loops | Per-request `Budget`, per-user daily quota, rate limits on chat and upload, hard cap on tool rounds |
| Wellbeing | Distress or self-harm language in chat | Lightweight detector routes to a fixed supportive response with a prompt to contact local help or a trusted person; the tutor does not continue as if nothing happened |
| Academic integrity | "Do my exam for me" misuse | Tutor explains and quizzes rather than producing submit-ready answers to graded work when the user says it is graded; configurable |
| Buddy | Guilt-tripping, medical claims | Fixed line bank reviewed once; wording says "you might be getting tired", never "you are sleepy" or any diagnosis |
| Persona (Parama-AI) | Teasing that stings, humour at a bad moment, slang overriding facts | Tone mode picked by deterministic rules; teasing capped and limited to habits; persona off during an active quiz question and on distress; style block cannot override grounding; persona eval suite |
| Brand | Name drift, unreviewed lines, un-cleared marks | CI grep rule for brand strings; native-speaker review logged in `lines.json`; Gate A clearance before public demo |
| Privacy | Third-party exposure of study material | See [Security and Privacy](#13-security-and-privacy). Tell the user plainly that content goes to hosted model providers |

When any guardrail blocks or rewrites a response, it writes a row to `guardrail_events` (layer, rule, action) with no text, so you can measure false positives.

## 11. Study Buddy (Parama-AI)

An original, animated mascot that studies alongside you. In PadhAI this mascot is **Parama-AI**, the same character that speaks in the tutor chat. It is interactive and warm in the spirit of a language-app mascot, but it must be **your own character**: do not copy an existing app's mascot design, name or assets. It is a body-double, not a supervisor. It never guilt-trips, never loses health or happiness when you leave, and stops nudging after the final step of the ladder.

### 11.1 Interactivity

Built as a Rive state machine with inputs (`mood`, `energy`, `isTalking`, `lookX`, `lookY`) and triggers (`tap`, `wave`, `celebrate`, `stretch`, `yawn`).

- **Eyes follow the cursor** while idle; looks at the active card during quizzes.
- **Tap or poke** for a reaction and a short line.
- **Quick-action bubble** on click: Quiz me, Explain this, Flashcards, Take a break, I'm done.
- **Reacts to learning events:** celebrates correct streaks and mastery gains, offers a flashcard when you miss a question twice, shows a small sympathetic animation after a hard result (never a sad or scolding one).
- **Shares breaks:** during a break it stretches, sips water or naps beside you, then waves you back.
- **Progress hooks:** daily-goal ring, streak with grace (a missed day pauses it), XP, unlockable hats and desk items, weekly recap.

**States:** `idle`, `ready`, `studying`, `deep_focus`, `curious_check`, `gentle_nudge`, `tired_check`, `break_time`, `welcome_back`, `celebrate`, `sleepy`, `rest`, `away`.

### 11.2 Detection (all local, in the browser)

Run MediaPipe Face Landmarker in a Web Worker at about 5 to 10 FPS. Only derived numbers leave the worker; frames are never stored or uploaded. Pause entirely when the tab is hidden.

**Two separate scores, because they need different responses:**

| Score | Signals | Meaning |
|-------|---------|---------|
| **Drowsiness** (0 to 100) | PERCLOS (fraction of time eyes are mostly closed over a rolling 60 s window), average blink duration, long closures, yawns (sustained high jaw-open), head nods (pitch drops then recovers), reduced blink-rate variability | Fatigue |
| **Attention** (0 to 100) | Face present, head yaw and gaze direction, tab visibility, keyboard and mouse activity, time since last interaction | Concentration |

Implementation notes:
- Prefer Face Landmarker **blendshapes** (eye-blink and jaw-open scores) and the **head-pose transform**; keep an eye-aspect-ratio computation as a fallback.
- **Per-user calibration:** a 20 to 30 second baseline at session start, because eye openness varies by person, glasses and camera angle. Thresholds are expressed relative to the baseline.
- **Quality gate:** if landmarks are unreliable (low light, face partly out of frame, glare), drop to presence-only and stop judging drowsiness. Say "I can't see you well, I'll stay quiet" rather than guessing.
- **Smoothing and hysteresis:** scores are smoothed over 30 to 60 seconds, and state changes require the condition to hold. Never react to a single frame.
- **Study modes** prevent false positives: Screen, Book/notes (looking down is normal), Presence-only, Camera off. In Camera off, the Buddy uses tab visibility, input activity and session time only.
- A Relaxed / Balanced / Strict slider scales sensitivity.
- Starting thresholds are heuristics to be tuned from real recordings. They are **not clinically validated**, and the product must not claim to diagnose sleepiness.

### 11.3 Nudge ladder (gentleness escalates, pressure does not)

| Step | Trigger | Response |
|------|---------|----------|
| 1 | Attention or drowsiness dips for about 45 s | Looks up, tilts head. No sound, no text. |
| 2 | Persists about 2 min | Small bubble: "Need a minute? I'm here." |
| 3 | Persists about 5 min | Offers choices: short break, switch topic, easier task, I'm fine. |
| 4 | Ignored | Back to quiet studying. No nudges for 15 minutes. |

### 11.4 Break engine (deterministic, in the browser)

Inputs: drowsiness score, attention score, minutes since last break, Pomodoro phase, recent quiz failures, and the user's past accept/dismiss history.

| Situation | Suggestion |
|-----------|------------|
| Fixed rhythm reached (default 25/5, configurable) | Pomodoro break |
| Sustained high drowsiness | Move break: stand, stretch, water, short walk. If it persists after a break, suggest a 10 to 20 minute rest or ending the session. |
| Sustained low attention, not drowsy | Switch topic, easier task, or a short timed sprint |
| Long unbroken stretch (for example 50+ minutes) | Eye rest (look far away for 20 seconds) plus stand |
| Repeated wrong answers (frustration) | Short break or an easier question set |

Rules:
- At most one proactive prompt per 15 minutes. User-initiated breaks always work.
- Never interrupt a question mid-answer; wait until it is submitted.
- Never block the UI. Every suggestion has "I'm fine".
- **Adaptive:** record each outcome in `break_events`. If the user dismisses most prompts, raise thresholds and lengthen cooldowns. If they accept, keep them. This is plain arithmetic on history, no LLM.
- Study time, drowsy minutes and break outcomes feed the roadmap so the planner can schedule harder topics when the user is usually fresh.

### 11.5 Dialogue

Short lines under 12 words. To save free-tier calls and keep the Buddy instant:

- A **pre-generated line bank** (trigger x tone, several variants each) generated once with `MODEL_SMART`, reviewed by a native speaker, and committed as the persona pack's `lines.json` (see [Brand and Persona](#brand-and-persona)).
- Optional contextual lines (for example topic-aware encouragement) use `MODEL_FAST` with a 2 second timeout and fall back to the bank.
- The weekly recap is the only routine LLM use.
- The animation never waits on the network.

`lines.json` entry shape:

```json
{
  "id": "break_long_study_01",
  "trigger": "long_unbroken_study",
  "tone": "friendly_checkin",
  "text": "20 minutes continuous-ah padichitta. Break venuma, {{address_term}}?",
  "reviewed_by": "<reviewer>",
  "reviewed_on": "<date>"
}
```

### 11.6 Privacy

Camera is opt-in and always shows an indicator. No frames or images are uploaded or stored. Only aggregates are saved (for example "focus 72%, 6 drowsy minutes this session"). The full behaviour spec lives in `docs/STUDY_BUDDY.md`.

## 12. Learning Engine

- **Mastery:** per-topic score from attempts (recent attempts weigh more, harder questions weigh more).
- **Weak topics:** below a mastery threshold, ranked by exam relevance and recency.
- **Spaced repetition:** SM-2 to start, FSRS later, via `due`, `stability`, `difficulty`.
- **Planner:** builds the roadmap from `goal_days`, `hours_per_day` and `level`, then re-plans when mastery or focus data changes.

## 13. Security and Privacy

- Firebase ID tokens verified on every request; ownership checked on every course, document, chunk and chat query.
- Retrieval always filters by `user_id` and `course_id` at the SQL level.
- No secrets in the frontend. LLM keys, service-account credentials and DB URLs stay server-side.
- Router and logs never record message or document text.
- Camera frames never leave the browser; only aggregates are stored.
- Rate-limit chat, upload and Buddy-line endpoints.
- **Third-party processing:** because inference is hosted, uploaded study material and chat text are sent to the model and embedding providers. Free tiers commonly reserve the right to use requests to improve their models. Tell users plainly, prefer providers with a no-training or zero-retention option for anything beyond demos, and let users delete a course (documents, chunks, embeddings) completely.

## 14. Deployment (free-first)

This stack is chosen to cost nothing at low usage and to degrade gracefully instead of failing.

| Component | Recommended | Why |
|-----------|-------------|-----|
| Frontend | Firebase Hosting or Cloudflare Pages | Static, free, and Firebase is already in the design |
| API | Google Cloud Run, `min-instances=0`, `max-instances=2` | Scales to zero; the free allowance covers 2M requests per month plus a monthly CPU and memory grant |
| Ingest worker | Cloud Run Job, triggered per upload | Runs only while ingesting; Indra OCR is CPU-only so no GPU is needed |
| Database | Neon free Postgres (pgvector) | Scale-to-zero, small free storage; Supabase is the alternative |
| File storage | Cloudflare R2 or Supabase Storage | Small free tiers; verify current limits |
| Auth | Firebase Authentication | Already in the design |
| LLM and embeddings | `LLMGateway` over free tiers | See [Model roles](#model-roles) |
| CI | GitHub Actions | Free for public repos |

Operational guidance:
- Bake the Indra model files into the worker image so ingestion has no network dependency on Hugging Face.
- Cloud Run requires a billing account and **has no hard spending cap**, so set a billing budget alert, keep `max-instances` low, and enforce per-user quotas in the app.
- The free allowance applies in specific regions; check that your chosen region qualifies, and pick one reasonably close to your users.
- Neon's free storage is small. Use `halfvec`, delete orphaned chunks when a document or course is deleted, and keep an eye on chunk counts.
- Add the deployed domain to Firebase's authorized domains or sign-in will fail.
- Verify current free-tier limits for every provider before relying on them; they change often.

**Alternatives**

| Option | Trade-off |
|--------|-----------|
| Render free web service + Neon | No Cloud Run setup, but the free service sleeps after inactivity and cold starts take tens of seconds |
| Single free VM running Docker Compose | One box for everything and no cold starts, but you manage the OS, backups and uptime; confirm the provider's current free offer first |
| Azure Container Apps | Works fine if you have credits; keep the same container images |

## 15. Evaluation Harness

Everything runs in CI on `FakeLLM` and the Firebase Auth Emulator, with no network or GPU. A separate nightly job runs the live evals against the free-tier APIs under a call budget.

| Suite | What it checks |
|-------|----------------|
| Unit | Mastery, SM-2/FSRS, planner, break policy, scoring. Pure functions, property-tested where useful |
| Contract | Every structured output validates; `FakeLLM` scripted failures prove the retry and fail-closed paths |
| Retrieval (`scripts/eval_retrieval.py`) | About 30 labelled questions per sample course: hit rate at k, citation correctness, the sufficiency gate's precision on unanswerable questions |
| Tutor groundedness | Answerable vs unanswerable question sets: correct refusal rate, citation validity, no invented sources |
| Router (`scripts/eval_router.py`) | About 30 labelled messages (including ambiguous and multi-intent): accuracy, rule hit rate, LLM-call rate, latency, confirmation-chip rate. Tunes `ROUTER_MIN_CONFIDENCE` |
| Red team | Injection-laden documents, jailbreak messages, cross-user retrieval attempts, exfiltration-by-link attempts, distress messages. Each must end in the expected guardrail action |
| Persona | About 20 scripted situations (procrastinating, struggling, mid-quiz, distress, mastery): correct tone mode chosen, no shaming language, persona off on distress, grounding and citations unchanged with persona on vs off, and unchanged when `MASCOT_NAME` is swapped |
| Brand lint | CI grep: brand strings appear only in allowed files |
| OCR | A small set of real scans, printed and handwritten: character error rate, confidence calibration (are low-confidence lines actually the wrong ones?) |
| **Buddy replay** | Recorded or synthetic time-series of drowsiness and attention signals fed into the rule engine: assert state transitions, nudge timing, cooldowns, adaptive thresholds and that the ladder never exceeds step 3 |
| Buddy field metrics | Share of nudges dismissed with "I'm fine" (target under 20%), return-to-focus time, session length, break acceptance rate |

## 16. Build Phases

Each phase ends with something deployed and testable. Effort figures are rough solo-developer estimates and will vary with your available hours.

- [ ] **Phase 0: Walking skeleton, harness base and brand base (about 1 week).** Firebase auth dependency, `users` and `courses`, upload to object storage, Neon with pgvector, Docker Compose, CI with `FakeLLM`, `LLMGateway` with two providers and failover, `StructuredCall`, `Tracer`, and a **first deploy to Cloud Run plus Firebase Hosting**. Create `frontend/src/brand.ts`, `docs/BRAND.md` and the `PRODUCT_NAME` / `MASCOT_NAME` config; start the clearance checklist.
  *Done when:* you can sign in on the deployed site, create a course, upload a file, a CI run passes against `FakeLLM`, and the brand lint rule passes.
- [ ] **Phase 1: Ingestion and retrieval (about 1.5 to 2 weeks).** Indra OCR worker (text-layer and scan paths, confidence flags), chunking, embeddings API, hybrid retrieval with RRF, topic grouping, the 30-question retrieval set.
  *Done when:* a scanned PDF becomes searchable chunks and `eval_retrieval.py` reports hit rate at k above your target.
- [ ] **Phase 2: Tutor with guardrails v1 (about 1 to 1.5 weeks).** One-node LangGraph tutor, Parama-AI persona pack v1 (tone modes, English fallback, `{{mascot_name}}` placeholders), sufficiency gate, citation checker, output sanitizer, injection scan, per-user quota, tutor groundedness and red-team suites.
  *Done when:* unanswerable questions are refused, every citation validates, the injection suite passes, and persona evals pass with the mascot name swapped to a dummy value.
- [ ] **Phase 3: Quiz and mastery (about 1.5 weeks).** Quiz generation with validation, attempts, mastery scoring, weak-topic detection.
  *Done when:* weak topics change correctly after a scripted attempt history.
- [ ] **Phase 4: Study Buddy v1 (about 2 weeks).** Original Parama-AI mascot in Rive with the state machine, tap and quick-action interactivity, cursor-following eyes, Pomodoro-driven states, tab-visibility and idle detection, break engine v1, native-speaker-reviewed Tanglish line bank (reviewer logged), `break_events` logging, Buddy replay harness.
  *Done when:* the Buddy runs a full Pomodoro session, reacts to quiz results, suggests breaks within the cooldown rules, and replay tests pass. **Gate A:** the brand clearance checklist must be complete before this is shown publicly.
- [ ] **Phase 5: Flashcards and roadmap (about 1.5 weeks).** SM-2 scheduling, planner, roadmap node, Buddy hooks (flashcard offers after repeated misses).
  *Done when:* due cards schedule correctly and the roadmap re-plans from new mastery data.
- [ ] **Phase 6: Orchestrator and `/api/chat` (about 1.5 weeks).** Rules, `MODEL_FAST` router, confirmation chips, `guard_in`/`guard_out` nodes, SSE streaming, router eval, guardrails v2 (wellbeing handling, academic-integrity option).
  *Done when:* `eval_router.py` meets your accuracy target and write agents never run below the confirmation threshold.
- [ ] **Phase 7: Study Buddy v2, drowsiness and concentration (about 2 to 3 weeks).** MediaPipe worker, calibration, quality gate, drowsiness and attention scores, study modes, sensitivity slider, adaptive break engine, rewards and weekly recap. Record real sessions to tune thresholds and extend the replay suite.
  *Done when:* in real use, "I'm fine" dismissals stay under 20% and the quality gate correctly stays quiet in bad lighting.
- [ ] **Phase 8: Dashboard and hardening (about 1 to 2 weeks).** Progress and fatigue charts, quotas and budget alerts, privacy page and course deletion, error monitoring, nightly live evals, load test within free-tier limits, **final brand audit** (privacy page, store listings and emails use the cleared name).
  *Done when:* a cost alert is configured, a full course delete removes all data, the nightly eval job is green, and the brand audit is signed off in `docs/BRAND.md`.

## 17. Configuration

Copy `.env.example` to `.env`. Secrets stay on the backend. Model slugs below are placeholders; pick current ones from each provider's list.

```env
# Brand
PRODUCT_NAME=PadhAI
MASCOT_NAME=Parama-AI

# Database
DATABASE_URL=postgresql+psycopg://padhai:padhai@postgres:5432/padhai

# Auth (Firebase)
FIREBASE_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-admin.json
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099      # dev/test only

# LLM gateway (ordered failover chain)
LLM_CHAIN=openrouter,groq,cerebras,google
OPENROUTER_API_KEY=
GROQ_API_KEY=
CEREBRAS_API_KEY=
GOOGLE_API_KEY=
MODEL_SMART=openrouter:<slug>|groq:<slug>       # per-provider slug mapping
MODEL_FAST=groq:<slug>|openrouter:<slug>
MODEL_VISION=                                   # optional, handwriting fallback
LLM_TIMEOUT_S=30
LLM_MAX_RETRIES=2
USER_DAILY_LLM_CALLS=150
REQUEST_MAX_LLM_CALLS=6

# Embeddings
EMBED_PROVIDER=                                  # provider that serves BGE-M3
EMBED_MODEL=BAAI/bge-m3
EMBED_DIM=1024                                   # fixed per index; changing it needs a re-embed

# OCR (Indra)
OCR_BACKEND=indra
INDRA_OCR_MODEL_DIR=/models/indra-ocr
OCR_MODE=auto                                    # auto | ocr | text
OCR_THREADS=2
OCR_MATH=false
OCR_MIN_LINE_CONF=0.80
OCR_VLM_FALLBACK=false
MAX_UPLOAD_MB=25
MAX_PAGES_PER_DOC=300

# Router and guardrails
ROUTER_MIN_CONFIDENCE=0.6
ROUTER_CONFIRM_BELOW=0.8                         # confirm before write agents
RETRIEVAL_MIN_SCORE=                             # tuned from eval_retrieval.py

# Persona
PERSONA_PACK=tanglish                            # tanglish | english (hinglish later)
PERSONA_DEFAULT_TONE=balanced                    # full | balanced | serious | english_only
PERSONA_ADDRESS_TERM=boss                        # neutral default
```

Frontend (public Firebase web config only): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_API_URL`. Brand constants live in `frontend/src/brand.ts`.

## 18. Quickstart (target)

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| API docs | http://localhost:8000/docs |
| Health | http://localhost:8000/health |
| Firebase Auth Emulator | http://localhost:9099 |

Compose runs `frontend`, `backend`, `postgres` (pgvector image), `worker` and the Firebase emulator. There is no model server; the only external dependencies are the hosted APIs in `.env`.

Run tests (they use the auth emulator and `FakeLLM`, so no network is needed):

```bash
pytest backend/tests -v
```

## 19. API Outline (planned)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/me` | Current user (creates the row on first sign-in) |
| POST/GET | `/api/courses` | Create and list courses |
| POST | `/api/courses/{id}/documents` | Upload a file; returns a document with status |
| GET | `/api/documents/{id}` | Status, page count, OCR confidence, chunk count |
| DELETE | `/api/courses/{id}` | Delete a course and all derived data |
| POST | `/api/chat` | Orchestrated chat (SSE): reply, agent, route source, citations |
| POST | `/api/quizzes` · POST `/api/attempts` | Generate a quiz; submit answers |
| GET | `/api/flashcards/due` · POST `/api/flashcards/{id}/review` | Spaced-repetition review |
| GET | `/api/roadmap/{course_id}` | Current plan |
| GET | `/api/progress/{course_id}` | Mastery, weak topics, focus and fatigue trends |
| POST | `/api/sessions` · PATCH `/api/sessions/{id}` | Start and end study sessions (aggregates) |
| POST | `/api/sessions/{id}/breaks` | Record a break suggestion outcome |
| POST | `/api/buddy/line` | Optional contextual Parama-AI line (falls back to the bank) |
| PATCH | `/api/buddy/settings` | Persona pack, tone mode, address term, sensitivity |
| GET | `/health` | Liveness check |

Every route except `/health` requires a valid Firebase ID token.

## 20. Repository Structure

```text
padhai/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/            # config (incl. PRODUCT_NAME, MASCOT_NAME), logging, firebase auth, rate limits
│   │   ├── api/             # routers
│   │   ├── db/              # session, models, Alembic migrations
│   │   ├── ingestion/       # loader, indra_ocr, chunker, embedder, injection_scan, topics
│   │   ├── retrieval/       # hybrid search, rrf, rerank, sufficiency gate
│   │   ├── ai/
│   │   │   ├── harness/     # gateway, structured, budget, cache, tracer, fake_llm
│   │   │   ├── guardrails/  # input, grounding, sanitizer, wellbeing, quotas
│   │   │   └── agents/      # state, router(rules+llm), tutor, quiz, flashcards,
│   │   │                    # roadmap, insights, graph
│   │   ├── learning/        # mastery, srs, weak_topics, planner, break_policy
│   │   ├── buddy/           # dialogue engine, tone-mode selector
│   │   ├── persona/         # packs: tanglish/, english/ (style block, lines.json, tone rules)
│   │   └── worker/          # ingestion jobs (Cloud Run Job entrypoint)
│   ├── tests/               # unit, contract, redteam, replay, persona, brand lint
│   ├── Dockerfile
│   ├── Dockerfile.worker    # bakes Indra model files into the image
│   └── pyproject.toml
├── frontend/
│   └── src/
│       ├── brand.ts         # PRODUCT_NAME, MASCOT_NAME, TAGLINE, TAGLINE_TA
│       ├── pages/           # Login, Dashboard, Course, Study, Quiz, Flashcards, Progress
│       ├── components/      # incl. buddy/ (Rive)
│       ├── workers/         # face-signals.worker.ts (MediaPipe)
│       ├── hooks/           # useFocus, useBuddy, useBreaks, useAuth
│       └── services/        # api client, firebase init
├── docs/                    # ARCHITECTURE.md, STUDY_BUDDY.md, GUARDRAILS.md, EVALUATION.md, BRAND.md
├── scripts/                 # eval_retrieval.py, eval_router.py, eval_tutor.py, eval_ocr.py
├── docker-compose.yml
├── .env.example
└── README.md
```

## 21. Open Questions

- **Brand clearance (Gate A).** PadhAI collides with an existing AI exam-prep app and another education app. Run the [clearance checklist](#brand-rollout-plan) and, if needed, use the decision tree (Parama-AI as product name, or a fallback name).
- Which embeddings provider serves BGE-M3 on a usable free tier, and what are its limits? (Decide before Phase 1: the vector dimension is fixed once the index exists.)
- Which `MODEL_SMART` and `MODEL_FAST` models give reliable JSON output on the free tiers? Benchmark two or three early with the contract suite.
- Indra OCR quality on real handwritten notes, and whether a vision-model fallback is worth the extra calls.
- Which privacy posture for production: free tiers, or a paid provider with no-training terms?
- Default Buddy sensitivity, break cadence, and whether phone-use detection is worth the privacy cost.
- Parama-AI art style and final mascot design (original; license recorded in `docs/BRAND.md`).

## 22. License

To be decided. Note that Indra OCR's model weights carry their own license terms (see [Ingestion](#6-ingestion-and-rag-pipeline)); check them against your licensing and commercial plans.
