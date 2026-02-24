const { v4: uuidv4 } = require("uuid");

function createEmailJob({ meetingId, fromEmail, to, subject, text, maxRetries = 3 }) {
  return {
    id: uuidv4(),
    type: "send_mom_email",
    status: "queued",
    attempts: 0,
    maxRetries,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    payload: {
      meetingId,
      fromEmail,
      to,
      subject,
      text
    }
  };
}

function markJobProcessing(job) {
  job.status = "processing";
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
}

function markJobSuccess(job) {
  job.status = "succeeded";
  job.error = null;
  job.updatedAt = new Date().toISOString();
}

function markJobRetry(job, errorMessage) {
  job.status = "queued";
  job.error = errorMessage;
  const backoffSeconds = Math.min(60, 2 ** job.attempts);
  job.nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  job.updatedAt = new Date().toISOString();
}

function markJobFailed(job, errorMessage) {
  job.status = "failed";
  job.error = errorMessage;
  job.updatedAt = new Date().toISOString();
}

function getNextRunnableJob(jobs) {
  const now = Date.now();
  return jobs.find((job) => job.status === "queued" && new Date(job.nextAttemptAt).getTime() <= now);
}

module.exports = {
  createEmailJob,
  markJobProcessing,
  markJobSuccess,
  markJobRetry,
  markJobFailed,
  getNextRunnableJob
};
