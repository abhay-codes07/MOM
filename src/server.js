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

function generateMom(meeting) {
  const noteLines = meeting.notes
    .map((n, i) => `${i + 1}. [${n.timestamp}] ${n.speaker || "Participant"}: ${n.text}`)
    .join("\n");

  return `Minutes of Meeting\n\nTitle: ${meeting.title}\nMeeting ID: ${meeting.id}\nStart: ${meeting.startedAt}\nEnd: ${meeting.endedAt}\nAttendees: ${meeting.attendees.join(", ")}\n\nDiscussion Notes:\n${noteLines || "No notes captured."}\n\nAction Items:\n- Add AI summarization and action item extraction in Phase 2.`;
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
  meeting.mom = generateMom(meeting);

  res.json({
    id: meeting.id,
    endedAt: meeting.endedAt,
    mom: meeting.mom
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
