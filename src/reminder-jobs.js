const { v4: uuidv4 } = require("uuid");

function toIsoFuture(daysAhead) {
  const days = Math.max(0, Number(daysAhead || 0));
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildOwnerEmailLookup(attendees = []) {
  const lookup = new Map();
  for (const email of attendees) {
    const normalized = String(email || "").trim().toLowerCase();
    const localPart = normalized.split("@")[0] || "";
    if (localPart) {
      lookup.set(localPart, normalized);
    }
  }
  return lookup;
}

function resolveReminderRecipients(actionItem, ownerLookup, fallbackRecipients) {
  const ownerRaw = String(actionItem.owner || "").trim().toLowerCase();
  const ownerEmail = ownerLookup.get(ownerRaw) || ownerLookup.get(ownerRaw.split(" ")[0]);
  if (ownerEmail) {
    return [ownerEmail];
  }
  return fallbackRecipients;
}

function createReminderJobsFromInsights(meeting, fromEmail, daysAhead = 1) {
  const insights = meeting.insights || { actionItems: [] };
  const ownerLookup = buildOwnerEmailLookup(meeting.attendees || []);
  const fallbackRecipients = (meeting.attendees || []).slice(0, 5);
  const dueAt = toIsoFuture(daysAhead);

  const jobs = [];
  for (const item of insights.actionItems || []) {
    const recipients = resolveReminderRecipients(item, ownerLookup, fallbackRecipients);
    if (!recipients.length) {
      continue;
    }

    jobs.push({
      id: uuidv4(),
      type: "action_reminder_email",
      status: "queued",
      attempts: 0,
      maxRetries: 3,
      nextAttemptAt: dueAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      payload: {
        meetingId: meeting.id,
        fromEmail,
        to: recipients,
        subject: `Reminder: Action Item from ${meeting.title}`,
        text: `Action Item: ${item.item}\nOwner: ${item.owner}\nStatus: ${item.status}\nMeeting: ${meeting.title}`
      }
    });
  }

  return jobs;
}

module.exports = {
  createReminderJobsFromInsights
};
