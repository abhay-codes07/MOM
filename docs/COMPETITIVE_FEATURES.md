# Competitive Features Playbook

## 1) Meeting Intelligence Score

Endpoint:

- `GET /api/meetings/:id/intelligence`

Returns:

- overall score + performance band
- mood
- top keywords
- suggested next agenda

## 2) Auto Next-Agenda Generator

Endpoint:

- `GET /api/meetings/:id/agenda-next`

Use after meeting end to plan the next session from unresolved action items and decision impacts.

## 3) MoM Version History and Compare

Endpoints:

- `GET /api/meetings/:id/mom-versions`
- `GET /api/meetings/:id/mom-versions/:versionId/compare?to=latest`

Tip:

1. End meeting (creates first snapshot).
2. Trigger insights refresh after end (can create updated snapshot).
3. Compare oldest vs latest for audit/change analysis.

## 4) Action Reminder Scheduler

Endpoint:

- `POST /api/meetings/:id/schedule-reminders`

Body:

```json
{
  "fromEmail": "admin@mom.local",
  "daysAhead": 1
}
```

This queues reminder jobs for open action items and sends them through the retryable worker.
