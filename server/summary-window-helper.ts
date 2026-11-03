/** Normal accumulation target; request admission uses the fully assembled native request. */
export const SUMMARY_BATCH_TARGET_CHARS = 12000;

/**
 * Keep an ordered, whole-message prefix. A legal first message may exceed the
 * normal target; it is admitted only after the real Runner request is measured.
 * Never skip an oversized first message or mistake this target for a gateway limit.
 */
export function selectSummaryBatchMessages<T extends { id: string }>(
  rawMessages: readonly T[], targetChars: number = SUMMARY_BATCH_TARGET_CHARS,
): { messages: T[]; moreUncovered: boolean } {
  const messages: T[] = [];
  for (const message of rawMessages) {
    if (messages.length && JSON.stringify([...messages, message]).length > targetChars) break;
    messages.push(message);
  }
  return { messages, moreUncovered: messages.length < rawMessages.length };
}
