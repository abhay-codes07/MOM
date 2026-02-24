const { v4: uuidv4 } = require("uuid");

function createAuditEvent({ actor = "system", action, meetingId = null, details = {} }) {
  return {
    id: uuidv4(),
    actor,
    action,
    meetingId,
    details,
    timestamp: new Date().toISOString()
  };
}

function appendAudit(store, event) {
  store.auditLogs.push(event);
  if (store.auditLogs.length > 5000) {
    store.auditLogs = store.auditLogs.slice(-5000);
  }
}

module.exports = {
  createAuditEvent,
  appendAudit
};
