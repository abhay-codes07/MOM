const llm = require("./llm");

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "is", "are", "was", "were", "be", "been",
  "with", "by", "as", "it", "that", "this", "we", "you", "i", "they", "he", "she", "them", "our", "your", "from",
  "will", "would", "should", "could", "can", "do", "did", "does", "done", "not", "but", "if", "then", "so"
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function getTopKeywords(notes, limit = 20) {
  const scores = new Map();
  for (const note of notes) {
    const words = String(note.text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const word of words) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      scores.set(word, (scores.get(word) || 0) + 1);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function computeMeetingScore(meeting, insights, mood) {
  const noteCount = meeting.notes.length;
  const speakerCount = insights.speakerStats.length;
  const decisionCount = insights.decisions.length;
  const actionCount = insights.actionItems.length;

  const engagement = clamp((speakerCount / 5) * 100, 0, 100);
  const actionability = clamp((actionCount / Math.max(1, noteCount / 4)) * 100, 0, 100);
  const decisiveness = clamp((decisionCount / Math.max(1, noteCount / 5)) * 100, 0, 100);
  const coverage = clamp((noteCount / 20) * 100, 0, 100);

  const moodWeight = mood.label === "Positive" ? 1 : mood.label === "Concerned" ? 0.7 : 0.85;
  const raw = (engagement * 0.28 + actionability * 0.28 + decisiveness * 0.24 + coverage * 0.2) * moodWeight;
  const score = clamp(raw, 0, 100);

  let band = "Needs Work";
  if (score >= 75) band = "High Performance";
  else if (score >= 55) band = "Healthy";

  return {
    score: round(score),
    band,
    factors: {
      engagement: round(engagement),
      actionability: round(actionability),
      decisiveness: round(decisiveness),
      coverage: round(coverage)
    }
  };
}

function _nextAgendaRuleBased(meeting, insights, keywordLimit = 6) {
  const unresolved = insights.actionItems
    .filter(item => item.status !== "done")
    .map(item => `Action Follow-up: ${item.item} (Owner: ${item.owner})`);

  const keywords = getTopKeywords(meeting.notes, keywordLimit).map(k => `Discuss "${k.word}" continuity`);
  const decisions = insights.decisions.slice(0, 4).map(d => `Revisit decision impact: ${d}`);

  const agenda = [];
  const pushMany = items => {
    for (const item of items) {
      if (agenda.length >= 10) break;
      if (!agenda.includes(item)) agenda.push(item);
    }
  };
  pushMany(unresolved);
  pushMany(decisions);
  pushMany(keywords);

  if (agenda.length === 0) {
    agenda.push("Review key outcomes from previous meeting and define next action owners.");
  }
  return agenda;
}

async function buildNextAgenda(meeting, insights, keywordLimit = 6) {
  if (!llm.isConfigured()) {
    return _nextAgendaRuleBased(meeting, insights, keywordLimit);
  }

  const unresolved = insights.actionItems
    .filter(i => i.status !== "done")
    .map(i => `- ${i.item} (Owner: ${i.owner})`)
    .join("\n") || "None";

  const decisions = (insights.decisions || []).slice(0, 5).join("\n") || "None";
  const keywords = getTopKeywords(meeting.notes, keywordLimit).map(k => k.word).join(", ") || "None";

  const raw = await llm.complete(
    `You are a meeting facilitator planning the agenda for the next meeting.
Always respond with a JSON array of strings only — no markdown, no explanation.`,
    `Previous meeting: "${meeting.title}"
Unresolved action items:
${unresolved}
Key decisions made:
${decisions}
Top discussion topics: ${keywords}

Generate 5-8 focused, specific agenda items for the next meeting.
Return a JSON array of strings: ["item 1", "item 2", ...]`
  );

  const parsed = llm.parseJSON(raw);
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
    return parsed;
  }
  return _nextAgendaRuleBased(meeting, insights, keywordLimit);
}

module.exports = { getTopKeywords, computeMeetingScore, buildNextAgenda };
