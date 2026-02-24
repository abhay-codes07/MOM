param(
  [string]$BaseUrl = "http://localhost:4000"
)

$startPayload = @{
  title = "Phase 4 Demo Meeting"
  attendees = @("owner@example.com", "team@example.com")
  meetingLink = "https://meet.google.com/demo-phase4"
} | ConvertTo-Json

$meeting = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/start" -ContentType "application/json" -Body $startPayload
$meetingId = $meeting.id

Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/transcription/start" -ContentType "application/json" -Body (@{ provider = "mock-realtime" } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/transcription/chunks" -ContentType "application/json" -Body (@{ text = "Lead: Agenda: Review blockers and owners" } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/transcription/simulate" -ContentType "application/json" -Body (@{ preset = "planning"; intervalMs = 500 } | ConvertTo-Json) | Out-Null

Start-Sleep -Seconds 4

$transcript = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/meetings/$meetingId/transcription"
$insights = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/insights"
$end = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/end"

Write-Output "MeetingId: $meetingId"
Write-Output "TranscriptChunks: $($transcript.transcription.chunkCount)"
Write-Output "ActionItems: $($insights.insights.actionItems.Count)"
Write-Output "MoMLength: $($end.mom.Length)"
