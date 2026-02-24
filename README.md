# MOM (Minutes of Meeting)

Phase 1 MVP: start a meeting, capture live notes manually, generate Minutes of Meeting (MoM), and send MoM by email to attendees.

## 5-Phase Delivery Plan

1. Phase 1 - Baseline MVP (implemented)
   - Start/end meeting session
   - Capture live notes manually
   - Generate basic MoM text
   - Send MoM via SMTP (or preview mode when SMTP is not set)

2. Phase 2 - AI Note Intelligence
   - Auto summarize notes into agenda, decisions, action items
   - Speaker-aware note enrichment
   - Better MoM formatting templates

3. Phase 3 - Meeting Platform Integrations
   - Google Meet / Zoom / Teams calendar-linked session start
   - Participant auto-discovery and attendance mapping
   - Browser extension hooks for meeting context

4. Phase 4 - Live Transcription and Auto Notes
   - Real-time speech-to-text pipeline
   - Voice activity/speaker diarization
   - Automatic note capture while meeting is active

5. Phase 5 - Production Hardening
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

- `POST /api/meetings/start`
- `POST /api/meetings/:id/notes`
- `POST /api/meetings/:id/end`
- `POST /api/meetings/:id/send-mom`
- `GET /api/meetings/:id`
