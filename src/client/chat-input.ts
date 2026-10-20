/** Normalize only blank lines at submission; keep the editing draft and paragraph text intact. */
export function normalizeChatInput(value: string): string {
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n").replace(/\n(?:[ \t]*\n){2,}/gu, "\n\n");
}
