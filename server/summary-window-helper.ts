import { createHash } from 'node:crypto';

/** Normal accumulation target; request admission uses the fully assembled native request. */
export const SUMMARY_BATCH_TARGET_CHARS = 12000;

/** Default character ceiling for splitting an oversized single message into safe parts (~5,000 chars). */
export const SUMMARY_SAFE_PART_TARGET_CHARS = 5000;

/** Default JSON serialized character ceiling ensuring chunks fit in Gateway request limits. */
export const SUMMARY_SAFE_PART_SERIALIZED_CHARS = 10000;

export interface SummaryPartProgress {
  messageId: string;
  index: number;
  total: number;
  isLast: boolean;
  sourceHash?: string;
  startOffset?: number;
  endOffset?: number;
  cumulativeSummary?: string;
}

export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function surrogateSafeIndex(str: string, index: number): number {
  if (index > 0 && index < str.length) {
    if (isHighSurrogate(str.charCodeAt(index - 1)) && isLowSurrogate(str.charCodeAt(index))) {
      return index - 1;
    }
  }
  return index;
}

/**
 * Finds the largest end index from startIndex such that:
 * 1. raw character count <= maxRawChars
 * 2. JSON.stringify(slice).length <= maxSerializedChars
 */
export function findSafeChunkEnd(
  str: string,
  startIndex: number,
  maxRawChars: number = SUMMARY_SAFE_PART_TARGET_CHARS,
  maxSerializedChars: number = SUMMARY_SAFE_PART_SERIALIZED_CHARS
): number {
  let low = startIndex + 1;
  let high = Math.min(str.length, startIndex + maxRawChars);
  let best = low;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const slice = str.slice(startIndex, mid);
    if (JSON.stringify(slice).length <= maxSerializedChars) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * Splits a single message text into safe chunks:
 * - Fits within both raw character count and JSON serialized size limits.
 * - Never cuts between UTF-16 surrogate pairs.
 * - Prefers natural boundaries (\n\n, \n, sentence punctuation, spaces) when available.
 */
export function splitMessageIntoSafeChunks<T extends { id: string; text?: string }>(
  message: T,
  maxChunkChars: number = SUMMARY_SAFE_PART_TARGET_CHARS,
  maxSerializedChars: number = SUMMARY_SAFE_PART_SERIALIZED_CHARS
): (T & { startOffset: number; endOffset: number; sourceHash: string })[] {
  const fullText = message.text ?? '';
  const sourceHash = createHash('sha256').update(fullText).digest('hex');

  if (fullText.length <= maxChunkChars && JSON.stringify(fullText).length <= maxSerializedChars) {
    return [{ ...message, startOffset: 0, endOffset: fullText.length, sourceHash }];
  }

  const chunks: (T & { startOffset: number; endOffset: number; sourceHash: string })[] = [];
  let startIndex = 0;

  while (startIndex < fullText.length) {
    const remaining = fullText.length - startIndex;
    const remainingSlice = fullText.slice(startIndex);
    if (remaining <= maxChunkChars && JSON.stringify(remainingSlice).length <= maxSerializedChars) {
      chunks.push({
        ...message,
        text: remainingSlice,
        startOffset: startIndex,
        endOffset: fullText.length,
        sourceHash,
      });
      break;
    }

    let rawEnd = findSafeChunkEnd(fullText, startIndex, maxChunkChars, maxSerializedChars);
    let chosenEnd = surrogateSafeIndex(fullText, rawEnd);

    // Look back for a natural boundary in the final 20% of the chunk window
    const searchWindowStart = startIndex + Math.floor((chosenEnd - startIndex) * 0.8);
    const searchSlice = fullText.slice(searchWindowStart, chosenEnd);

    let foundBoundary = -1;
    for (const delimiter of ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ']) {
      const pos = searchSlice.lastIndexOf(delimiter);
      if (pos !== -1) {
        foundBoundary = searchWindowStart + pos + delimiter.length;
        break;
      }
    }

    if (foundBoundary > startIndex) {
      chosenEnd = surrogateSafeIndex(fullText, foundBoundary);
    }

    // Ensure forward progress
    if (chosenEnd <= startIndex) {
      chosenEnd = surrogateSafeIndex(fullText, startIndex + 1);
      if (chosenEnd <= startIndex) chosenEnd = startIndex + 1;
    }

    chunks.push({
      ...message,
      text: fullText.slice(startIndex, chosenEnd),
      startOffset: startIndex,
      endOffset: chosenEnd,
      sourceHash,
    });
    startIndex = chosenEnd;
  }

  return chunks;
}

/**
 * Keep an ordered, whole-message prefix or resume an active multi-part message.
 */
export function selectSummaryBatchMessages<T extends { id: string; text?: string }>(
  rawMessages: readonly T[],
  targetChars: number = SUMMARY_BATCH_TARGET_CHARS,
  activePart?: SummaryPartProgress
): {
  messages: T[];
  moreUncovered: boolean;
  part?: SummaryPartProgress;
} {
  if (rawMessages.length === 0) {
    return { messages: [], moreUncovered: false };
  }

  const firstMsg = rawMessages[0];

  // 1. Resume active multi-part message
  if (activePart && !activePart.isLast && activePart.messageId === firstMsg.id) {
    const currentHash = createHash('sha256').update(firstMsg.text ?? '').digest('hex');
    // Verify that the source message text has not been mutated
    if (!activePart.sourceHash || activePart.sourceHash === currentHash) {
      const chunks = splitMessageIntoSafeChunks(firstMsg);
      const nextIndex = activePart.index + 1;
      if (nextIndex < chunks.length) {
        const isLast = nextIndex === chunks.length - 1;
        const chunk = chunks[nextIndex];
        return {
          messages: [chunk],
          moreUncovered: !isLast || rawMessages.length > 1,
          part: {
            messageId: firstMsg.id,
            index: nextIndex,
            total: chunks.length,
            isLast,
            sourceHash: currentHash,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            cumulativeSummary: activePart.cumulativeSummary,
          },
        };
      }
    }
  }

  // 2. Standard accumulation
  const messages: T[] = [];
  for (const message of rawMessages) {
    if (messages.length && JSON.stringify([...messages, message]).length > targetChars) break;
    messages.push(message);
  }
  return { messages, moreUncovered: messages.length < rawMessages.length };
}
