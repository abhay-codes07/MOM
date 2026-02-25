# MOM (Minutes of Meeting)

MOM is a full-stack meeting assistant that captures notes, generates MoM, analyzes insights, tracks attendance, supports live transcription, and sends MoM through a retryable email queue.

## Current Status

| Phase | Status | Core Outcome |
| --- | --- | --- |
| Phase 1 | Implemented | Meeting start/end, note capture, MoM generation, email send |
| Phase 2 | Implemented | Insight extraction (summary, decisions, actions, speakers) |
| Phase 3 | Implemented | Meet/Zoom/Teams integration flow + attendance mapping + browser hook |
| Phase 4 | Implemented | Live transcription lifecycle + simulation + transcript export |
| Phase 5 | Implemented | Auth, persistence, queue retries, audit logs, analytics, admin APIs |

## Important Feature

Every generated MoM now starts with an **Overall Meeting Mood** line.  
This mood summary appears at the top of the email body that attendees receive.

Another new feature: **Secure Shareable MoM Link**  
You can generate a read-only share link for each meeting MoM and open it in browser.

New differentiator pack:

- **Meeting Intelligence Score** (engagement, actionability, decisiveness, coverage).
- **Top Keyword Signal Map** for conversational themes.
- **Next Meeting Agenda Auto-Synthesis** from unresolved actions and decisions.
- **MoM Version History + Compare** to track how minutes evolve.
- **Action Reminder Scheduler** that queues owner follow-up reminder emails.

## Why It Was Only Capturing Typed Notes

Before live Meet capture is enabled, MOM records only:

- notes you type in the app UI, or
- notes manually sent by extension one-shot mode.

To capture conversation live, run the Google Meet extension in **live mode** (steps below) and enable Meet captions.

## Google Meet Live Capture Steps

1. Start MOM app (`npm run dev`) and login.
2. Start a meeting in MOM and copy the `meetingId`.
3. Open Google Meet and turn on captions.
4. Load/refresh extension from `browser-extension/`.
5. In extension popup:
   - backend: `http://localhost:4000`
   - meetingId: paste your meeting id
   - hook key: optional
6. Click **Start Live Capture On This Tab**.
7. Verify Meet page shows badge: `MOM RECORDING`.
8. End meeting in MOM and generate/send MoM.

Important:

- Meet page usually does not expose participant emails reliably, so live email extraction is limited.
- This extension is not an official Google Meet plugin; it overlays its own recording badge.

## Architecture

- `src/server.js`: main API server and orchestration
- `src/auth.js`: password hashing and token auth
- `src/persistence.js`: JSON-backed persistence (`data/mom-db.json`)
- `src/queue.js`: email job queue + retry/backoff
- `src/audit.js`: audit event model and retention
- `src/transcription.js`: transcription session/chunk utilities
- `src/platform.js`: meeting platform integration helpers
- `public/index.html`: browser UI
- `public/styles.css`: luxury visual system (glass cards, sticky blur nav, motion)
- `public/app.js`: frontend logic + API orchestration
- `browser-extension/`: extension sample for meeting context hooks

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
copy .env.example .env
```

3. Start the app:

```bash
npm run dev
```

4. Open:

`http://localhost:4000`

### Frontend Navigation

- Top nav uses anchor links to sections (`Home`, `Features`, `Pricing`, `Control`, etc.).
- Main functional area is `Control Center`.
- Advanced operations (calendar start, transcription, admin calls) are included inside Control Center.

## Default Admin Login

Use these only for local development (change in production):

- Email: `admin@mom.local`
- Password: `admin12345`

## API Overview

### Health and Auth

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Integrations

- `GET /api/integrations/platforms`
- `GET /api/integrations/:platform/events?ownerEmail=...`
- `POST /api/integrations/start-from-event`

### Meetings

- `POST /api/meetings/start`
- `POST /api/meetings/:id/notes`
- `POST /api/meetings/:id/presence`
- `GET /api/meetings/:id/attendance`
- `POST /api/meetings/:id/insights`
- `POST /api/meetings/:id/end`
- `POST /api/meetings/:id/send-mom`
- `POST /api/meetings/:id/share-mom`
- `GET /api/meetings/:id/share-mom`
- `GET /api/meetings/:id`
- `GET /api/meetings/:id/intelligence`
- `GET /api/meetings/:id/agenda-next`
- `GET /api/meetings/:id/mom-versions`
- `GET /api/meetings/:id/mom-versions/:versionId/compare?to=latest|<versionId>`
- `POST /api/meetings/:id/schedule-reminders`

### Public Share

- `GET /share/mom/:shareId` (read-only public MoM page)

### Transcription

- `POST /api/meetings/:id/transcription/start`
- `POST /api/meetings/:id/transcription/chunks`
- `POST /api/meetings/:id/transcription/simulate`
- `POST /api/meetings/:id/transcription/stop`
- `GET /api/meetings/:id/transcription`
- `GET /api/meetings/:id/transcription/export?format=txt|json`

### Admin

- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/admin/analytics`
- `GET /api/admin/audit?limit=...`
- `GET /api/admin/users`
- `POST /api/admin/users`

## Demo Scripts

- Phase 4 flow: `powershell -ExecutionPolicy Bypass -File scripts/phase4-demo.ps1`
- Phase 5 flow: `powershell -ExecutionPolicy Bypass -File scripts/phase5-demo.ps1`

## Production Notes

- Set strong values for `AUTH_SECRET` and `ADMIN_PASSWORD`
- Keep `AUTH_REQUIRED=true`
- Configure SMTP values for real email delivery
- Persist `DATA_DIR` on durable storage
- See [docs/PHASE5_RUNBOOK.md](docs/PHASE5_RUNBOOK.md)
- Competitive workflows: [docs/COMPETITIVE_FEATURES.md](docs/COMPETITIVE_FEATURES.md)
