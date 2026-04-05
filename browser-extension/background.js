/**
 * MOM AI — Background Service Worker (MV3)
 *
 * Responsibilities:
 * 1. Auto-mode: detect Google Meet tab open/close → auto-start / auto-end meeting via API
 * 2. Audio capture: orchestrate chrome.tabCapture → offscreen document → audio chunk upload
 */

const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/;
const OFFSCREEN_PATH = "offscreen.html";

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mom_config"], r => resolve(r.mom_config || {}));
  });
}

async function setConfig(patch) {
  const current = await getConfig();
  return new Promise(resolve => {
    chrome.storage.local.set({ mom_config: { ...current, ...patch } }, resolve);
  });
}

// Per-tab meeting state: tabId → { meetingId, audioActive }
const tabMeetings = new Map();

// ─── Offscreen document management ───────────────────────────────────────────

async function hasOffscreen() {
  const clients = await clients?.matchAll?.({ type: "window" }) ?? [];
  // Use chrome.offscreen.hasDocument (Chrome 116+)
  try {
    return await chrome.offscreen.hasDocument();
  } catch (_) {
    return false;
  }
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_PATH),
    reasons: ["USER_MEDIA"],
    justification: "Recording Google Meet tab audio for meeting transcription"
  });
}

async function closeOffscreen() {
  try {
    if (await hasOffscreen()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (_) { /* ignore */ }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiPost(path, body, config) {
  const backend = (config.backend || "http://localhost:4000").replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  const res = await fetch(`${backend}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ─── Auto-start / auto-end ────────────────────────────────────────────────────

async function autoStartMeeting(tab) {
  const config = await getConfig();
  if (!config.autoMode || !config.token) return;

  // Derive a human-friendly title from the tab title or URL
  const meetCode = (tab.url || "").match(/meet\.google\.com\/([a-z0-9-]+)/)?.[1] || "Unknown";
  const title = tab.title && tab.title !== "Meet" && !tab.title.startsWith("Meet -")
    ? tab.title
    : `Google Meet — ${meetCode}`;

  const attendees = config.userEmail ? [config.userEmail] : ["participant@meet"];

  try {
    const data = await apiPost("/api/meetings/start", {
      title,
      attendees,
      meetingLink: tab.url,
      platform: "google_meet",
      source: "auto"
    }, config);

    const meetingId = data.id;
    tabMeetings.set(tab.id, { meetingId, audioActive: false });

    // Tell content script to start capturing with this meeting ID
    try {
      const liveConfig = {
        enabled: true,
        meetingId,
        backend: config.backend || "http://localhost:4000",
        hookKey: config.hookKey || ""
      };
      await chrome.storage.local.set({ mom_live_config: liveConfig });
      await chrome.tabs.sendMessage(tab.id, { type: "mom:setLiveConfig", payload: liveConfig });
    } catch (_) { /* content script may not be ready yet */ }

    chrome.notifications.create(`mom-start-${tab.id}`, {
      type: "basic",
      iconUrl: "icon48.png",
      title: "MOM AI Recording",
      message: `Meeting started: ${title}`
    });

    // Auto-start audio capture if configured
    if (config.audioCapture) {
      await startAudioCapture(tab.id, meetingId, config);
    }

    console.log(`[MOM] Auto-started meeting ${meetingId} for tab ${tab.id}`);
  } catch (err) {
    console.error("[MOM] Auto-start failed:", err.message);
  }
}

async function autoEndMeeting(tabId) {
  const state = tabMeetings.get(tabId);
  if (!state) return;

  const config = await getConfig();
  tabMeetings.delete(tabId);

  // Stop audio capture
  if (state.audioActive) {
    await stopAudioCapture();
  }

  // Stop content script capture
  try {
    const liveConfig = { enabled: false, meetingId: "", backend: config.backend || "http://localhost:4000", hookKey: "" };
    await chrome.storage.local.set({ mom_live_config: liveConfig });
  } catch (_) { /* ignore */ }

  try {
    await apiPost(`/api/meetings/${state.meetingId}/end`, {}, config);

    chrome.notifications.create(`mom-end-${tabId}`, {
      type: "basic",
      iconUrl: "icon48.png",
      title: "MOM AI — Meeting Ended",
      message: "Minutes of Meeting are being generated and will be emailed."
    });

    console.log(`[MOM] Auto-ended meeting ${state.meetingId}`);
  } catch (err) {
    console.error("[MOM] Auto-end failed:", err.message);
  }
}

// ─── Audio capture ────────────────────────────────────────────────────────────

async function startAudioCapture(tabId, meetingId, config) {
  const state = tabMeetings.get(tabId);
  if (!state || state.audioActive) return;

  try {
    // Get stream ID for the tab (MV3 approach — Chrome 116+)
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    await ensureOffscreen();

    chrome.runtime.sendMessage({
      type: "mom:startAudioRecording",
      payload: {
        streamId,
        meetingId,
        backend: config.backend || "http://localhost:4000",
        token: config.token || ""
      }
    });

    state.audioActive = true;
    tabMeetings.set(tabId, state);
    console.log(`[MOM] Audio capture started for meeting ${meetingId}`);
  } catch (err) {
    console.error("[MOM] Audio capture start failed:", err.message);
  }
}

async function stopAudioCapture() {
  try {
    chrome.runtime.sendMessage({ type: "mom:stopAudioRecording" });
    await closeOffscreen();
  } catch (_) { /* ignore */ }
}

// ─── Tab event listeners ──────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  const url = tab.url || "";
  const isOnMeet = MEET_URL_RE.test(url);
  const wasOnMeet = tabMeetings.has(tabId);

  if (isOnMeet && !wasOnMeet) {
    await autoStartMeeting(tab);
  } else if (!isOnMeet && wasOnMeet) {
    await autoEndMeeting(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  if (tabMeetings.has(tabId)) {
    await autoEndMeeting(tabId);
  }
});

// ─── Message handler (from popup or content script) ──────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "mom:getActiveMeeting") {
    // Popup asking which meeting is active on the current tab
    const tabId = sender.tab?.id ?? msg.tabId;
    const state = tabMeetings.get(tabId) || null;
    sendResponse({ state });
    return true;
  }

  if (msg.type === "mom:manualStartAudio") {
    const { tabId, meetingId } = msg.payload || {};
    getConfig().then(config => {
      startAudioCapture(tabId, meetingId, config);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "mom:manualStopAudio") {
    stopAudioCapture().then(() => sendResponse({ ok: true }));
    return true;
  }
});
