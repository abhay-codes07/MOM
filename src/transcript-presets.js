function getPresetChunks(preset = "daily-standup") {
  const map = {
    "daily-standup": [
      "PM: Agenda: status updates and blockers",
      "Dev1: I completed the API endpoint for notifications",
      "Dev2: Decision: keep the existing auth middleware",
      "PM: Action: Dev2 should publish the rollout checklist by Friday",
      "QA: Next step is regression testing before release"
    ],
    "planning": [
      "Manager: Agenda: finalize sprint scope for next two weeks",
      "Lead: We decided to prioritize onboarding flow improvements",
      "Manager: Action: Rahul will estimate the analytics tasks",
      "Designer: Follow up on updated Figma review by tomorrow",
      "Lead: Deadline for final plan is Thursday EOD"
    ]
  };

  return map[preset] || map["daily-standup"];
}

module.exports = {
  getPresetChunks
};
