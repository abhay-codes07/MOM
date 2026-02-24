const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const meetings = new Map();

function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").trim();
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

function generateMom(meeting) {
  const insights = meeting.insights || extractInsights(meeting.notes);
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

  return `Minutes of Meeting

Title: ${meeting.title}
Meeting ID: ${meeting.id}
Start: ${meeting.startedAt}
End: ${meeting.endedAt}
Attendees: ${meeting.attendees.join(", ")}

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

app.post("/api/meetings/start", (req, res) => {
  const { title, attendees } = req.body;

  if (!title || !Array.isArray(attendees) || attendees.length === 0) {
    return res.status(400).json({ message: "title and attendees[] are required" });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const meeting = {
    id,
    title,
    attendees,
    startedAt: now,
    endedAt: null,
    isActive: true,
    notes: [],
    insights: null,
    mom: null
  };

  meetings.set(id, meeting);
  res.status(201).json(meeting);
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
  res.status(201).json(entry);
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

  res.json({
    id: meeting.id,
    endedAt: meeting.endedAt,
    insights: meeting.insights,
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

  res.json({
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

    res.json({ message: "MoM sent", messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ message: "Failed to send email", error: err.message });
  }
});

app.get("/api/meetings/:id", (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ message: "Meeting not found" });
  }
  res.json(meeting);
});

app.listen(port, () => {
  console.log(`MOM app running at http://localhost:${port}`);
});
