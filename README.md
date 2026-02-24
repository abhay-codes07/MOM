# MOM (Minutes of Meeting)

Phase 5 MVP: adds authentication, persistent storage, retryable email job queue, analytics counters, and audit logs on top of Phases 1-4.

## 5-Phase Delivery Plan

1. Phase 1 - Baseline MVP (implemented)
   - Start/end meeting session
   - Capture live notes manually
   - Generate basic MoM text
   - Send MoM via SMTP (or preview mode when SMTP is not set)

2. Phase 2 - AI Note Intelligence (implemented)
   - Auto summarize notes into agenda, decisions, action items
   - Speaker-aware note enrichment
   - Better MoM formatting templates

3. Phase 3 - Meeting Platform Integrations (implemented)
   - Google Meet / Zoom / Teams calendar-linked session start
   - Participant auto-discovery and attendance mapping
   - Browser extension hooks for meeting context

4. Phase 4 - Live Transcription and Auto Notes (implemented)
   - Real-time speech-to-text pipeline
   - Voice activity/speaker diarization
   - Automatic note capture while meeting is active

5. Phase 5 - Production Hardening (implemented)
   - Authentication and user accounts
   - Persistent database and job queue
   - Retryable email delivery, analytics, audit logs, cloud deployment

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
copy .env.example .env
```

3. (Optional) Fill SMTP values in `.env` for real email sending.

4. Start app:

```bash
npm run dev
```

5. Open:

`http://localhost:4000`

## API endpoints

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/integrations/platforms`
- `GET /api/integrations/:platform/events?ownerEmail=...`
- `POST /api/integrations/start-from-event`
- `POST /api/meetings/start`
- `POST /api/meetings/:id/notes`
- `POST /api/meetings/:id/presence`
- `GET /api/meetings/:id/attendance`
- `POST /api/hooks/meeting-context` (uses `x-hook-key` when `HOOK_API_KEY` is set)
- `POST /api/meetings/:id/transcription/start`
- `POST /api/meetings/:id/transcription/chunks`
- `POST /api/meetings/:id/transcription/simulate`
- `POST /api/meetings/:id/transcription/stop`
- `GET /api/meetings/:id/transcription`
- `GET /api/meetings/:id/transcription/export?format=txt|json`
- `POST /api/meetings/:id/insights`
- `POST /api/meetings/:id/end`
- `POST /api/meetings/:id/send-mom`
- `GET /api/jobs` (admin)
- `GET /api/jobs/:id` (admin)
- `GET /api/admin/analytics` (admin)
- `GET /api/admin/audit?limit=...` (admin)
- `GET /api/admin/users` (admin)
- `POST /api/admin/users` (admin)
- `GET /api/meetings/:id`

## Browser extension sample (Phase 3)

- Folder: `browser-extension/`
- Load it as an unpacked extension in Chromium-based browsers.
- Use the popup to send `participants` and optional `note` into:
  - `POST /api/hooks/meeting-context`

## Phase 4 flow

1. Start meeting (manual or calendar-linked).
2. Start transcription.
3. Push transcript chunks manually or run simulation preset.
4. Auto note capture runs for relevant chunks (`AUTO_NOTE_FROM_TRANSCRIPT=true`).
5. View/export transcript, then end meeting and generate MoM.

Quick terminal demo:

- `powershell -ExecutionPolicy Bypass -File scripts/phase4-demo.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/phase5-demo.ps1`

## Phase 5 flow

1. Login with bootstrap admin credentials from `.env` (or your configured admin user).
2. Use the token for all API calls (`Authorization: Bearer <token>`) when `AUTH_REQUIRED=true`.
3. End meeting to generate MoM.
4. Queue email via `POST /api/meetings/:id/send-mom`.
5. Track delivery and retries via `GET /api/jobs` and view system telemetry via admin analytics/audit endpoints.

Operational notes:

- See `docs/PHASE5_RUNBOOK.md`.
