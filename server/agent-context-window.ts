/** Whole recent messages only. Original history stays available through authorized cursor tools. */
export function selectRecentConversation<T extends { id: string; role: string; text: string; inReplyTo?: string | null }>(
  messages: readonly T[],
  currentIndex: number,
  options: { maxMessages?: number; maxCharacters?: number; upstreamHasEarlierMessages?: boolean } = {}
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

  // Replies can arrive after later prompts. Keep every missing parent available for authorized history reads.
  const omittedTurnPromptMessageIds = [...new Set(selected.flatMap(message =>
    message.role === 'model' && message.inReplyTo && !seen.has(message.inReplyTo) ? [message.inReplyTo] : []))];
  const omittedTurnPromptMessageId = omittedTurnPromptMessageIds[0] ?? null;
  const partialTurn = omittedTurnPromptMessageIds.length > 0;
  const upstreamHasEarlierMessages = options.upstreamHasEarlierMessages ?? false;

  return {
    messages: selected,
    coverage: {
      firstMessageId: selected[0].id,
      currentMessageId: messages[currentIndex].id,
      complete: !upstreamHasEarlierMessages && selected.length === currentIndex + 1,
      // This legacy count covers only the supplied page, not an invented count of unseen messages.
      omittedEarlierMessages: currentIndex + 1 - selected.length,
      omittedEarlierMessagesIsExact: !upstreamHasEarlierMessages,
      upstreamHasEarlierMessages,
      characters,
      currentMessageExceedsAllowance: characters > maxCharacters,
      partialTurn,
      omittedTurnPromptMessageId,
      omittedTurnPromptMessageIds,
      // Same order as messages; preserve delayed-reply relationships without duplicating their text.
      messageTopology: selected.map(({ id, role, inReplyTo }) => ({ id, role, inReplyTo: inReplyTo ?? null })),
    }
  };
}
