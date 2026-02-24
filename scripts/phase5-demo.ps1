param(
  [string]$BaseUrl = "http://localhost:4000",
  [string]$Email = "admin@mom.local",
  [string]$Password = "admin12345"
)

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }

$startBody = @{
  title = "Phase 5 Demo Meeting"
  attendees = @("team@example.com", "qa@example.com")
  meetingLink = "https://meet.google.com/phase5-demo"
} | ConvertTo-Json
$meeting = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/start" -Headers $headers -ContentType "application/json" -Body $startBody
$meetingId = $meeting.id

$noteBody = @{ speaker = "Lead"; text = "Decision: ship Phase 5 this week" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/notes" -Headers $headers -ContentType "application/json" -Body $noteBody | Out-Null
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/end" -Headers $headers | Out-Null

$queueBody = @{ fromEmail = "admin@mom.local" } | ConvertTo-Json
$queued = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/$meetingId/send-mom" -Headers $headers -ContentType "application/json" -Body $queueBody

Start-Sleep -Seconds 3

$jobs = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/jobs" -Headers $headers
$analytics = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/admin/analytics" -Headers $headers
$audit = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/admin/audit?limit=5" -Headers $headers

Write-Output "MeetingId: $meetingId"
Write-Output "QueuedJobId: $($queued.jobId)"
Write-Output "RecentJobStatus: $($jobs.jobs[0].status)"
Write-Output "MomsQueued: $($analytics.analytics.momsQueued)"
Write-Output "MomsSent: $($analytics.analytics.momsSent)"
Write-Output "RecentAuditEvents: $($audit.logs.Count)"
