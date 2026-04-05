/**
 * MOM AI — Offscreen Audio Recorder
 *
 * Lives in the offscreen document. Receives a tab stream ID from the background
 * service worker, records in 20-second chunks, and POSTs each chunk to the backend
 * for Whisper/Gemini transcription.
 */

let mediaRecorder = null;
let recordingStream = null;
let meetingId = "";
let backend = "http://localhost:4000";
let authToken = "";
let chunkInterval = null;

async function startRecording({ streamId, meetingId: mid, backend: be, token }) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    console.log("[MOM offscreen] Already recording.");
    return;
  }

  meetingId = mid;
  backend = be;
  authToken = token;

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      }
    });

    // Prefer audio/webm;codecs=opus, fall back to whatever is supported
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(recordingStream, options);

    const chunks = [];

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      chunks.length = 0;
      await uploadChunk(blob);
    };

    // Collect 20-second chunks
    chunkInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        mediaRecorder.start();
      }
    }, 20000);

    mediaRecorder.start();
    console.log(`[MOM offscreen] Recording started for meeting ${meetingId}`);
  } catch (err) {
    console.error("[MOM offscreen] Failed to start recording:", err.message);
  }
}

function stopRecording() {
  if (chunkInterval) {
    clearInterval(chunkInterval);
    chunkInterval = null;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach(t => t.stop());
    recordingStream = null;
  }
  mediaRecorder = null;
  console.log("[MOM offscreen] Recording stopped.");
}

async function uploadChunk(blob) {
  if (!meetingId || !backend) return;

  try {
    const url = `${backend}/api/meetings/${meetingId}/audio-chunk`;
    const headers = { "Content-Type": blob.type || "audio/webm" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(url, { method: "POST", headers, body: blob });
    const data = await res.json().catch(() => ({}));
    console.log(`[MOM offscreen] Uploaded chunk — notesAdded: ${data.notesAdded ?? "?"}`);
  } catch (err) {
    console.error("[MOM offscreen] Chunk upload failed:", err.message);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === "mom:startAudioRecording") {
    startRecording(msg.payload || {});
  } else if (msg.type === "mom:stopAudioRecording") {
    stopRecording();
  }
});
