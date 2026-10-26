# Platform Privacy Pledge

**Last updated:** October 2026

We believe educational tools should protect your personal privacy unconditionally. Here is exactly how we handle your study data, camera signals, and AI interactions.

---

## 1. Local Camera & Zero Raw Frame Guarantee
- **Frames Never Leave Your Device:** All facial landmark detection, eye-aspect-ratio (EAR) computation, and study attention metrics run **100% locally** in your browser's Web Worker using MediaPipe.
- **No Video Storage or Transmission:** The platform never stores, saves, streams, or transmits raw camera frames, canvas bitmaps, or audio to any server or third party.
- **Camera Off by Default:** Webcam monitoring is completely opt-in. You can study with camera disabled at any time, or choose "Presence-Only" mode.
- **Quality Gate:** If lighting is poor or landmarks are unreliable, the mascot companion automatically stays quiet and falls back to simple timer mode rather than making assumptions.

---

## 2. Document Processing & Hosted AI Models
- **Purpose-Limited Use:** When you upload course notes or textbooks, they are parsed, chunked, and stored securely with vector embeddings solely to power your personalized study sessions, quizzes, and chat answers.
- **Third-Party AI Disclosure:** Query snippets and retrieval contexts are sent to hosted AI providers (such as Groq, Google, OpenRouter, Cerebras) via encrypted TLS endpoints to generate explanations and flashcards.
- **Explicit Delimiters & Security:** Uploaded document text is strictly treated as untrusted data within boundary delimiters to prevent prompt injection.

---

## 3. Strict No-Text Observability
- **We Never Log Your Conversations or Notes:** Our system logs, tracers, and guardrail events record only anonymous identifiers, token counts, request latency, and safety verdicts.
- **No Surveillance or Tracking:** We do not sell your personal information or use your study history for advertising.

---

## 4. Complete Data Sovereignty & Right to be Forgotten
- **Course Cascade Deletion:** Deleting a course immediately deletes all documents, vector embeddings, chunks, generated flashcards, and physical files from cloud storage.
- **Account Purge ("Delete Everything"):** You have the right to erase all your data instantly. Under your Account Settings, clicking **"Delete My Account & All Data"** permanently purges your account, courses, sessions, and files with zero lingering copies.

---

*Questions or concerns regarding your privacy? Contact our privacy team.*
