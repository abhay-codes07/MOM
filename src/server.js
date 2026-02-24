const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const { detectPlatform, getSupportedPlatforms, listMockCalendarEvents } = require("./platform");
const { registerPresence, getAttendanceSummary } = require("./attendance");
const {
  createTranscriptionSession,
  addTranscriptChunk,
  stopTranscriptionSession,
  buildTranscriptText,
  shouldCaptureAsNote
} = require("./transcription");
const { getPresetChunks } = require("./transcript-presets");
const { createUser, verifyPassword, signAuthToken, verifyAuthToken, extractBearerToken } = require("./auth");
const { readDb, writeDb } = require("./persistence");
const { createAuditEvent, appendAudit } = require("./audit");
const {
  createEmailJob,
  markJobProcessing,
  markJobSuccess,
  markJobRetry,
  markJobFailed,
  getNextRunnableJob
} = require("./queue");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;
const authRequired = String(process.env.AUTH_REQUIRED || "true") === "true";
const authSecret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const transcriptionTimers = new Map();
const meetings = new Map();
const store = {
  users: [],
  jobs: [],
  auditLogs: [],
  analytics: {
    meetingCreated: 0,
    meetingEnded: 0,
    notesCreated: 0,
    transcriptChunks: 0,
    momsQueued: 0,
    momsSent: 0,
    authLogins: 0
  }
};

function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAttendees(attendees) {
  return attendees.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
}

function serializeMeeting(meeting) {
  return {
    ...meeting,
    attendanceMap: Array.from(meeting.attendanceMap.values()),
    discoveredAttendees: Array.from(meeting.discoveredAttendees.values())
  };
}

function deserializeMeeting(raw) {
  const attendanceArray = Array.isArray(raw.attendanceMap) ? raw.attendanceMap : [];
  const map = new Map();
  for (const item of attendanceArray) {
    const key = (item.email || item.name || "participant").toLowerCase();
    map.set(key, item);
  }

  return {
    ...raw,
    attendanceMap: map,
    discoveredAttendees: new Set(Array.isArray(raw.discoveredAttendees) ? raw.discoveredAttendees : [])
  };
}

function persistState() {
  writeDb({
    meetings: Array.from(meetings.values()).map(serializeMeeting),
    users: store.users,
    jobs: store.jobs,
    auditLogs: store.auditLogs,
    analytics: store.analytics
  });
}

function loadState() {
  const db = readDb();
  for (const rawMeeting of db.meetings || []) {
    meetings.set(rawMeeting.id, deserializeMeeting(rawMeeting));
  }
  store.users = Array.isArray(db.users) ? db.users : [];
  store.jobs = Array.isArray(db.jobs) ? db.jobs : [];
  store.auditLogs = Array.isArray(db.auditLogs) ? db.auditLogs : [];
  store.analytics = { ...store.analytics, ...(db.analytics || {}) };
}

function bump(metric, count = 1) {
  store.analytics[metric] = (store.analytics[metric] || 0) + count;
}

function recordAudit(action, req, meetingId = null, details = {}) {
  const actor = req?.user?.email || "system";
  const event = createAuditEvent({ actor, action, meetingId, details });
  appendAudit(store, event);
}

function createMeeting({ title, attendees, meetingLink = "", platform, source = "manual" }) {
  return {
    id: uuidv4(),
    title,
    attendees: normalizeAttendees(attendees),
    platform: platform || detectPlatform(meetingLink),
    meetingLink,
    source,
    startedAt: new Date().toISOString(),
    endedAt: null,
    isActive: true,
    notes: [],
    insights: null,
    mom: null,
    momShare: null,
    presenceEvents: [],
    attendanceMap: new Map(),
    discoveredAttendees: new Set(),
    transcription: null
  };
}

