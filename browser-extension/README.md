# Browser Extension Hook

This extension can run in two modes:

1. One-shot manual context send.
2. Live Google Meet caption capture (near-real-time).

## Setup

1. Open `chrome://extensions` (or Edge equivalent).
2. Enable Developer mode.
3. Click Load unpacked and select `browser-extension/`.
4. Re-open popup to verify it shows **MOM Live Hook**.

## Live Capture (Google Meet)

1. Start MOM backend (`npm run dev`) and login in web app.
2. Start a meeting in MOM UI and copy `meetingId`.
3. Join Google Meet and turn captions on in Meet.
4. Open extension popup:
   - Backend: `http://localhost:4000`
   - Meeting ID: paste from MOM
   - Hook key (optional)
5. Click **Start Live Capture On This Tab**.
6. In Meet page you should see badge: `MOM RECORDING`.

The extension continuously sends caption batches to:

- `POST /api/hooks/meeting-context`

## Important Limits

- Google Meet does not reliably expose participant emails in page DOM, so live email extraction is limited.
- Extension captures what appears in captions; if captions are off, live transcript will be minimal.
- Visibility on Meet page is shown via injected badge (`MOM RECORDING`), not official Meet UI integration.
