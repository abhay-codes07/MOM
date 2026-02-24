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
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const meetings = new Map();
const transcriptionTimers = new Map();

function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAttendees(attendees) {
  return attendees.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
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

function formatMeetingResponse(meeting) {
  return {
    ...meeting,
    attendanceMap: Array.from(meeting.attendanceMap.values()),
    discoveredAttendees: Array.from(meeting.discoveredAttendees.values()),
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
  const discoveredBlock = attendance.discoveredParticipants.length
    ? attendance.discoveredParticipants.map((email) => `- ${email}`).join("\n")
    : "- No extra participants discovered.";

  return `Minutes of Meeting

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

Auto-Discovered Participants:
${discoveredBlock}

Discussion Notes:
${noteLines || "No notes captured."}`;
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
  }

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
    if (String(process.env.AUTO_NOTE_FROM_TRANSCRIPT || "true") === "true" && shouldCaptureAsNote(chunk)) {
      meeting.notes.push({
        id: uuidv4(),
        text: chunk.text,
        speaker: chunk.speaker,
        source: "transcription_auto",
        timestamp: chunk.timestamp
      });
    }

    if (cursor >= chunks.length) {
      clearInterval(timer);
      transcriptionTimers.delete(meeting.id);
    }
  }, stepMs);

  transcriptionTimers.set(meeting.id, timer);
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

app.post("/api/hooks/meeting-context", (req, res) => {
  if (process.env.HOOK_API_KEY && req.headers["x-hook-key"] !== process.env.HOOK_API_KEY) {
    return res.status(401).json({ message: "Invalid hook key" });
  }

  const { meetingId, participants = [], note } = req.body;
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

  if (note) {
    meeting.notes.push({
      id: uuidv4(),
      text: String(note),
      speaker: "BrowserHook",
      timestamp: new Date().toISOString()
    });
  }

  return res.json({
    id: meeting.id,
    participantsIngested: participants.length,
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
  meeting.insights = extractInsights(meeting.notes);
  meeting.mom = generateMom(meeting);

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

  return res.json({
    id: meeting.id,
    insights: meeting.insights
  });
});

app.post("/api/meetings/:id/send-mom", async (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  if (!meeting.mom) {
    return res.status(400).json({ message: "End the meeting first to generate MoM" });
  }

  const { fromEmail } = req.body;
  if (!fromEmail) {
    return res.status(400).json({ message: "fromEmail is required" });
  }

  const transporter = buildTransporter();

  if (!transporter) {
    return res.status(200).json({
      message: "SMTP not configured. MoM generated and ready; email sending skipped.",
      preview: {
        from: fromEmail,
        to: meeting.attendees,
        subject: `MoM: ${meeting.title}`
      }
    });
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: meeting.attendees.join(","),
      subject: `Minutes of Meeting: ${meeting.title}`,
      text: meeting.mom
    });

    return res.json({ message: "MoM sent", messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ message: "Failed to send email", error: err.message });
  }
});

app.get("/api/meetings/:id", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }

  return res.json(formatMeetingResponse(meeting));
});

app.listen(port, () => {
  console.log(`MOM app running at http://localhost:${port}`);
});