function extractInsights(notes) {
  const summary = [];
  const agenda = [];
  const decisions = [];
  const actionItems = [];
  const speakerStatsMap = new Map();

  for (const note of notes) {
    const speaker = note.speaker || "Participant";
    const text = normalizeSentence(note.text || "");
    if (!text) {
      continue;
    }

    const words = text.split(" ").filter(Boolean).length;
    const speakerStats = speakerStatsMap.get(speaker) || { speaker, notes: 0, words: 0 };
    speakerStats.notes += 1;
    speakerStats.words += words;
    speakerStatsMap.set(speaker, speakerStats);

    if (summary.length < 5) {
      summary.push(`${speaker}: ${text}`);
    }

    if (agenda.length < 5 && /^agenda[:\s-]/i.test(text)) {
      agenda.push(text.replace(/^agenda[:\s-]*/i, ""));
    }

    if (/(we (decided|agree)|decision|approved|finalized|go with)/i.test(text)) {
      decisions.push(`${speaker}: ${text}`);
    }

    if (/^(action|todo)[:\s-]/i.test(text) || /(follow up|will|needs to|should)/i.test(text)) {
      actionItems.push({
        owner: speaker,
        item: text.replace(/^(action|todo)[:\s-]*/i, ""),
        status: "open"
      });
    }
  }

  const speakerStats = Array.from(speakerStatsMap.values()).sort((a, b) => b.notes - a.notes);
  const dedup = (items, limit) => Array.from(new Set(items)).slice(0, limit);

  return {
    summary: dedup(summary, 6),
    agenda: dedup(agenda, 6),
    decisions: dedup(decisions, 8),
    actionItems: actionItems.slice(0, 12),
    speakerStats
  };
}

function inferMeetingMood(notes) {
  const positiveTerms = [
    "great", "good", "thanks", "approved", "resolved", "done", "clear", "aligned", "progress", "win", "happy"
  ];
  const negativeTerms = [
    "blocked", "delay", "risk", "issue", "problem", "conflict", "urgent", "escalate", "fail", "stuck", "concern"
  ];
  const neutralTerms = [
    "agenda", "update", "review", "discuss", "note", "sync", "plan", "timeline", "status"
  ];

  let positiveScore = 0;
  let negativeScore = 0;
  let neutralScore = 0;

  for (const note of notes) {
    const text = normalizeSentence(note.text || "").toLowerCase();
    if (!text) {
      continue;
    }

    for (const term of positiveTerms) {
      if (text.includes(term)) {
        positiveScore += 1;
      }
    }
    for (const term of negativeTerms) {
      if (text.includes(term)) {
        negativeScore += 1;
      }
    }
    for (const term of neutralTerms) {
      if (text.includes(term)) {
        neutralScore += 1;
      }
    }
  }

  const totalSignals = positiveScore + negativeScore + neutralScore;
  if (totalSignals === 0) {
    return {
      label: "Neutral",
      confidence: 0.5,
      rationale: "Not enough sentiment cues in notes."
    };
  }

  let label = "Neutral";
  let dominant = neutralScore;
  if (positiveScore > dominant) {
    label = "Positive";
    dominant = positiveScore;
  }
  if (negativeScore > dominant) {
    label = "Concerned";
    dominant = negativeScore;
  }

  return {
    label,
    confidence: Number((dominant / totalSignals).toFixed(2)),
    rationale: `Signals -> positive:${positiveScore}, neutral:${neutralScore}, negative:${negativeScore}`
  };
}

function formatMeetingResponse(meeting) {
  return {
    ...serializeMeeting(meeting),
    momShare: meeting.momShare,
    transcription: meeting.transcription
      ? {
        id: meeting.transcription.id,
        provider: meeting.transcription.provider,
        language: meeting.transcription.language,
        startedAt: meeting.transcription.startedAt,
        stoppedAt: meeting.transcription.stoppedAt,
        isActive: meeting.transcription.isActive,
        chunkCount: meeting.transcription.chunks.length
      }
      : null
  };
}

