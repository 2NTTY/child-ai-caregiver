/** Source/review gate, deliberately not overridable by an environment variable.
 * Lifecycle/restore and same-version deployment readback are verified; new writes remain separately opt-in.
 * Legacy unindexed staging / unknown copies / changed source evidence retain durable intents and fail closed.
 */
export const AVATAR_LIFECYCLE_RELEASE_READY = true;
