# Operations Runbook

**Last updated:** October 2026

Operational runbook for production deployment, failover management, key rotation, and cost controls.

---

## 1. How to Rotate Keys

### 1.1 Firebase Admin SDK Service Account
1. Open the Firebase Console -> **Project Settings** -> **Service accounts**.
2. Click **Generate new private key** and download the JSON credentials file.
3. In Google Cloud Run (or Cloud Secret Manager):
   - Update the secret `FIREBASE_ADMIN_CREDENTIALS` with the new JSON payload.
   - Or deploy the JSON to the secure secret mount path specified in `GOOGLE_APPLICATION_CREDENTIALS`.
4. Deploy/restart the API container to pick up the new service account.
5. Delete the old key from the Firebase Console once traffic verifies healthy on `/health`.

### 1.2 LLM Provider API Keys (Groq, OpenRouter, Cerebras, Google)
1. Generate the replacement API key in the respective provider's developer console.
2. Update the environment variable in Cloud Run / secret manager:
   - `GROQ_API_KEY`
   - `OPENROUTER_API_KEY`
   - `CEREBRAS_API_KEY`
   - `GOOGLE_API_KEY`
3. Execute the pre-flight verification:
   ```bash
   python scripts/eval_nightly.py --budget 5
   ```
4. Revoke the retired key in the provider portal.

### 1.3 Object Storage Credentials (S3 / Cloudflare R2)
1. Generate a new Access Key ID and Secret Access Key in Cloudflare R2 or Supabase Storage.
2. Update `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in environment secrets.
3. Test upload and deletion flows before revoking old credentials.

---

## 2. How to Swap a Model Slug

The application maps logical roles (`MODEL_SMART`, `MODEL_FAST`, `MODEL_VISION`) to per-provider model slugs.

### 2.1 Configuration Format
Slugs are declared as pipe-separated `provider:model_slug` pairs:
```env
MODEL_SMART=groq:llama-3.3-70b-versatile|openrouter:meta-llama/llama-3.3-70b-instruct|google:gemini-1.5-pro|cerebras:llama3.3-70b
MODEL_FAST=groq:llama-3.1-8b-instant|openrouter:meta-llama/llama-3.1-8b-instruct|google:gemini-1.5-flash|cerebras:llama3.1-8b
```

### 2.2 Swap Procedure
1. Verify the new model slug is available and supports structured JSON outputs at temperature 0.
2. Edit the role string in environment settings (e.g. updating Groq's fast model slug).
3. Restart or redeploy the API container.
4. Run the router and tutor eval suite:
   ```bash
   python scripts/eval_router.py
   python scripts/eval_nightly.py --budget 10
   ```

---

## 3. How to Add a Provider to the Chain

### 3.1 Procedure
1. Confirm the provider offers an OpenAI-compatible `/chat/completions` endpoint over TLS.
2. Add the provider API key to the environment (e.g. `MISTRAL_API_KEY=...`).
3. Append the provider name to the `LLM_CHAIN` comma-delimited failover list:
   ```env
   LLM_CHAIN=groq,openrouter,cerebras,google,mistral
   ```
4. Provide corresponding slug entries in `MODEL_SMART` and `MODEL_FAST`.
5. The gateway will automatically include the new provider in its failover sequence and manage circuit breaking.

---

## 4. How to Handle a Provider Outage

### 4.1 Automatic Failover Behavior
- `LLMGateway` automatically catches timeouts (`LLM_TIMEOUT_S=30`), HTTP 429 (Rate Limits), and 5xx server errors.
- If a provider fails 3 times consecutively, its internal circuit breaker trips to `OPEN` for 60 seconds, transparently routing traffic to the next provider in `LLM_CHAIN`.

### 4.2 Manual Outage Intervention
If a primary provider suffers a prolonged regional outage:
1. Re-order `LLM_CHAIN` in Cloud Run environment settings to put a healthy provider first:
   ```env
   # Example: Move OpenRouter ahead of Groq during Groq incident
   LLM_CHAIN=openrouter,cerebras,google,groq
   ```
2. Redeploy the Cloud Run revision (takes < 15 seconds).
3. Confirm recovery on the `/health` endpoint and view structured logs.

---

## 5. How to Respond to a Cost Alert

### 5.1 Cloud Run Budget Alert
1. **Check active instances:** Ensure `max-instances=2` is enforced:
   ```bash
   gcloud run services update api --max-instances=2
   ```
2. **Review traffic anomalies:** Check structured logs for abnormal request spikes or unauthorized scrapers.
3. **Tighten rate limits:** If necessary, reduce limits in environment variables:
   - Set `USER_DAILY_LLM_CALLS=50` (down from 150).
   - Set `RATE_LIMIT_CHAT_RPM=10` (down from 20).

### 5.2 Database Storage Alert (Neon Free Tier)
1. Neon free tier provides limited storage. Check chunk and embedding counts.
2. Ensure cascade deletion is working cleanly:
   - Deleting unused courses or documents cleans up orphaned chunks and frees vector index space.
3. Run VACUUM ANALYZE to reclaim space if needed.

### 5.3 Hosted Model Credit Alert
1. Check usage counters per provider in `LLMUsage` table or provider console.
2. Rotate the primary provider in `LLM_CHAIN` to one with unused free-tier allowance.