function generateMom(meeting) {
  const insights = meeting.insights || extractInsights(meeting.notes);
  const mood = inferMeetingMood(meeting.notes);
  const attendance = getAttendanceSummary(meeting);
  const noteLines = meeting.notes
    .map((n, i) => `${i + 1}. [${n.timestamp}] ${n.speaker || "Participant"}: ${n.text}`)
    .join("\n");

  const summaryBlock = insights.summary.length
    ? insights.summary.map((line) => `- ${line}`).join("\n")
    : "- No summary available.";
  const agendaBlock = insights.agenda.length
    ? insights.agenda.map((line) => `- ${line}`).join("\n")
    : "- Agenda was not explicitly captured.";
  const decisionBlock = insights.decisions.length
    ? insights.decisions.map((line) => `- ${line}`).join("\n")
    : "- No explicit decisions detected.";
  const actionBlock = insights.actionItems.length
    ? insights.actionItems.map((item) => `- ${item.item} (Owner: ${item.owner}, Status: ${item.status})`).join("\n")
    : "- No action items detected.";
  const speakerBlock = insights.speakerStats.length
    ? insights.speakerStats.map((s) => `- ${s.speaker}: ${s.notes} notes, ${s.words} words`).join("\n")
    : "- No speaker stats available.";
  const attendanceBlock = attendance.participants.length
    ? attendance.participants
      .map((p) => `- ${p.name}${p.email ? ` (${p.email})` : ""}: joins=${p.joins}, leaves=${p.leaves}`)
      .join("\n")
    : "- No attendance events captured.";

  return `Minutes of Meeting

Overall Meeting Mood: ${mood.label} (confidence ${mood.confidence})
Mood Rationale: ${mood.rationale}

Title: ${meeting.title}
Meeting ID: ${meeting.id}
Start: ${meeting.startedAt}
End: ${meeting.endedAt}
Attendees: ${meeting.attendees.join(", ")}
Platform: ${meeting.platform}
Meeting Link: ${meeting.meetingLink || "Not provided"}

Executive Summary:
${summaryBlock}

Agenda Highlights:
${agendaBlock}

Decisions:
${decisionBlock}

Action Items:
${actionBlock}

Speaker Participation:
${speakerBlock}

Attendance Map:
${attendanceBlock}

Discussion Notes:
${noteLines || "No notes captured."}`;
}

function getMeetingByShareId(shareId) {
  for (const meeting of meetings.values()) {
    if (meeting.momShare?.id === shareId) {
      return meeting;
    }
  }
  return null;
}

function ensureMomShare(meeting, req) {
  if (!meeting.momShare) {
    meeting.momShare = {
      id: crypto.randomBytes(16).toString("hex"),
      createdAt: new Date().toISOString()
    };
  }

  const host = req.get("host");
  const protocol = req.protocol || "http";
  const url = `${protocol}://${host}/share/mom/${meeting.momShare.id}`;
  return {
    ...meeting.momShare,
    url
  };
}

function buildTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function requireAuth(req, res, next) {
  if (!authRequired) {
    req.user = { id: "dev", email: "dev@local", role: "admin" };
    return next();
  }

  const token = extractBearerToken(req.headers.authorization);
  const payload = verifyAuthToken(token, authSecret);
  if (!payload) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = store.users.find((u) => u.id === payload.userId && u.email === payload.email);
  if (!user) {
    return res.status(401).json({ message: "User not found" });
  }

  req.user = { id: user.id, email: user.email, role: user.role };
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  return next();
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", authRequired, uptimeSeconds: Math.floor(process.uptime()) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = store.users.find((u) => u.email === normalizedEmail);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  user.lastLoginAt = new Date().toISOString();
  bump("authLogins");
  const token = signAuthToken({ userId: user.id, email: user.email, role: user.role }, authSecret, 3600 * 12);
  recordAudit("auth.login", null, null, { userEmail: user.email });
  persistState();

  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/auth/login" || req.path === "/health") {
    return next();
  }
  return requireAuth(req, res, next);
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/integrations/platforms", (req, res) => {
  res.json({ platforms: getSupportedPlatforms() });
});

app.get("/api/integrations/:platform/events", (req, res) => {
  const platform = req.params.platform;
  const valid = getSupportedPlatforms().some((x) => x.id === platform);
  if (!valid) {
    return res.status(400).json({ message: "Unsupported platform" });
  }

  const ownerEmail = req.query.ownerEmail || "owner@example.com";
  const events = listMockCalendarEvents(platform, ownerEmail);
  return res.json({ platform, events });
});

