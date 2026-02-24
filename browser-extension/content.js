(function () {
  const STATE = {
    enabled: false,
    meetingId: "",
    backend: "http://localhost:4000",
    hookKey: "",
    knownCaptionKeys: new Set(),
    queue: [],
    flushTimer: null,
    badgeEl: null,
    participantSnapshot: []
  };

  function ensureBadge() {
    if (STATE.badgeEl) {
      return;
    }

    const el = document.createElement("div");
    el.id = "mom-live-indicator";
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "16px";
    el.style.zIndex = "999999";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "999px";
    el.style.fontFamily = "Segoe UI, sans-serif";
    el.style.fontSize = "12px";
    el.style.fontWeight = "700";
    el.style.color = "#fff";
    el.style.background = "#c0392b";
    el.style.boxShadow = "0 4px 14px rgba(0,0,0,.25)";
    el.textContent = "MOM OFF";
    document.body.appendChild(el);
    STATE.badgeEl = el;
  }

  function setBadge() {
    ensureBadge();
    if (STATE.enabled && STATE.meetingId) {
      STATE.badgeEl.textContent = "MOM RECORDING";
      STATE.badgeEl.style.background = "#0d6b54";
    } else {
      STATE.badgeEl.textContent = "MOM OFF";
      STATE.badgeEl.style.background = "#c0392b";
    }
  }

  function parseCaptionText(raw) {
    const text = String(raw || "").trim();
    const m = text.match(/^([^:]{1,50}):\s*(.+)$/);
    if (!m) {
      return { speaker: "Participant", text };
    }
    return { speaker: m[1].trim(), text: m[2].trim() };
  }

  function captureParticipants() {
    const participants = [];
    const chips = document.querySelectorAll("[data-participant-id], [data-self-name], [aria-label*='participant']");
    for (const node of chips) {
      const name = (node.getAttribute("data-self-name") || node.textContent || "").trim();
      if (!name || name.length > 60) {
        continue;
      }
      participants.push({ name, action: "join", source: "meet_dom_probe" });
    }

    const dedup = new Map();
    for (const p of participants) {
      dedup.set(p.name.toLowerCase(), p);
    }
    STATE.participantSnapshot = Array.from(dedup.values()).slice(0, 30);
  }

  function enqueueCaption(entry) {
    if (!entry.text) {
      return;
    }
    STATE.queue.push(entry);
  }

  async function flushQueue() {
    if (!STATE.enabled || !STATE.meetingId || STATE.queue.length === 0) {
      return;
    }

    const payload = {
      meetingId: STATE.meetingId,
      captions: STATE.queue.splice(0, 25),
      participants: STATE.participantSnapshot
    };

    const headers = { "Content-Type": "application/json" };
    if (STATE.hookKey) {
      headers["x-hook-key"] = STATE.hookKey;
    }

    try {
      await fetch(`${STATE.backend}/api/hooks/meeting-context`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // ignore transient failures; queue capture continues
    }
  }

  function scanCaptions() {
    if (!STATE.enabled) {
      return;
    }

    const nodes = document.querySelectorAll("div[aria-live='polite'], div[aria-atomic='true']");
    for (const node of nodes) {
      const raw = (node.textContent || "").trim();
      if (!raw || raw.length < 3) {
        continue;
      }

      const parsed = parseCaptionText(raw);
      const key = `${parsed.speaker}|${parsed.text}`;
      if (STATE.knownCaptionKeys.has(key)) {
        continue;
      }
      STATE.knownCaptionKeys.add(key);
      if (STATE.knownCaptionKeys.size > 600) {
        STATE.knownCaptionKeys.clear();
      }

      enqueueCaption({
        speaker: parsed.speaker,
        text: parsed.text,
        source: "google_meet_caption"
      });
    }
  }

  function startLoops() {
    if (STATE.flushTimer) {
      return;
    }
    STATE.flushTimer = setInterval(() => {
      scanCaptions();
      captureParticipants();
      flushQueue();
    }, 1500);
  }

  function stopLoops() {
    if (STATE.flushTimer) {
      clearInterval(STATE.flushTimer);
      STATE.flushTimer = null;
    }
  }

  function setConfig(config) {
    STATE.enabled = Boolean(config.enabled);
    STATE.meetingId = String(config.meetingId || "");
    STATE.backend = String(config.backend || "http://localhost:4000").replace(/\/+$/, "");
    STATE.hookKey = String(config.hookKey || "");

    if (STATE.enabled && STATE.meetingId) {
      startLoops();
    } else {
      stopLoops();
    }
    setBadge();
  }

  chrome.storage.local.get(["mom_live_config"], (result) => {
    setConfig(result.mom_live_config || {});
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.mom_live_config) {
      return;
    }
    setConfig(changes.mom_live_config.newValue || {});
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "mom:setLiveConfig") {
      return;
    }
    setConfig(msg.payload || {});
    sendResponse({ ok: true, enabled: STATE.enabled, meetingId: STATE.meetingId });
  });

  ensureBadge();
  setBadge();
})();
