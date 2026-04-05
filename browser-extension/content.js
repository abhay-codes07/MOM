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
    participantSnapshot: [],
    userEmail: null
  };

  // ─── Badge ──────────────────────────────────────────────────────────────────

  function ensureBadge() {
    if (STATE.badgeEl) return;
    const el = document.createElement("div");
    el.id = "mom-live-indicator";
    Object.assign(el.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "999999",
      padding: "8px 10px", borderRadius: "999px", fontFamily: "Segoe UI, sans-serif",
      fontSize: "12px", fontWeight: "700", color: "#fff", background: "#c0392b",
      boxShadow: "0 4px 14px rgba(0,0,0,.25)", cursor: "default"
    });
    el.textContent = "MOM OFF";
    document.body.appendChild(el);
    STATE.badgeEl = el;
  }

  function setBadge() {
    ensureBadge();
    if (STATE.enabled && STATE.meetingId) {
      STATE.badgeEl.textContent = "● MOM REC";
      STATE.badgeEl.style.background = "#0d6b54";
    } else {
      STATE.badgeEl.textContent = "MOM OFF";
      STATE.badgeEl.style.background = "#c0392b";
    }
  }

  // ─── Caption parsing ─────────────────────────────────────────────────────────

  function parseCaptionText(raw) {
    const text = String(raw || "").trim();
    const m = text.match(/^([^:]{1,50}):\s*(.+)$/);
    if (!m) return { speaker: "Participant", text };
    return { speaker: m[1].trim(), text: m[2].trim() };
  }

  // ─── Participant & email scraping ─────────────────────────────────────────────

  function scrapeUserEmail() {
    if (STATE.userEmail) return STATE.userEmail;

    // 1. Check storage (set by popup)
    chrome.storage.local.get(["mom_config"], r => {
      const email = r.mom_config?.userEmail;
      if (email) STATE.userEmail = email;
    });

    // 2. Try page meta tags (rarely set by Meet, but worth checking)
    for (const meta of document.querySelectorAll("meta")) {
      const content = meta.getAttribute("content") || "";
      const em = content.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (em) { STATE.userEmail = em[0].toLowerCase(); return STATE.userEmail; }
    }

    // 3. Google account email sometimes embedded in aria-labels on profile avatar
    for (const el of document.querySelectorAll("[aria-label]")) {
      const label = el.getAttribute("aria-label") || "";
      const em = label.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (em) { STATE.userEmail = em[0].toLowerCase(); return STATE.userEmail; }
    }

    // 4. Check window.__GAPI__ or similar Google account objects
    try {
      const scripts = document.querySelectorAll("script:not([src])");
      for (const s of scripts) {
        const em = s.textContent.match(/"([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})"/i);
        if (em && !em[1].includes("example") && !em[1].includes("google.com")) {
          STATE.userEmail = em[1].toLowerCase();
          return STATE.userEmail;
        }
      }
    } catch (_) { /* ignore CSP errors */ }

    return null;
  }

  function captureParticipants() {
    const found = new Map(); // email/name → participant object

    // Add the current user if we know their email
    const selfEmail = scrapeUserEmail();
    if (selfEmail) {
      found.set(selfEmail, { name: selfEmail.split("@")[0], email: selfEmail, action: "join", source: "self_detected" });
    }

    // Strategy 1: Elements with emails in aria-label
    for (const el of document.querySelectorAll("[aria-label]")) {
      const label = el.getAttribute("aria-label") || "";
      const em = label.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (em) {
        const email = em[0].toLowerCase();
        const name = label.replace(em[0], "").replace(/[()]/g, "").trim() || email.split("@")[0];
        found.set(email, { name, email, action: "join", source: "meet_aria_email" });
      }
    }

    // Strategy 2: Participant chips / people panel names
    const nameSelectors = [
      "[data-participant-id]",
      "[data-self-name]",
      ".KF4T6b", ".zWGUib", ".cS7aqe", // common Meet class names (may change)
      "[aria-label*='participant']",
      "[data-hovercard-id]"
    ];
    for (const sel of nameSelectors) {
      try {
        for (const node of document.querySelectorAll(sel)) {
          const rawName = (
            node.getAttribute("data-self-name") ||
            node.getAttribute("data-hovercard-id") ||
            node.textContent ||
            ""
          ).trim();
          if (!rawName || rawName.length > 80) continue;

          // If it looks like an email
          const em = rawName.match(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i);
          if (em) {
            found.set(rawName.toLowerCase(), { name: rawName.split("@")[0], email: rawName.toLowerCase(), action: "join", source: "meet_dom_email" });
          } else if (rawName.length >= 2) {
            const key = rawName.toLowerCase();
            if (!found.has(key)) {
              found.set(key, { name: rawName, action: "join", source: "meet_dom_probe" });
            }
          }
        }
      } catch (_) { /* selector may not exist */ }
    }

    STATE.participantSnapshot = Array.from(found.values()).slice(0, 50);
  }

  // ─── Caption capture ──────────────────────────────────────────────────────────

  function enqueueCaption(entry) {
    if (!entry.text) return;
    STATE.queue.push(entry);
  }

  async function flushQueue() {
    if (!STATE.enabled || !STATE.meetingId || STATE.queue.length === 0) return;

    const payload = {
      meetingId: STATE.meetingId,
      captions: STATE.queue.splice(0, 25),
      participants: STATE.participantSnapshot
    };

    const headers = { "Content-Type": "application/json" };
    if (STATE.hookKey) headers["x-hook-key"] = STATE.hookKey;

    try {
      await fetch(`${STATE.backend}/api/hooks/meeting-context`, {
        method: "POST", headers, body: JSON.stringify(payload)
      });
    } catch (_) { /* transient failure — keep capturing */ }
  }

  function scanCaptions() {
    if (!STATE.enabled) return;

    const nodes = document.querySelectorAll("div[aria-live='polite'], div[aria-atomic='true'], [jsname='tgaKEf']");
    for (const node of nodes) {
      const raw = (node.textContent || "").trim();
      if (!raw || raw.length < 3) continue;

      const parsed = parseCaptionText(raw);
      const key = `${parsed.speaker}|${parsed.text}`;
      if (STATE.knownCaptionKeys.has(key)) continue;
      STATE.knownCaptionKeys.add(key);
      if (STATE.knownCaptionKeys.size > 600) STATE.knownCaptionKeys.clear();

      enqueueCaption({ speaker: parsed.speaker, text: parsed.text, source: "google_meet_caption" });
    }
  }

  function startLoops() {
    if (STATE.flushTimer) return;
    STATE.flushTimer = setInterval(() => {
      scanCaptions();
      captureParticipants();
      flushQueue();
    }, 1500);
  }

  function stopLoops() {
    if (STATE.flushTimer) { clearInterval(STATE.flushTimer); STATE.flushTimer = null; }
  }

  function setConfig(config) {
    STATE.enabled = Boolean(config.enabled);
    STATE.meetingId = String(config.meetingId || "");
    STATE.backend = String(config.backend || "http://localhost:4000").replace(/\/+$/, "");
    STATE.hookKey = String(config.hookKey || "");

    if (STATE.enabled && STATE.meetingId) startLoops();
    else stopLoops();
    setBadge();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  chrome.storage.local.get(["mom_live_config"], r => setConfig(r.mom_live_config || {}));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.mom_live_config) return;
    setConfig(changes.mom_live_config.newValue || {});
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "mom:setLiveConfig") {
      setConfig(msg.payload || {});
      sendResponse({ ok: true, enabled: STATE.enabled, meetingId: STATE.meetingId });
    }
    if (msg.type === "mom:getPageInfo") {
      sendResponse({ title: document.title, url: location.href, userEmail: STATE.userEmail });
    }
  });

  ensureBadge();
  setBadge();
  // Attempt email scrape once on load
  setTimeout(scrapeUserEmail, 2000);
})();