app.post("/api/integrations/start-from-event", (req, res) => {
  const { platform, eventId, ownerEmail } = req.body;
  if (!platform || !eventId) {
    return res.status(400).json({ message: "platform and eventId are required" });
  }

  const events = listMockCalendarEvents(platform, ownerEmail);
  const chosen = events.find((x) => x.eventId === eventId) || events[0];

  const meeting = createMeeting({
    title: chosen.title,
    attendees: chosen.attendees,
    meetingLink: chosen.meetingLink,
    platform,
    source: "calendar"
  });

  meetings.set(meeting.id, meeting);
  bump("meetingCreated");
  recordAudit("meeting.start.calendar", req, meeting.id, { title: meeting.title, platform });
  persistState();

  return res.status(201).json({
    meeting: formatMeetingResponse(meeting),
    fromCalendarEvent: chosen,
    selectedByFallback: chosen.eventId !== eventId
  });
});

app.post("/api/meetings/start", (req, res) => {
  const { title, attendees, meetingLink, platform } = req.body;

  if (!title || !Array.isArray(attendees) || attendees.length === 0) {
    return res.status(400).json({ message: "title and attendees[] are required" });
  }

  const meeting = createMeeting({ title, attendees, meetingLink, platform, source: "manual" });
  meetings.set(meeting.id, meeting);
  bump("meetingCreated");
  recordAudit("meeting.start.manual", req, meeting.id, { title: meeting.title, platform: meeting.platform });
  persistState();

  return res.status(201).json(formatMeetingResponse(meeting));
});

app.post("/api/meetings/:id/notes", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.isActive) {
    return res.status(400).json({ message: "Meeting already ended" });
  }

  const { text, speaker } = req.body;
  if (!text) {
    return res.status(400).json({ message: "Note text is required" });
  }

  const entry = {
    id: uuidv4(),
    text,
    speaker: speaker || "Participant",
    timestamp: new Date().toISOString()
  };

  meeting.notes.push(entry);
  bump("notesCreated");
  recordAudit("meeting.note.added", req, meeting.id, { speaker: entry.speaker });
  persistState();

  return res.status(201).json(entry);
});

app.post("/api/meetings/:id/presence", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  const { name, email, action, source } = req.body;
  if (!name && !email) {
    return res.status(400).json({ message: "name or email is required" });
  }

  const event = registerPresence(meeting, { name, email, action, source });
  recordAudit("meeting.presence", req, meeting.id, { name: event.name, email: event.email, action: event.action });
  persistState();

  return res.status(201).json({ event, attendance: getAttendanceSummary(meeting) });
});

app.post("/api/meetings/:id/transcription/start", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (meeting.transcription && meeting.transcription.isActive) {
    return res.status(400).json({ message: "Transcription already active" });
  }

  const { language, provider } = req.body || {};
  meeting.transcription = createTranscriptionSession({ language, provider });
  recordAudit("transcription.start", req, meeting.id, { provider: meeting.transcription.provider });
  persistState();

  return res.status(201).json({
    id: meeting.id,
    transcription: formatMeetingResponse(meeting).transcription
  });
});

app.post("/api/meetings/:id/transcription/chunks", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.transcription || !meeting.transcription.isActive) {
    return res.status(400).json({ message: "Transcription is not active" });
  }

  const { text, speaker, confidence, source } = req.body || {};
  if (!text) {
    return res.status(400).json({ message: "text is required" });
  }

  const chunk = addTranscriptChunk(meeting.transcription, { text, speaker, confidence, source });
  bump("transcriptChunks");
  let autoNote = null;
  if (String(process.env.AUTO_NOTE_FROM_TRANSCRIPT || "true") === "true" && shouldCaptureAsNote(chunk)) {
    autoNote = {
      id: uuidv4(),
      text: chunk.text,
      speaker: chunk.speaker,
      source: "transcription_auto",
      timestamp: chunk.timestamp
    };
    meeting.notes.push(autoNote);
    bump("notesCreated");
  }
  recordAudit("transcription.chunk", req, meeting.id, { speaker: chunk.speaker, autoNoteCaptured: Boolean(autoNote) });
  persistState();

  return res.status(201).json({ id: meeting.id, chunk, autoNoteCaptured: Boolean(autoNote), autoNote });
});

