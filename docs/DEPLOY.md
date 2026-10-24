# Deployment Guide: Google Cloud Run & Firebase Hosting

This document provides step-by-step instructions for deploying the backend API to **Google Cloud Run** and the frontend to **Firebase Hosting**.

> [!IMPORTANT]
> **Safety Rule**: Deployment commands in this document are to be executed by you (the operator). Automated agents will not run deployment or destructive commands directly.

---

## Architecture Overview

```text
       Users / Mobile Browsers
                 │
                 ▼
       ┌──────────────────┐
       │ Firebase Hosting │ (SPA Static Assets)
       └─────────┬────────┘
                 │ API calls (Bearer token)
                 ▼
       ┌──────────────────┐
       │ Google Cloud Run │ (FastAPI Backend, min 0, max 2 instances)
       └────┬────────┬────┘
            │        │
            ▼        ▼
   ┌─────────────┐ ┌──────────────────┐
   │ Neon DB     │ │ Cloudflare R2 /  │
   │ (pgvector)  │ │ Supabase Storage │
   └─────────────┘ └──────────────────┘
```

---

## Step 0: Set Google Cloud Billing Budget Alert (Mandatory)

Cloud Run automatically scales instances based on demand. To avoid surprise costs, set a budget alert **before** deploying:

1. Open the [Google Cloud Billing Console](https://console.cloud.google.com/billing).
2. Select your Billing Account -> **Budgets & alerts** -> **Create budget**.
3. **Scope**: Select your Google Cloud Project.
4. **Amount**: Set a target budget (e.g. `$10.00` or `$25.00` USD / month).
5. **Actions & Thresholds**:
   - 50% ($5.00)
   - 90% ($9.00)
   - 100% ($10.00)
6. Check **Email alerts to billing account administrators and users**.
7. Click **Finish**.

---

## Step 1: External Services & Secrets Setup

### 1. Neon PostgreSQL with pgvector
1. Log in to [Neon Console](https://console.neon.tech).
2. Create a project `padhai-prod` in your closest region (e.g., `asia-south1` or `ap-southeast-1`).
3. Copy the pooled connection string:
   ```bash
   DATABASE_URL="postgresql+asyncpg://user:password@ep-xyz.region.aws.neon.tech/neondb?sslmode=require"
   ```

### 2. Store Secrets in Google Secret Manager
Run the following commands using the `gcloud` CLI to securely store backend secrets:

```bash
# Enable Secret Manager and Cloud Run APIs
gcloud services enable secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com

# Create database URL secret
echo -n "postgresql+asyncpg://user:password@ep-xyz.neon.tech/neondb?sslmode=require" | \
  gcloud secrets create padhai-db-url --data-file=-

# Create LLM Provider API keys
echo -n "sk-or-v1-..." | gcloud secrets create padhai-openrouter-key --data-file=-
echo -n "gsk_..." | gcloud secrets create padhai-groq-key --data-file=-
echo -n "csk_..." | gcloud secrets create padhai-cerebras-key --data-file=-
echo -n "AIzaSy..." | gcloud secrets create padhai-google-key --data-file=-

# Create Firebase Admin service account secret (JSON content)
gcloud secrets create padhai-firebase-sa --data-file=path/to/service-account.json
```

---

## Step 2: Build & Deploy Backend API to Cloud Run

### 1. Build and push container using Cloud Build
From the repository root:

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION="asia-south1"

# Submit image build to Google Container Registry / Artifact Registry
gcloud builds submit backend \
  --tag gcr.io/$PROJECT_ID/padhai-backend:v0.1.0
```

### 2. Deploy to Cloud Run
Deploy with explicit instance caps (`--min-instances=0 --max-instances=2`) to stay strictly within budget:

```bash
gcloud run deploy padhai-backend \
  --image gcr.io/$PROJECT_ID/padhai-backend:v0.1.0 \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 512Mi \
  --cpu 1 \
  --port 8000 \
  --set-env-vars "ENVIRONMENT=production,LLM_CHAIN=openrouter,groq,cerebras,google,REQUEST_MAX_LLM_CALLS=6,USER_DAILY_LLM_CALLS=25" \
  --set-secrets "DATABASE_URL=padhai-db-url:latest,OPENROUTER_API_KEY=padhai-openrouter-key:latest,GROQ_API_KEY=padhai-groq-key:latest,CEREBRAS_API_KEY=padhai-cerebras-key:latest,GOOGLE_API_KEY=padhai-google-key:latest"
```

### 3. Verify Backend Deployment
Retrieve the Cloud Run service URL and test the health endpoint:

```bash
export BACKEND_URL=$(gcloud run services describe padhai-backend --region $REGION --format='value(status.url)')

# Health check (requires no auth)
curl -s "${BACKEND_URL}/health"
# Expected output: {"status":"healthy","version":"0.1.0"}
```

---

## Step 3: Run Database Migrations

Apply Alembic migrations against the production database:

```bash
cd backend
DATABASE_URL="postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require" \
  uv run alembic upgrade head
```

Verify that the pgvector extension and the initial tables (`users`, `courses`, `documents`, `llm_usage`, `guardrail_events`) were created.

---

## Step 4: Deploy Frontend to Firebase Hosting

### 1. Configure Production Environment
In `frontend/`, create `.env.production` (do not commit secrets):

```bash
cat << 'EOF' > frontend/.env.production
VITE_API_BASE_URL=https://padhai-backend-xyz.a.run.app
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=padhai-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=padhai-app
VITE_FIREBASE_STORAGE_BUCKET=padhai-app.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
EOF
```

### 2. Configure `firebase.json` for SPA Rewrites
Ensure `firebase.json` exists in repository root:

```json
{
  "hosting": {
    "public": "frontend/dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

### 3. Build & Deploy
```bash
# Build production bundle
cd frontend
npm ci
npm run build
cd ..

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

---

## Step 5: Add Deployed Domain to Firebase Authorized Domains

1. Open the [Firebase Console](https://console.firebase.google.com).
2. Go to **Build** -> **Authentication** -> **Settings** tab.
3. Scroll down to **Authorized domains**.
4. Click **Add domain** and enter your deployed frontend URL (e.g. `padhai-app.web.app` or custom domain).
5. If using custom domains, add DNS CNAME records provided by Firebase Hosting.

---

## Step 6: Post-Deploy Verification Checklist

- [ ] `/health` returns HTTP 200: `{"status":"healthy","version":"0.1.0"}`
- [ ] Visit frontend URL in browser. Login screen renders with `{PRODUCT_NAME}` brand title.
- [ ] Sign in with Google or Email/Password works.
- [ ] Token is attached to `/api/me` call; user profile displays in Navbar.
- [ ] Create a course (e.g. "Computer Systems Architecture").
- [ ] Upload a test PDF document; observe status transition (`queued` -> `processing`).
- [ ] Check Cloud Run metrics: instance count scales down to 0 after inactivity.
