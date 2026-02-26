(() => {
  let meetingId = null;
  let lastMom = "";
  let authToken = "";

  const status = document.getElementById("status");
  const mobileTray = document.getElementById("mobileTray");

  function setStatus(msg) {
    status.textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
  }

  function setAuthState(isLoggedIn) {
    const ids = [
      "startBtn", "loadEventsBtn", "startFromEventBtn", "analyticsBtn", "auditBtn", "jobsBtn"
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.disabled = !isLoggedIn;
    }
  }

  function setMeetingState(active) {
    const ids = [
      "noteBtn", "insightsBtn", "endBtn", "presenceBtn", "attendanceBtn", "txStartBtn", "txChunkBtn", "txSimBtn",
      "txStopBtn", "txStatusBtn", "txExportBtn", "sendBtn", "shareCreateBtn", "shareViewBtn",
      "intelligenceBtn", "riskRadarBtn", "nextAgendaBtn", "followupDraftsBtn", "momVersionsBtn",
      "momCompareLatestBtn", "scheduleRemindersBtn"
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.disabled = !active;
    }
  }

  function closeTray() {
    mobileTray.classList.remove("open");
  }

  document.getElementById("menuBtn")?.addEventListener("click", () => mobileTray.classList.add("open"));
  document.getElementById("closeTrayBtn")?.addEventListener("click", closeTray);
  mobileTray.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeTray));

  async function callApi(path, method, body) {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : await res.text();

    if (!res.ok) {
      const message = typeof data === "object" && data?.message ? data.message : String(data);
      throw new Error(message || "Request failed");
    }
    return data;
  }

  document.getElementById("loginBtn")?.addEventListener("click", async () => {
    try {
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value.trim();
      const data = await callApi("/api/auth/login", "POST", { email, password });
      authToken = data.token;
      setAuthState(true);
      setStatus({ message: "Login successful", user: data.user });
    } catch (e) {
      setStatus(`Login failed: ${e.message}`);
    }
  });

  document.getElementById("startBtn")?.addEventListener("click", async () => {
    try {
      const title = document.getElementById("title").value.trim();
      const attendees = document.getElementById("attendees").value.split(",").map((x) => x.trim()).filter(Boolean);
      const meetingLink = document.getElementById("meetingLink").value.trim();
      const data = await callApi("/api/meetings/start", "POST", { title, attendees, meetingLink });
      meetingId = data.id;
      lastMom = "";
      setMeetingState(true);
      setStatus({ message: "Meeting started", meetingId, title: data.title, attendees: data.attendees });
    } catch (e) {
      setStatus(`Start failed: ${e.message}`);
    }
  });

  document.getElementById("noteBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const text = document.getElementById("note").value.trim();
      const speaker = document.getElementById("speaker").value.trim();
      const data = await callApi(`/api/meetings/${meetingId}/notes`, "POST", { text, speaker });
      document.getElementById("note").value = "";
      setStatus({ message: "Note added", note: data });
    } catch (e) {
      setStatus(`Note failed: ${e.message}`);
    }
  });

  document.getElementById("insightsBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/insights`, "POST");
      setStatus(data);
    } catch (e) {
      setStatus(`Insights failed: ${e.message}`);
    }
  });

  document.getElementById("endBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/end`, "POST");
      lastMom = data.mom;
      setStatus(data.mom);
    } catch (e) {
      setStatus(`End failed: ${e.message}`);
    }
  });

  document.getElementById("sendBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      if (!lastMom) throw new Error("End meeting first");
      const fromEmail = document.getElementById("fromEmail").value.trim();
      const data = await callApi(`/api/meetings/${meetingId}/send-mom`, "POST", { fromEmail });
      setStatus(data);
    } catch (e) {
      setStatus(`Send failed: ${e.message}`);
    }
  });

  document.getElementById("shareCreateBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/share-mom`, "POST");
      setStatus(data);
    } catch (e) {
      setStatus(`Share create failed: ${e.message}`);
    }
  });

  document.getElementById("shareViewBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/share-mom`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Share fetch failed: ${e.message}`);
    }
  });

  document.getElementById("loadEventsBtn")?.addEventListener("click", async () => {
    try {
      const ownerEmail = document.getElementById("ownerEmail").value.trim() || "owner@example.com";
      const platform = document.getElementById("platform").value.trim() || "google_meet";
      const data = await callApi(`/api/integrations/${platform}/events?ownerEmail=${encodeURIComponent(ownerEmail)}`, "GET");
      const formatted = data.events.map((e) => `${e.eventId} | ${e.title} | ${e.startsAt} | ${e.meetingLink}`).join("\n");
      document.getElementById("eventList").value = formatted;
      document.getElementById("eventId").value = data.events[0]?.eventId || "";
      setStatus({ message: "Events loaded", count: data.events.length, firstEventId: data.events[0]?.eventId || null });
    } catch (e) {
      setStatus(`Load events failed: ${e.message}`);
    }
  });

  document.getElementById("startFromEventBtn")?.addEventListener("click", async () => {
    try {
      const ownerEmail = document.getElementById("ownerEmail").value.trim() || "owner@example.com";
      const platform = document.getElementById("platform").value.trim() || "google_meet";
      const eventId = document.getElementById("eventId").value.trim();
      if (!eventId) throw new Error("Load events first and keep an Event ID");
      const data = await callApi("/api/integrations/start-from-event", "POST", { ownerEmail, platform, eventId });
      meetingId = data.meeting.id;
      lastMom = "";
      setMeetingState(true);
      setStatus({ message: "Meeting started from calendar", meetingId, source: data.meeting.source, platform: data.meeting.platform });
    } catch (e) {
      setStatus(`Calendar start failed: ${e.message}`);
    }
  });

  document.getElementById("presenceBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const name = document.getElementById("presenceName").value.trim();
      const email = document.getElementById("presenceEmail").value.trim();
      const action = document.getElementById("presenceAction").value.trim() || "join";
      const data = await callApi(`/api/meetings/${meetingId}/presence`, "POST", { name, email, action, source: "ui_manual" });
      setStatus(data);
    } catch (e) {
      setStatus(`Presence failed: ${e.message}`);
    }
  });

  document.getElementById("attendanceBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/attendance`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Attendance failed: ${e.message}`);
    }
  });

  document.getElementById("txStartBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const language = document.getElementById("txLanguage").value.trim();
      const provider = document.getElementById("txProvider").value.trim();
      const data = await callApi(`/api/meetings/${meetingId}/transcription/start`, "POST", { language, provider });
      setStatus(data);
    } catch (e) {
      setStatus(`Transcription start failed: ${e.message}`);
    }
  });

  document.getElementById("txChunkBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const text = document.getElementById("txChunk").value.trim();
      const data = await callApi(`/api/meetings/${meetingId}/transcription/chunks`, "POST", { text, source: "ui_live" });
      setStatus(data);
    } catch (e) {
      setStatus(`Chunk failed: ${e.message}`);
    }
  });

  document.getElementById("txSimBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const preset = "daily-standup";
      const data = await callApi(`/api/meetings/${meetingId}/transcription/simulate`, "POST", { preset, intervalMs: 1000 });
      setStatus(data);
    } catch (e) {
      setStatus(`Simulation failed: ${e.message}`);
    }
  });

  document.getElementById("txStopBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/transcription/stop`, "POST");
      setStatus(data);
    } catch (e) {
      setStatus(`Stop failed: ${e.message}`);
    }
  });

  document.getElementById("txStatusBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/transcription`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Transcript failed: ${e.message}`);
    }
  });

  document.getElementById("txExportBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/transcription/export?format=json`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Transcript export failed: ${e.message}`);
    }
  });

  document.getElementById("analyticsBtn")?.addEventListener("click", async () => {
    try {
      const data = await callApi("/api/admin/analytics", "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Analytics failed: ${e.message}`);
    }
  });

  document.getElementById("auditBtn")?.addEventListener("click", async () => {
    try {
      const data = await callApi("/api/admin/audit?limit=25", "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Audit failed: ${e.message}`);
    }
  });

  document.getElementById("jobsBtn")?.addEventListener("click", async () => {
    try {
      const data = await callApi("/api/jobs", "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Jobs failed: ${e.message}`);
    }
  });

  document.getElementById("intelligenceBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/intelligence`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Intelligence failed: ${e.message}`);
    }
  });

  document.getElementById("nextAgendaBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/agenda-next`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Next agenda failed: ${e.message}`);
    }
  });

  document.getElementById("riskRadarBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/risk-radar`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Risk radar failed: ${e.message}`);
    }
  });

  document.getElementById("followupDraftsBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/followup-drafts`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`Follow-up drafts failed: ${e.message}`);
    }
  });

  document.getElementById("momVersionsBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const data = await callApi(`/api/meetings/${meetingId}/mom-versions`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`MoM versions failed: ${e.message}`);
    }
  });

  document.getElementById("momCompareLatestBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const versionsData = await callApi(`/api/meetings/${meetingId}/mom-versions`, "GET");
      const versions = versionsData.versions || [];
      if (versions.length < 2) {
        throw new Error("Need at least 2 MoM versions. Regenerate MoM via insights refresh after end.");
      }
      const oldest = versions[versions.length - 1];
      const data = await callApi(`/api/meetings/${meetingId}/mom-versions/${oldest.id}/compare?to=latest`, "GET");
      setStatus(data);
    } catch (e) {
      setStatus(`MoM compare failed: ${e.message}`);
    }
  });

  document.getElementById("scheduleRemindersBtn")?.addEventListener("click", async () => {
    try {
      if (!meetingId) throw new Error("Start meeting first");
      const fromEmail = document.getElementById("reminderFromEmail").value.trim();
      const daysAhead = Number(document.getElementById("reminderDaysAhead").value || 1);
      const data = await callApi(`/api/meetings/${meetingId}/schedule-reminders`, "POST", { fromEmail, daysAhead });
      setStatus(data);
    } catch (e) {
      setStatus(`Reminder scheduling failed: ${e.message}`);
    }
  });

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("show");
      }
    }
  }, { threshold: 0.14 });

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

  setAuthState(false);
  setMeetingState(false);
})();