app.post("/api/meetings/:id/transcription/stop", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.transcription || !meeting.transcription.isActive) {
    return res.status(400).json({ message: "Transcription is not active" });
  }

  stopTranscriptionSession(meeting.transcription);
  if (transcriptionTimers.has(meeting.id)) {
    clearInterval(transcriptionTimers.get(meeting.id));
    transcriptionTimers.delete(meeting.id);
  }

  recordAudit("transcription.stop", req, meeting.id);
  persistState();

  return res.json({
    id: meeting.id,
    transcription: formatMeetingResponse(meeting).transcription
  });
});

app.post("/api/meetings/:id/transcription/simulate", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.transcription || !meeting.transcription.isActive) {
    return res.status(400).json({ message: "Transcription is not active" });
  }
  if (transcriptionTimers.has(meeting.id)) {
    return res.status(400).json({ message: "Simulation is already running for this meeting" });
  }

  const { preset, intervalMs } = req.body || {};
  const chunks = getPresetChunks(preset);
  let cursor = 0;
  const stepMs = Number(intervalMs || 1200);

  const timer = setInterval(() => {
    if (!meeting.transcription || !meeting.transcription.isActive) {
      clearInterval(timer);
      transcriptionTimers.delete(meeting.id);
      return;
    }

    const nextText = chunks[cursor];
    cursor += 1;

    const chunk = addTranscriptChunk(meeting.transcription, { text: nextText, source: "simulator" });
    bump("transcriptChunks");
    if (String(process.env.AUTO_NOTE_FROM_TRANSCRIPT || "true") === "true" && shouldCaptureAsNote(chunk)) {
      meeting.notes.push({
        id: uuidv4(),
        text: chunk.text,
        speaker: chunk.speaker,
        source: "transcription_auto",
        timestamp: chunk.timestamp
      });
      bump("notesCreated");
    }

    if (cursor >= chunks.length) {
      clearInterval(timer);
      transcriptionTimers.delete(meeting.id);
    }

    persistState();
  }, stepMs);

  transcriptionTimers.set(meeting.id, timer);
  recordAudit("transcription.simulate", req, meeting.id, { preset: preset || "daily-standup" });
  persistState();

  return res.status(202).json({
    id: meeting.id,
    started: true,
    preset: preset || "daily-standup",
    chunkCount: chunks.length,
    intervalMs: stepMs
  });
});

app.get("/api/meetings/:id/transcription", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.transcription) {
    return res.status(404).json({ message: "No transcription session for this meeting" });
  }

  return res.json({
    id: meeting.id,
    transcription: formatMeetingResponse(meeting).transcription,
    transcript: buildTranscriptText(meeting.transcription)
  });
});

app.get("/api/meetings/:id/transcription/export", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.transcription) {
    return res.status(404).json({ message: "No transcription session for this meeting" });
  }

  const format = String(req.query.format || "txt").toLowerCase();
  if (format === "json") {
    return res.json({
      id: meeting.id,
      transcription: formatMeetingResponse(meeting).transcription,
      chunks: meeting.transcription.chunks
    });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.send(buildTranscriptText(meeting.transcription));
});

app.get("/api/meetings/:id/attendance", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  return res.json({ id: meeting.id, attendance: getAttendanceSummary(meeting) });
});

app.post("/api/meetings/:id/share-mom", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.mom) {
    return res.status(400).json({ message: "End the meeting first to generate MoM" });
  }

  const share = ensureMomShare(meeting, req);
  recordAudit("mom.share.created", req, meeting.id, { shareId: share.id });
  persistState();

  return res.status(201).json({ id: meeting.id, share });
});

app.get("/api/meetings/:id/share-mom", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.momShare) {
    return res.status(404).json({ message: "Share link not generated yet" });
  }

  const share = ensureMomShare(meeting, req);
  return res.json({ id: meeting.id, share });
});

