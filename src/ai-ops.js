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

module.exports = {
  parseActionItemFromText,
  buildRiskRadar,
  buildFollowupDrafts
};
