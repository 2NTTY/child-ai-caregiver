/** Source/review gate, deliberately not overridable by an environment variable.
 * Lift only after complete lifecycle tests/review and deployment readback; codec viability alone is insufficient.
 * Legacy unindexed staging / unknown copies / changed source evidence retain durable intents and fail closed.
 */
export const AVATAR_LIFECYCLE_RELEASE_READY = false;
