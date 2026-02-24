function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value, fallback = "Participant") {
  const name = String(value || "").trim();
  return name || fallback;
}

function registerPresence(meeting, payload) {
  const action = payload.action === "leave" ? "leave" : "join";
  const name = normalizeName(payload.name);
  const email = normalizeEmail(payload.email);
  const source = payload.source || "manual";
  const timestamp = new Date().toISOString();

  const event = {
    name,
    email,
    action,
    source,
    timestamp
  };
  meeting.presenceEvents.push(event);

  const attendeeKey = email || name.toLowerCase();
  const attendee = meeting.attendanceMap.get(attendeeKey) || {
    name,
    email: email || null,
    firstJoinAt: null,
    lastLeaveAt: null,
    joins: 0,
    leaves: 0,
    discovered: false
  };

  attendee.name = name;
  attendee.email = email || attendee.email;
  attendee.discovered = attendee.discovered || !meeting.attendees.includes(email);

  if (action === "join") {
    attendee.joins += 1;
    if (!attendee.firstJoinAt) {
      attendee.firstJoinAt = timestamp;
    }
  } else {
    attendee.leaves += 1;
    attendee.lastLeaveAt = timestamp;
  }

  meeting.attendanceMap.set(attendeeKey, attendee);

  if (email && !meeting.attendees.includes(email)) {
    meeting.discoveredAttendees.add(email);
  }

  return event;
}

function getAttendanceSummary(meeting) {
  const mapped = Array.from(meeting.attendanceMap.values());
  const discovered = Array.from(meeting.discoveredAttendees.values());

  return {
    participantCount: mapped.length,
    discoveredParticipantCount: discovered.length,
    discoveredParticipants: discovered,
    participants: mapped.sort((a, b) => a.name.localeCompare(b.name))
  };
}

module.exports = {
  registerPresence,
  getAttendanceSummary
};
