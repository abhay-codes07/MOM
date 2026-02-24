const { v4: uuidv4 } = require("uuid");

function createTranscriptionSession(options = {}) {
  return {
    id: uuidv4(),
    language: options.language || "en-US",
    provider: options.provider || "mock-realtime",
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    isActive: true,
    chunks: []
  };
}

function splitSpeakerAndText(rawText = "", fallbackSpeaker = "Participant") {
  const text = String(rawText || "").trim();
  const match = text.match(/^([^:]{1,40}):\s*(.+)$/);
  if (!match) {
    return { speaker: fallbackSpeaker, text };
  }

  return {
    speaker: match[1].trim() || fallbackSpeaker,
    text: match[2].trim()
  };
}

function addTranscriptChunk(session, payload = {}) {
  const parsed = splitSpeakerAndText(payload.text || "", payload.speaker || "Participant");
  const chunk = {
    id: uuidv4(),
    speaker: parsed.speaker,
    text: parsed.text,
    confidence: typeof payload.confidence === "number" ? payload.confidence : 0.9,
    source: payload.source || "mic",
    timestamp: new Date().toISOString()
  };

  session.chunks.push(chunk);
  return chunk;
}

function stopTranscriptionSession(session) {
  session.isActive = false;
  session.stoppedAt = new Date().toISOString();
  return session;
}

function buildTranscriptText(session) {
  if (!session || session.chunks.length === 0) {
    return "No transcript chunks captured.";
  }

  return session.chunks
    .map((chunk, index) => `${index + 1}. [${chunk.timestamp}] ${chunk.speaker}: ${chunk.text}`)
    .join("\n");
}

function shouldCaptureAsNote(chunk) {
  if (!chunk || !chunk.text) {
    return false;
  }

  const text = chunk.text.toLowerCase();
  if (text.length < 18) {
    return false;
  }

  return /(agenda|decision|decide|action|todo|next step|deadline|follow up|owner)/i.test(text);
}

module.exports = {
  createTranscriptionSession,
  addTranscriptChunk,
  stopTranscriptionSession,
  buildTranscriptText,
  shouldCaptureAsNote
};
