const { v4: uuidv4 } = require("uuid");

function detectPlatform(meetingLink = "") {
  const link = String(meetingLink || "").toLowerCase();
  if (link.includes("meet.google.com")) {
    return "google_meet";
  }
  if (link.includes("zoom.us")) {
    return "zoom";
  }
  if (link.includes("teams.microsoft.com")) {
    return "microsoft_teams";
  }
  return "manual";
}

function getSupportedPlatforms() {
  return [
    { id: "google_meet", label: "Google Meet" },
    { id: "zoom", label: "Zoom" },
    { id: "microsoft_teams", label: "Microsoft Teams" },
    { id: "manual", label: "Manual" }
  ];
}

function listMockCalendarEvents(platform, ownerEmail = "owner@example.com") {
  const now = Date.now();
  const plusMinutes = (m) => new Date(now + m * 60 * 1000).toISOString();

  const linkByPlatform = {
    google_meet: "https://meet.google.com/demo-phase3",
    zoom: "https://zoom.us/j/1234567890",
    microsoft_teams: "https://teams.microsoft.com/l/meetup-join/demo",
    manual: ""
  };

  return [
    {
      eventId: `${platform}-${uuidv4()}`,
      title: "Weekly Product Sync",
      ownerEmail,
      startsAt: plusMinutes(5),
      attendees: ["pm@example.com", "eng@example.com", "qa@example.com"],
      meetingLink: linkByPlatform[platform] || ""
    },
    {
      eventId: `${platform}-${uuidv4()}`,
      title: "Customer Review",
      ownerEmail,
      startsAt: plusMinutes(45),
      attendees: ["sales@example.com", "support@example.com"],
      meetingLink: linkByPlatform[platform] || ""
    }
  ];
}

module.exports = {
  detectPlatform,
  getSupportedPlatforms,
  listMockCalendarEvents
};