app.post("/api/hooks/meeting-context", (req, res) => {
  if (process.env.HOOK_API_KEY && req.headers["x-hook-key"] !== process.env.HOOK_API_KEY) {
    return res.status(401).json({ message: "Invalid hook key" });
  }

  const { meetingId, participants = [], note, notes = [], captions = [] } = req.body;
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  for (const participant of participants) {
    registerPresence(meeting, {
      name: participant.name,
      email: participant.email,
      action: participant.action || "join",
      source: participant.source || "browser_hook"
    });
  }

  const collectedNotes = [];
  if (note) {
    collectedNotes.push({ speaker: "BrowserHook", text: String(note) });
  }
  for (const item of notes) {
    if (item && String(item).trim()) {
      collectedNotes.push({ speaker: "BrowserHook", text: String(item).trim() });
    }
  }
  for (const caption of captions) {
    if (!caption || !caption.text) {
      continue;
    }
    collectedNotes.push({
      speaker: caption.speaker || "Participant",
      text: String(caption.text).trim()
    });
  }

  for (const entry of collectedNotes) {
    meeting.notes.push({
      id: uuidv4(),
      text: entry.text,
      speaker: entry.speaker || "BrowserHook",
      timestamp: new Date().toISOString()
    });
    bump("notesCreated");
  }

  recordAudit("hook.meeting_context", req, meeting.id, {
    participantsIngested: participants.length,
    notesIngested: collectedNotes.length
  });
  persistState();

  return res.json({
    id: meeting.id,
    participantsIngested: participants.length,
    notesIngested: collectedNotes.length,
    attendance: getAttendanceSummary(meeting)
  });
});

app.post("/api/meetings/:id/end", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  if (!meeting.isActive) {
    return res.status(400).json({ message: "Meeting already ended" });
  }

  meeting.isActive = false;
  meeting.endedAt = new Date().toISOString();
  if (meeting.transcription && meeting.transcription.isActive) {
    stopTranscriptionSession(meeting.transcription);
  }
  if (transcriptionTimers.has(meeting.id)) {
    clearInterval(transcriptionTimers.get(meeting.id));
    transcriptionTimers.delete(meeting.id);
  }
  meeting.insights = extractInsights(meeting.notes);
  meeting.mom = generateMom(meeting);

  bump("meetingEnded");
  recordAudit("meeting.end", req, meeting.id, { notes: meeting.notes.length });
  persistState();

  return res.json({
    id: meeting.id,
    endedAt: meeting.endedAt,
    insights: meeting.insights,
    attendance: getAttendanceSummary(meeting),
    mom: meeting.mom
  });
});

app.post("/api/meetings/:id/insights", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  meeting.insights = extractInsights(meeting.notes);
  if (!meeting.isActive) {
    meeting.mom = generateMom(meeting);
  }

  persistState();
  return res.json({
    id: meeting.id,
    insights: meeting.insights
  });
});

app.post("/api/meetings/:id/send-mom", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  if (!meeting.mom) {
    return res.status(400).json({ message: "End the meeting first to generate MoM" });
  }

  const { fromEmail } = req.body || {};
  if (!fromEmail) {
    return res.status(400).json({ message: "fromEmail is required" });
  }

  const share = ensureMomShare(meeting, req);
  const emailText = `${meeting.mom}\n\nShared MoM Link: ${share.url}`;

  const job = createEmailJob({
    meetingId: meeting.id,
    fromEmail,
    to: meeting.attendees,
    subject: `Minutes of Meeting: ${meeting.title}`,
    text: emailText,
    maxRetries: Number(process.env.EMAIL_JOB_MAX_RETRIES || 3)
  });

  store.jobs.push(job);
  bump("momsQueued");
  recordAudit("mom.email.queued", req, meeting.id, { jobId: job.id, recipients: meeting.attendees.length });
  persistState();

  return res.status(202).json({ message: "MoM queued for sending", jobId: job.id });
});

app.get("/api/jobs", requireAdmin, (req, res) => {
  const recent = store.jobs.slice(-100).reverse();
  res.json({ jobs: recent });
});

