const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "mom-db.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      meetings: [],
      users: [],
      jobs: [],
      auditLogs: [],
      analytics: {
        meetingCreated: 0,
        meetingEnded: 0,
        notesCreated: 0,
        transcriptChunks: 0,
        momsQueued: 0,
        momsSent: 0,
        authLogins: 0
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readDb() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  ensureDataFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  readDb,
  writeDb
};
