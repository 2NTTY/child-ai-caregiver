import { AGENT_LIMITS } from './agent-budget.ts';

/** Normal batch accumulation target in characters (~12k). */
export const SUMMARY_BATCH_TARGET_CHARS = 12000;

/**
 * Reserve for prompt instructions, tools schemas, and JSON envelope in worker requests.
 * Real worker requests (memory-refresh recipe) measure ~9.5k fixed overhead + ~40/msg.
 * Reserving 10.5k provides ~1k safety margin, minimizing regression while ensuring total
 * request never touches the 32k gateway limit.
 */
export const SUMMARY_GATEWAY_RESERVE_CHARS = 10500;

/**
 * Absolute safe payload ceiling for a single batch or bounded first item.
 * Derived directly from Gateway limit: 32,000 - 10,500 = 21,500.
 */
export const SUMMARY_SAFE_REQUEST_CEILING = AGENT_LIMITS.inputCharacters - SUMMARY_GATEWAY_RESERVE_CHARS;

/**
 * Estimates the serialized character length of source messages once double-escaped
 * inside an LLM request payload.
 */
export function estimateSummaryPayloadCharacters(items: readonly unknown[], extra?: unknown): number {
  const innerPayload = JSON.stringify({ sourceMessages: items, ...(extra !== undefined ? { extra } : {}) });
  const contents = [{ role: 'user', parts: [{ text: innerPayload }] }];
  return JSON.stringify({ contents }).length;
}

/**
 * Selects messages for summary maintenance using Bounded First-Item Accommodation:
 * 1. Multi-message accumulation stops when raw JSON reaches targetChars (default 12,000)
 *    OR when the double-escaped payload reaches maxSafeChars (default 21,500).
 * 2. If the very first message exceeds targetChars, it is absorbed whole ONLY IF its double-escaped
 *    request payload does not exceed maxSafeChars (21,500).
 * 3. If even the first message exceeds maxSafeChars (e.g. 5,301+ quotes), it is NOT included,
 *    returning requiresContinuation: true without crashing the 32k Gateway.
 */
export function selectSummaryBatchMessages<T extends { id: string }>(
  rawMessages: readonly T[],
  targetChars: number = SUMMARY_BATCH_TARGET_CHARS,
  maxSafeChars: number = SUMMARY_SAFE_REQUEST_CEILING
): { messages: T[]; moreUncovered: boolean; requiresContinuation: boolean } {
  const messages: T[] = [];
  let accumulatedChars = 2; // '[]' JSON array overhead

  for (const msg of rawMessages) {
    const msgJsonSize = JSON.stringify(msg).length + 1;

    if (messages.length === 0) {
      const payloadSize = estimateSummaryPayloadCharacters([msg]);
      if (payloadSize > maxSafeChars) {
        // Exceeds safe gateway ceiling: cannot safely accommodate whole
        return { messages: [], moreUncovered: true, requiresContinuation: true };
      }

      messages.push(msg);
      accumulatedChars += msgJsonSize;

      if (msgJsonSize > targetChars) {
        // Bounded first-item accommodation: single oversized message occupies the entire batch
        break;
      }
    } else {
      // Subsequent items: strictly obey targetChars and maxSafeChars to prevent multi-message ballooning
      if (
        accumulatedChars + msgJsonSize <= targetChars &&
        estimateSummaryPayloadCharacters([...messages, msg]) <= maxSafeChars
      ) {
        messages.push(msg);
        accumulatedChars += msgJsonSize;
      } else {
        break;
      }
    }
  }

  return {
    messages,
    moreUncovered: messages.length < rawMessages.length,
    requiresContinuation: false,
  };
}
