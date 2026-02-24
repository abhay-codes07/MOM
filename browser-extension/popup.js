const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = typeof message === "string" ? message : JSON.stringify(message, null, 2);
}

function parseParticipants(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split(",").map((x) => x.trim());
      return { name, email, action: "join", source: "browser_extension" };
    });
}

function getConfigFromUi() {
  return {
    backend: document.getElementById("backend").value.trim() || "http://localhost:4000",
    meetingId: document.getElementById("meetingId").value.trim(),
    hookKey: document.getElementById("hookKey").value.trim()
  };
}

function setConfigToUi(config) {
  if (!config) return;
  document.getElementById("backend").value = config.backend || "http://localhost:4000";
  document.getElementById("meetingId").value = config.meetingId || "";
  document.getElementById("hookKey").value = config.hookKey || "";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendConfigToTab(config) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    throw new Error("No active tab.");
  }

  if (!tab.url || !tab.url.includes("meet.google.com")) {
    throw new Error("Open Google Meet tab first.");
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "mom:setLiveConfig",
    payload: config
  });
  return response;
}

document.getElementById("startLiveBtn").addEventListener("click", async () => {
  try {
    const config = getConfigFromUi();
    if (!config.meetingId) {
      throw new Error("Meeting ID is required.");
    }

    const liveConfig = { ...config, enabled: true };
    await chrome.storage.local.set({ mom_live_config: liveConfig });
    await sendConfigToTab(liveConfig);
    setStatus({ message: "Live capture enabled on current Meet tab.", meetingId: config.meetingId });
  } catch (error) {
    setStatus(error.message);
  }
});

document.getElementById("stopLiveBtn").addEventListener("click", async () => {
  try {
    const config = getConfigFromUi();
    const liveConfig = { ...config, enabled: false };
    await chrome.storage.local.set({ mom_live_config: liveConfig });
    try {
      await sendConfigToTab(liveConfig);
    } catch (_) {
      // ignore if tab is closed or not on meet
    }
    setStatus("Live capture stopped.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.getElementById("sendBtn").addEventListener("click", async () => {
  try {
    const { backend, meetingId, hookKey } = getConfigFromUi();
    const participants = parseParticipants(document.getElementById("participants").value);
    const note = document.getElementById("note").value.trim();

    if (!meetingId) {
      throw new Error("Meeting ID is required.");
    }

    const headers = {
      "Content-Type": "application/json"
    };
    if (hookKey) {
      headers["x-hook-key"] = hookKey;
    }

    const response = await fetch(`${backend}/api/hooks/meeting-context`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        meetingId,
        participants,
        note
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Hook failed");
    }

    setStatus(data);
  } catch (error) {
    setStatus(error.message);
  }
});

chrome.storage.local.get(["mom_live_config"], (result) => {
  const config = result.mom_live_config || {};
  setConfigToUi(config);
});