app.get("/api/jobs/:id", requireAdmin, (req, res) => {
  const job = store.jobs.find((j) => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  return res.json({ job });
});

app.get("/api/admin/analytics", requireAdmin, (req, res) => {
  res.json({ analytics: store.analytics, meetingCount: meetings.size, queuedJobs: store.jobs.filter((j) => j.status === "queued").length });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 100));
  const logs = store.auditLogs.slice(-limit).reverse();
  res.json({ logs });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = store.users.map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  }));
  res.json({ users });
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (store.users.some((u) => u.email === normalizedEmail)) {
    return res.status(409).json({ message: "User already exists" });
  }

  const user = createUser(normalizedEmail, password, role || "member");
  store.users.push(user);
  recordAudit("admin.user.created", req, null, { email: user.email, role: user.role });
  persistState();

  return res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }
  });
});

app.get("/api/meetings/:id", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  return res.json(formatMeetingResponse(meeting));
});

app.get("/share/mom/:shareId", (req, res) => {
  const meeting = getMeetingByShareId(req.params.shareId);
  if (!meeting || !meeting.mom) {
    return res.status(404).send("MoM share link not found.");
  }

  const safeTitle = String(meeting.title || "Meeting").replace(/[<>&]/g, "");
  const safeMom = String(meeting.mom).replace(/[<>&]/g, "");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MoM Share - ${safeTitle}</title>
  <style>
    body { margin: 0; font-family: Segoe UI, sans-serif; background: #f6f7fb; color: #1d2630; }
    .wrap { max-width: 920px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border: 1px solid #dde3ed; border-radius: 12px; padding: 20px; }
    h1 { margin-top: 0; font-size: 22px; }
    pre { white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
    .meta { color: #5a6a7f; font-size: 13px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${safeTitle}</h1>
      <div class="meta">Read-only shared Minutes of Meeting</div>
      <pre>${safeMom}</pre>
    </div>
  </div>
</body>
</html>`;

  return res.setHeader("Content-Type", "text/html; charset=utf-8").send(html);
});

function bootstrapAdminUser() {
  if (store.users.length > 0) {
    return;
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@mom.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin12345";
  const user = createUser(adminEmail, adminPassword, "admin");
  store.users.push(user);
  recordAudit("auth.bootstrap_admin", null, null, { email: adminEmail });
}

let queueWorkerBusy = false;

async function processEmailJob(job) {
  const transporter = buildTransporter();
  if (!transporter) {
    markJobSuccess(job);
    return { previewOnly: true };
  }

  const info = await transporter.sendMail({
    from: job.payload.fromEmail,
    to: job.payload.to.join(","),
    subject: job.payload.subject,
    text: job.payload.text
  });

  markJobSuccess(job);
  return { previewOnly: false, messageId: info.messageId };
}

async function runQueueWorkerOnce() {
  if (queueWorkerBusy) {
    return;
  }

  const nextJob = getNextRunnableJob(store.jobs);
  if (!nextJob) {
    return;
  }

  queueWorkerBusy = true;
  markJobProcessing(nextJob);
  persistState();

  try {
    const result = await processEmailJob(nextJob);
    bump("momsSent");
    recordAudit("job.succeeded", null, nextJob.payload.meetingId, { jobId: nextJob.id, ...result });
  } catch (err) {
    if (nextJob.attempts >= nextJob.maxRetries) {
      markJobFailed(nextJob, err.message);
      recordAudit("job.failed", null, nextJob.payload.meetingId, { jobId: nextJob.id, error: err.message });
    } else {
      markJobRetry(nextJob, err.message);
      recordAudit("job.retry", null, nextJob.payload.meetingId, {
        jobId: nextJob.id,
        error: err.message,
        attempts: nextJob.attempts
      });
    }
  } finally {
    queueWorkerBusy = false;
    persistState();
  }
}

loadState();
bootstrapAdminUser();
persistState();
setInterval(runQueueWorkerOnce, Number(process.env.JOB_WORKER_INTERVAL_MS || 2000));

app.listen(port, () => {
  console.log(`MOM app running at http://localhost:${port}`);
  console.log(`Auth required: ${authRequired}`);
});
