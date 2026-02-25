const { v4: uuidv4 } = require("uuid");

function createVersionSnapshot(momText, reason = "update") {
  return {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    reason,
    text: String(momText || "")
  };
}

function appendMomVersion(meeting, momText, reason = "update") {
  if (!meeting.momVersions) {
    meeting.momVersions = [];
  }

  const latest = meeting.momVersions[meeting.momVersions.length - 1];
  if (latest && latest.text === momText) {
    return latest;
  }

  const snapshot = createVersionSnapshot(momText, reason);
  meeting.momVersions.push(snapshot);
  if (meeting.momVersions.length > 50) {
    meeting.momVersions = meeting.momVersions.slice(-50);
  }
  return snapshot;
}

function diffMomText(oldText, newText) {
  const oldLines = String(oldText || "").split("\n");
  const newLines = String(newText || "").split("\n");

  const removed = oldLines.filter((line) => !newLines.includes(line)).slice(0, 30);
  const added = newLines.filter((line) => !oldLines.includes(line)).slice(0, 30);

  return {
    added,
    removed
  };
}

module.exports = {
  appendMomVersion,
  diffMomText
};
