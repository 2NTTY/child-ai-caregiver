/** Type-only status unions used by HomeOverview. No Agent owner/data/model execution. */
export type AgentRunStatus = 'running'|'completed'|'stopped'|'unknown';
export type AgentProposalStatus = 'pending'|'accepted'|'dismissed'|'expired';
