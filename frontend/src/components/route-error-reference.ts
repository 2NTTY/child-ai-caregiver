// Show only an allowlisted type and numeric bundle positions, never the error
// message, URL, local path, account data or arbitrary component text.
export function routeErrorReference(error: Error): string {
  const kind = ["TypeError", "ReferenceError", "RangeError", "SyntaxError"].includes(error.name) ? error.name : "Error";
  const positions = [...(error.stack ?? "").matchAll(/(?:@|:)(\d+):(\d+)\)?(?=\s*$)/gm)]
    .slice(0, 3).map(match => `${match[1]}:${match[2]}`);
  return ["UI", kind, ...positions].join(" · ");
}
