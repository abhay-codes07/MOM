# Phase 5 Runbook

## Production baseline

1. Set strong secrets in `.env`:
   - `AUTH_SECRET`
   - `ADMIN_PASSWORD`
   - SMTP credentials
2. Keep `AUTH_REQUIRED=true`.
3. Persist `DATA_DIR` on durable storage.

## Queue behavior

- `POST /api/meetings/:id/send-mom` creates an async job.
- Worker interval: `JOB_WORKER_INTERVAL_MS` (default 2000 ms).
- Retry cap: `EMAIL_JOB_MAX_RETRIES` (default 3).
- Job states: `queued`, `processing`, `succeeded`, `failed`.

## Observability

- `GET /api/admin/analytics` for counters.
- `GET /api/admin/audit?limit=...` for event timeline.
- `GET /api/jobs` for queued/failed/succeeded mail jobs.
