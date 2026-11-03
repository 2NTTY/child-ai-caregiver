/** Whole recent messages only. Original history stays available through authorized cursor tools. */
export function selectRecentConversation<T extends { id: string; role: string; text: string; inReplyTo?: string | null }>(
  messages: readonly T[],
  currentIndex: number,
  options: { maxMessages?: number; maxCharacters?: number } = {}
) {
  const maxMessages = options.maxMessages ?? 6, maxCharacters = options.maxCharacters ?? 14000;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= messages.length || messages[currentIndex].role !== 'user')
    throw new Error('Invalid current conversation message');
  const selected: T[] = [], seen = new Set<string>(); let characters = 0;
  for (let index = currentIndex; index >= 0 && selected.length < maxMessages; index--) {
    const message = messages[index]; if (seen.has(message.id)) continue;
    const size = JSON.stringify({ role: message.role, text: message.text }).length;
    // Never truncate the current instruction or silently skip an intervening oversized message.
    if (selected.length && characters + size > maxCharacters) break;
    selected.unshift(message); seen.add(message.id); characters += size;
  }

  // Turn-aware analysis: check whether the earliest selected message is an orphaned model reply
  const earliest = selected[0];
  let partialTurn = false;
  let omittedTurnPromptMessageId: string | null = null;
  if (earliest && earliest.role === 'model') {
    const parentId = earliest.inReplyTo;
    if (parentId && !seen.has(parentId)) {
      partialTurn = true;
      omittedTurnPromptMessageId = parentId;
    }
  }

  return {
    messages: selected,
    coverage: {
      firstMessageId: selected[0].id,
      currentMessageId: messages[currentIndex].id,
      complete: selected.length === currentIndex + 1,
      omittedEarlierMessages: currentIndex + 1 - selected.length,
      characters,
      currentMessageExceedsAllowance: characters > maxCharacters,
      partialTurn,
      omittedTurnPromptMessageId,
    }
  };
}
