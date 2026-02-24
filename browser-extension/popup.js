const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = typeof message === "string" ? message : JSON.stringify(message, null, 2);
}

function parseParticipants(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split(",").map((x) => x.trim());
      return { name, email, action: "join", source: "browser_extension" };
    });
}

document.getElementById("sendBtn").addEventListener("click", async () => {
  try {
    const backend = document.getElementById("backend").value.trim() || "http://localhost:4000";
    const meetingId = document.getElementById("meetingId").value.trim();
    const participants = parseParticipants(document.getElementById("participants").value);
    const note = document.getElementById("note").value.trim();
    const hookKey = document.getElementById("hookKey").value.trim();

    if (!meetingId) {
      throw new Error("Meeting ID is required.");
    }

    const headers = {
      "Content-Type": "application/json"
    };
    if (hookKey) {
      headers["x-hook-key"] = hookKey;
    }

    const response = await fetch(`${backend}/api/hooks/meeting-context`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        meetingId,
        participants,
        note
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Hook failed");
    }

    setStatus(data);
  } catch (error) {
    setStatus(error.message);
  }
});
