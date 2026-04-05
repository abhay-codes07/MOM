const statusEl = document.getElementById("status");
const authStatusEl = document.getElementById("authStatus");
const headerBadge = document.getElementById("headerBadge");

function setStatus(msg) {
  statusEl.textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
}

function setAuthStatus(msg, ok = null) {
  authStatusEl.textContent = msg;
  authStatusEl.style.color = ok === true ? "#0d9966" : ok === false ? "#e05252" : "#6b7a99";
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getStoredConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mom_config"], r => resolve(r.mom_config || {}));
  });
}

function saveConfig(patch) {
  return new Promise(resolve => {
    chrome.storage.local.get(["mom_config"], r => {
      const updated = { ...(r.mom_config || {}), ...patch };
      chrome.storage.local.set({ mom_config: updated }, resolve);
    });
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function getUiValues() {
  return {
    backend: document.getElementById("backend").value.trim() || "http://localhost:4000",
    userEmail: document.getElementById("userEmail").value.trim(),
    hookKey: document.getElementById("hookKey").value.trim(),
    meetingId: document.getElementById("meetingId").value.trim()
  };
}

function applyConfigToUi(cfg) {
  if (!cfg) return;
  if (cfg.backend) document.getElementById("backend").value = cfg.backend;
  if (cfg.userEmail) document.getElementById("userEmail").value = cfg.userEmail;
  if (cfg.hookKey) document.getElementById("hookKey").value = cfg.hookKey;
  if (cfg.meetingId) document.getElementById("meetingId").value = cfg.meetingId;
  if (cfg.loginEmail) document.getElementById("loginEmail").value = cfg.loginEmail;

  document.getElementById("autoModeToggle").checked = Boolean(cfg.autoMode);
  document.getElementById("audioCaptureToggle").checked = Boolean(cfg.audioCapture);

  if (cfg.token) {
    setAuthStatus(`Logged in as ${cfg.loginEmail || "user"}`, true);
  }
}

async function updateHeaderBadge() {
  const cfg = await getStoredConfig();
  const live = await new Promise(r => chrome.storage.local.get(["mom_live_config"], d => r(d.mom_live_config || {})));
  if (live.enabled && live.meetingId) {
    headerBadge.textContent = "REC";
    headerBadge.classList.remove("off");
  } else {
    headerBadge.textContent = "OFF";
    headerBadge.classList.add("off");
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

document.getElementById("loginBtn").addEventListener("click", async () => {
  const { backend } = getUiValues();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) { setAuthStatus("Email and password required.", false); return; }

  try {
    setAuthStatus("Logging in…");
    const res = await fetch(`${backend}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Login failed");

    await saveConfig({ backend, userEmail: getUiValues().userEmail || email, token: data.token, loginEmail: email });
    setAuthStatus(`Logged in as ${email}`, true);
    setStatus("Auth token saved. Auto mode will now work.");
  } catch (err) {
    setAuthStatus(err.message, false);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await saveConfig({ token: null, loginEmail: null });
  setAuthStatus("Logged out.", null);
  setStatus("Token cleared.");
});

// ─── Settings save on change ──────────────────────────────────────────────────

["backend", "userEmail", "hookKey"].forEach(id => {
  document.getElementById(id).addEventListener("change", async () => {
    const { backend, userEmail, hookKey } = getUiValues();
    await saveConfig({ backend, userEmail, hookKey });
  });
});

// ─── Auto mode toggles ────────────────────────────────────────────────────────

document.getElementById("autoModeToggle").addEventListener("change", async e => {
  await saveConfig({ autoMode: e.target.checked });
  setStatus(e.target.checked ? "Auto mode ON — will auto-start/end meetings." : "Auto mode OFF.");
});

document.getElementById("audioCaptureToggle").addEventListener("change", async e => {
  await saveConfig({ audioCapture: e.target.checked });
  setStatus(e.target.checked ? "Audio capture ON — mic + tab audio will be transcribed." : "Audio capture OFF.");
});

// ─── Manual live capture ──────────────────────────────────────────────────────

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

document.getElementById("startLiveBtn").addEventListener("click", async () => {
  const { backend, meetingId, hookKey } = getUiValues();
  if (!meetingId) { setStatus("Meeting ID is required."); return; }

  const liveConfig = { enabled: true, meetingId, backend, hookKey };
  await chrome.storage.local.set({ mom_live_config: liveConfig });

  const tab = await getActiveTab();
  if (!tab?.url?.includes("meet.google.com")) { setStatus("Open a Google Meet tab first."); return; }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "mom:setLiveConfig", payload: liveConfig });
    setStatus(`Capturing on Meet tab.\nMeeting ID: ${meetingId}`);
    await updateHeaderBadge();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

document.getElementById("stopLiveBtn").addEventListener("click", async () => {
  const { backend, hookKey } = getUiValues();
  const liveConfig = { enabled: false, meetingId: "", backend, hookKey };
  await chrome.storage.local.set({ mom_live_config: liveConfig });

  const tab = await getActiveTab();
  if (tab) {
    try { await chrome.tabs.sendMessage(tab.id, { type: "mom:setLiveConfig", payload: liveConfig }); } catch (_) { /* ok */ }
  }

  setStatus("Capture stopped.");
  await updateHeaderBadge();
});

// ─── Manual audio capture ─────────────────────────────────────────────────────

document.getElementById("startAudioBtn").addEventListener("click", async () => {
  const { meetingId } = getUiValues();
  if (!meetingId) { setStatus("Enter a Meeting ID first."); return; }

  const tab = await getActiveTab();
  if (!tab?.url?.includes("meet.google.com")) { setStatus("Open a Google Meet tab first."); return; }

  try {
    await chrome.runtime.sendMessage({
      type: "mom:manualStartAudio",
      payload: { tabId: tab.id, meetingId }
    });
    setStatus(`Audio capture started.\nMeeting ID: ${meetingId}`);
  } catch (err) {
    setStatus(`Audio error: ${err.message}`);
  }
});

// ─── One-shot note ────────────────────────────────────────────────────────────

function parseParticipants(raw) {
  return String(raw || "").split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const [name, email] = line.split(",").map(x => x.trim());
    return { name, email, action: "join", source: "browser_extension" };
  });
}

document.getElementById("sendBtn").addEventListener("click", async () => {
  const { backend, meetingId, hookKey } = getUiValues();
  const participants = parseParticipants(document.getElementById("participants").value);
  const note = document.getElementById("note").value.trim();

  if (!meetingId) { setStatus("Meeting ID is required."); return; }

  const headers = { "Content-Type": "application/json" };
  if (hookKey) headers["x-hook-key"] = hookKey;

  try {
    const res = await fetch(`${backend}/api/hooks/meeting-context`, {
      method: "POST", headers,
      body: JSON.stringify({ meetingId, participants, note })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Hook failed");
    setStatus(data);
  } catch (err) {
    setStatus(err.message);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const cfg = await getStoredConfig();
  applyConfigToUi(cfg);
  await updateHeaderBadge();
})();
