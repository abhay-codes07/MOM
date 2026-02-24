# Browser Extension Hook (Phase 3)

This sample extension posts participant context to the MOM backend.

## Setup

1. Open `chrome://extensions` (or Edge extensions page).
2. Enable Developer mode.
3. Click Load unpacked and select the `browser-extension` folder.

## Usage

1. Start a meeting in MOM and copy the `meetingId`.
2. Open extension popup.
3. Fill backend URL (default `http://localhost:4000`), meeting ID, and participants (`name,email` per line).
4. Optionally add hook key if backend has `HOOK_API_KEY` set.
5. Click Send Context.

The extension calls:

- `POST /api/hooks/meeting-context`
