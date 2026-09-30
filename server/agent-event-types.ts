export const AGENT_DUE_QUEUE = "agent-task-due-v1";
export const AGENT_DUE_OPTIONS = { expireInSeconds: 120, retryLimit: 2, retryDelay: 5,
  retryBackoff: false, retentionSeconds: 14 * 86400, deleteAfterSeconds: 7 * 86400 };
