/**
 * Unified LLM client — supports Groq (default) and Google Gemini.
 * All functions return null when no API key is configured so callers can fall back
 * to rule-based logic without crashing.
 *
 * Set AI_PROVIDER=groq (default) or AI_PROVIDER=gemini in .env
 * Groq:   set GROQ_API_KEY
 * Gemini: set GEMINI_API_KEY
 */

let Groq = null;
let GoogleGenerativeAI = null;

try { Groq = require("groq-sdk"); } catch (_) { /* not installed */ }
try { ({ GoogleGenerativeAI } = require("@google/generative-ai")); } catch (_) { /* not installed */ }

const provider = (process.env.AI_PROVIDER || "groq").toLowerCase();

let _groq = null;
let _gemini = null;

function getGroq() {
  if (_groq) return _groq;
  if (!Groq || !process.env.GROQ_API_KEY) return null;
  _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

function getGemini() {
  if (_gemini) return _gemini;
  if (!GoogleGenerativeAI || !process.env.GEMINI_API_KEY) return null;
  _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _gemini;
}

function isConfigured() {
  return !!(
    (provider === "gemini" ? getGemini() : getGroq()) ||
    getGroq() ||
    getGemini()
  );
}

function activeProvider() {
  if (provider === "gemini" && getGemini()) return "gemini";
  if (getGroq()) return "groq";
  if (getGemini()) return "gemini";
  return null;
}

/**
 * Text completion. Returns the model's response string, or null on failure.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string|null>}
 */
async function complete(systemPrompt, userPrompt) {
  const ap = activeProvider();
  if (!ap) return null;

  try {
    if (ap === "gemini") {
      const genai = getGemini();
      const model = genai.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
        systemInstruction: systemPrompt
      });
      const result = await model.generateContent(userPrompt);
      return result.response.text().trim();
    }

    // Groq
    const groq = getGroq();
    const response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 2048
    });
    return (response.choices[0]?.message?.content || "").trim();
  } catch (err) {
    console.error(`[llm] complete failed (${ap}):`, err.message);
    return null;
  }
}

/**
 * Parse JSON from an LLM response, stripping markdown fences if present.
 * Returns null if parsing fails.
 * @param {string|null} text
 */
function parseJSON(text) {
  if (!text) return null;
  // Strip ```json ... ``` or ``` ... ```
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {
    // Try extracting first {...} or [...]
    const obj = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (obj) {
      try { return JSON.parse(obj[1]); } catch (_) { return null; }
    }
    return null;
  }
}

/**
 * Transcribe audio buffer using Groq Whisper or Gemini.
 * Returns transcript string or null on failure/unconfigured.
 * @param {Buffer} audioBuffer
 * @param {string} mimeType  e.g. "audio/webm"
 * @returns {Promise<string|null>}
 */
async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  const ap = activeProvider();
  if (!ap) return null;

  try {
    if (ap === "gemini") {
      const genai = getGemini();
      const model = genai.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.0-flash"
      });
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: audioBuffer.toString("base64")
          }
        },
        "Transcribe this meeting audio. Use 'Speaker N: text' format for each speaker turn. Output only the transcript, no commentary."
      ]);
      return result.response.text().trim();
    }

    // Groq Whisper — Node.js 20+ has File as a global
    const groq = getGroq();
    const audioFile = new File([audioBuffer], "recording.webm", { type: mimeType });
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo",
      response_format: "text",
      language: "en"
    });
    return typeof transcription === "string" ? transcription.trim() : "";
  } catch (err) {
    console.error(`[llm] transcribeAudio failed (${ap}):`, err.message);
    return null;
  }
}

module.exports = { complete, transcribeAudio, parseJSON, isConfigured, activeProvider };
