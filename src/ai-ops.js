function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseOwner(text, fallbackOwner = "Participant") {
  const ownerMatch = text.match(/\b([A-Z][a-z]+)\s+(will|to)\b/);
  if (ownerMatch) {
    return ownerMatch[1];
  }

  const ownerByPattern = text.match(/\bowner[:\s-]+([A-Za-z ]{2,40})/i);
  if (ownerByPattern) {
    return ownerByPattern[1].trim();
  }

  return fallbackOwner;
}

function parseDueDate(text) {
  const lower = text.toLowerCase();
  const dateKeywords = [
    "today", "tomorrow", "tonight", "eod", "this week", "next week", "friday", "monday", "tuesday", "wednesday",
    "thursday", "saturday", "sunday"
  ];
  for (const key of dateKeywords) {
    if (lower.includes(key)) {
      return key;
    }
  }
  const explicit = text.match(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/);
  if (explicit) {
    return explicit[0];
  }
  return null;
}

function parseActionItemFromText(text, fallbackOwner = "Participant") {
  const cleaned = normalize(text);
  const owner = parseOwner(cleaned, fallbackOwner);
  const due = parseDueDate(cleaned);
  return {
    owner,
    item: cleaned.replace(/^(action|todo)[:\s-]*/i, ""),
    due,
    status: "open"
  };
}

function buildRiskRadar(notes) {
  const riskTerms = [
    { term: "blocked", weight: 3 },
    { term: "delay", weight: 3 },
    { term: "risk", weight: 2 },
    { term: "urgent", weight: 2 },
    { term: "issue", weight: 2 },
    { term: "escalate", weight: 3 },
    { term: "problem", weight: 2 },
    { term: "stuck", weight: 2 },
    { term: "fail", weight: 3 }
  ];

  const hits = [];
  let score = 0;

  for (const note of notes) {
    const text = normalize(note.text || "").toLowerCase();
    if (!text) continue;

    for (const token of riskTerms) {
      if (text.includes(token.term)) {
        score += token.weight;
        hits.push({
          term: token.term,
          weight: token.weight,
          note: normalize(note.text || ""),
          speaker: note.speaker || "Participant"
        });
      }
    }
  }

  let severity = "low";
  if (score >= 10) severity = "high";
  else if (score >= 5) severity = "medium";

  return {
    score,
    severity,
    hits: hits.slice(0, 25)
  };
}

function buildFollowupDrafts(meeting, insights) {
  const drafts = [];
  const decisions = insights.decisions || [];
  const actions = insights.actionItems || [];

  const summaryLine = insights.summary?.[0] || "Discussion summary unavailable.";
  for (const attendee of meeting.attendees || []) {
    drafts.push({
      to: attendee,
      subject: `Follow-up: ${meeting.title}`,
      body: [
        `Hi ${attendee.split("@")[0]},`,
        "",
        `Quick follow-up from "${meeting.title}".`,
        `Top summary: ${summaryLine}`,
        "",
        `Decisions (${decisions.length}):`,
        ...decisions.slice(0, 3).map((d) => `- ${d}`),
        "",
        `Action items (${actions.length}):`,
        ...actions.slice(0, 4).map((a) => `- ${a.item} (Owner: ${a.owner}${a.due ? `, Due: ${a.due}` : ""})`),
        "",
        "Please reply with status updates before next sync.",
        "",
        "Regards,",
        "MOM AI"
      ].join("\n")
    });
  }

  return drafts;
}

function extractKeywords(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5)
    .slice(0, 10);
}

function detectPolarity(text) {
  const t = normalize(text).toLowerCase();
  const positive = ["approve", "agreed", "go with", "enable", "increase", "adopt", "accept", "proceed"];
  const negative = ["reject", "decline", "drop", "disable", "decrease", "avoid", "rollback", "block"];

  let p = 0;
  let n = 0;
  for (const token of positive) {
    if (t.includes(token)) p += 1;
  }
  for (const token of negative) {
    if (t.includes(token)) n += 1;
  }
  if (p === n) return 0;
  return p > n ? 1 : -1;
}

function buildConflictMap(notes) {
  const keywordStances = new Map();

  for (const note of notes) {
    const text = normalize(note.text || "");
    if (!text) continue;
    const polarity = detectPolarity(text);
    if (polarity === 0) continue;

    const keywords = extractKeywords(text);
    for (const keyword of keywords) {
      const arr = keywordStances.get(keyword) || [];
      arr.push({
        polarity,
        speaker: note.speaker || "Participant",
        text
      });
      keywordStances.set(keyword, arr);
    }
  }

  const conflicts = [];
  for (const [keyword, entries] of keywordStances.entries()) {
    const hasPositive = entries.some((e) => e.polarity === 1);
    const hasNegative = entries.some((e) => e.polarity === -1);
    if (!hasPositive || !hasNegative) continue;

    conflicts.push({
      topic: keyword,
      positive: entries.filter((e) => e.polarity === 1).slice(0, 3),
      negative: entries.filter((e) => e.polarity === -1).slice(0, 3)
    });
  }

  const severity = conflicts.length >= 4 ? "high" : conflicts.length >= 2 ? "medium" : conflicts.length >= 1 ? "low" : "none";
  const confidence = Math.min(0.95, 0.35 + conflicts.length * 0.12);

  return {
    severity,
    conflictCount: conflicts.length,
    confidence: Number(confidence.toFixed(2)),
    conflicts: conflicts.slice(0, 12)
  };
}

module.exports = {
  parseActionItemFromText,
  buildRiskRadar,
  buildFollowupDrafts,
  buildConflictMap
};
