const llm = require("./llm");

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseOwner(text, fallbackOwner = "Participant") {
  const ownerMatch = text.match(/\b([A-Z][a-z]+)\s+(will|to)\b/);
  if (ownerMatch) return ownerMatch[1];
  const ownerByPattern = text.match(/\bowner[:\s-]+([A-Za-z ]{2,40})/i);
  if (ownerByPattern) return ownerByPattern[1].trim();
  return fallbackOwner;
}

function parseDueDate(text) {
  const lower = text.toLowerCase();
  const dateKeywords = [
    "today", "tomorrow", "tonight", "eod", "this week", "next week",
    "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday"
  ];
  for (const key of dateKeywords) {
    if (lower.includes(key)) return key;
  }
  const explicit = text.match(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/);
  if (explicit) return explicit[0];
  return null;
}

function parseActionItemFromText(text, fallbackOwner = "Participant") {
  const cleaned = normalize(text);
  return {
    owner: parseOwner(cleaned, fallbackOwner),
    item: cleaned.replace(/^(action|todo)[:\s-]*/i, ""),
    due: parseDueDate(cleaned),
    status: "open"
  };
}

// ─── Rule-based fallbacks ────────────────────────────────────────────────────

function _riskRadarRuleBased(notes) {
  const riskTerms = [
    { term: "blocked", weight: 3 }, { term: "delay", weight: 3 },
    { term: "risk", weight: 2 }, { term: "urgent", weight: 2 },
    { term: "issue", weight: 2 }, { term: "escalate", weight: 3 },
    { term: "problem", weight: 2 }, { term: "stuck", weight: 2 },
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
        hits.push({ term: token.term, weight: token.weight, note: normalize(note.text || ""), speaker: note.speaker || "Participant" });
      }
    }
  }
  const severity = score >= 10 ? "high" : score >= 5 ? "medium" : "low";
  return { score, severity, hits: hits.slice(0, 25) };
}

function _conflictMapRuleBased(notes) {
  function extractKeywords(text) {
    return normalize(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 5).slice(0, 10);
  }
  function detectPolarity(text) {
    const t = normalize(text).toLowerCase();
    const positive = ["approve", "agreed", "go with", "enable", "increase", "adopt", "accept", "proceed"];
    const negative = ["reject", "decline", "drop", "disable", "decrease", "avoid", "rollback", "block"];
    let p = 0, n = 0;
    for (const tok of positive) if (t.includes(tok)) p++;
    for (const tok of negative) if (t.includes(tok)) n++;
    if (p === n) return 0;
    return p > n ? 1 : -1;
  }

  const keywordStances = new Map();
  for (const note of notes) {
    const text = normalize(note.text || "");
    if (!text) continue;
    const polarity = detectPolarity(text);
    if (polarity === 0) continue;
    for (const keyword of extractKeywords(text)) {
      const arr = keywordStances.get(keyword) || [];
      arr.push({ polarity, speaker: note.speaker || "Participant", text });
      keywordStances.set(keyword, arr);
    }
  }
  const conflicts = [];
  for (const [keyword, entries] of keywordStances.entries()) {
    if (!entries.some(e => e.polarity === 1) || !entries.some(e => e.polarity === -1)) continue;
    conflicts.push({
      topic: keyword,
      positive: entries.filter(e => e.polarity === 1).slice(0, 3),
      negative: entries.filter(e => e.polarity === -1).slice(0, 3)
    });
  }
  const severity = conflicts.length >= 4 ? "high" : conflicts.length >= 2 ? "medium" : conflicts.length >= 1 ? "low" : "none";
  return {
    severity, conflictCount: conflicts.length,
    confidence: Number(Math.min(0.95, 0.35 + conflicts.length * 0.12).toFixed(2)),
    conflicts: conflicts.slice(0, 12)
  };
}

