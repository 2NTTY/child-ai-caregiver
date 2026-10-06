export const CONCERN_CHECK_QUEUE = "concern-check-v1", CONCERN_AGENT_QUEUE = "concern-agent-v1";
export const CONCERN_JOB_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 120,
  retryLimit: 2, retryDelay: 5, retryBackoff: false, retentionSeconds: 14 * 86400, deleteAfterSeconds: 7 * 86400 };