function _followupDraftsRuleBased(meeting, insights) {
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
        ...decisions.slice(0, 3).map(d => `- ${d}`),
        "",
        `Action items (${actions.length}):`,
        ...actions.slice(0, 4).map(a => `- ${a.item} (Owner: ${a.owner}${a.due ? `, Due: ${a.due}` : ""})`),
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

// ─── AI-powered functions ────────────────────────────────────────────────────

async function buildRiskRadar(notes) {
  if (!llm.isConfigured() || notes.length === 0) {
    return _riskRadarRuleBased(notes);
  }

  const notesText = notes
    .map(n => `${n.speaker || "Participant"}: ${normalize(n.text || "")}`)
    .join("\n");

  const raw = await llm.complete(
    `You are a meeting risk analyst. Identify all risks, blockers, delays, escalations, and urgent issues mentioned.
Always respond with valid JSON only — no markdown, no explanation.`,
    `Meeting notes:\n${notesText}\n\nReturn JSON:
{
  "score": <number 0-100 reflecting overall risk level>,
  "severity": "<low|medium|high>",
  "hits": [{ "term": "<risk keyword>", "note": "<exact note text>", "speaker": "<speaker name>", "reason": "<why it's a risk>" }]
}`
  );

  const parsed = llm.parseJSON(raw);
  if (parsed && typeof parsed.score === "number" && Array.isArray(parsed.hits)) {
    return parsed;
  }
  return _riskRadarRuleBased(notes);
}

async function buildConflictMap(notes) {
  if (!llm.isConfigured() || notes.length === 0) {
    return _conflictMapRuleBased(notes);
  }

  const notesText = notes
    .map(n => `${n.speaker || "Participant"}: ${normalize(n.text || "")}`)
    .join("\n");

  const raw = await llm.complete(
    `You are a conflict analyst for meetings. Find opposing viewpoints, disagreements, and contradictory statements.
Always respond with valid JSON only — no markdown, no explanation.`,
    `Meeting notes:\n${notesText}\n\nReturn JSON:
{
  "severity": "<none|low|medium|high>",
  "conflictCount": <number>,
  "confidence": <0.0-1.0>,
  "conflicts": [{
    "topic": "<topic of disagreement>",
    "positive": [{ "speaker": "<name>", "text": "<statement>" }],
    "negative": [{ "speaker": "<name>", "text": "<statement>" }]
  }]
}`
  );

  const parsed = llm.parseJSON(raw);
  if (parsed && typeof parsed.conflictCount === "number" && Array.isArray(parsed.conflicts)) {
    return parsed;
  }
  return _conflictMapRuleBased(notes);
}

async function buildFollowupDrafts(meeting, insights) {
  if (!llm.isConfigured() || (meeting.attendees || []).length === 0) {
    return _followupDraftsRuleBased(meeting, insights);
  }

  const decisions = (insights.decisions || []).slice(0, 5).join("\n");
  const actions = (insights.actionItems || []).slice(0, 8)
    .map(a => `- ${a.item} (Owner: ${a.owner}${a.due ? `, Due: ${a.due}` : ""})`)
    .join("\n");
  const summary = (insights.summary || []).slice(0, 3).join(" ");

  const raw = await llm.complete(
    `You are an executive assistant drafting post-meeting follow-up emails. Be professional, concise, and actionable.
Personalize each email to highlight that attendee's specific action items.
Always respond with valid JSON only — no markdown, no explanation.`,
    `Meeting: "${meeting.title}"
Date: ${meeting.endedAt || meeting.startedAt}
Attendees: ${meeting.attendees.join(", ")}
Summary: ${summary}
Decisions:
${decisions || "None recorded."}
Action Items:
${actions || "None recorded."}

Return a JSON array — one email per attendee:
[{ "to": "<email>", "subject": "<subject>", "body": "<full email body>" }]`
  );

  const parsed = llm.parseJSON(raw);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].to) {
    return parsed;
  }
  return _followupDraftsRuleBased(meeting, insights);
}

module.exports = {
  parseActionItemFromText,
  buildRiskRadar,
  buildConflictMap,
  buildFollowupDrafts
};
