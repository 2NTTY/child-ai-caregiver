import type { z } from "zod";

type HintReason = "wrong_type" | "invalid_value" | "invalid_format" | "out_of_range" | "undeclared_fields";
type TaskParameterHint = { path: string; reason: HintReason; expected: string };

// These are public, fixed task schema labels, never model-provided paths or values.
const taskFields = {
  title: { path: "values.title", expected: "non-blank string, at most 160 characters" },
  details: { path: "values.details", expected: "string, at most 2000 characters" },
  kind: { path: "values.kind", expected: "ordinary or appointment" },
  assigneeUserId: { path: "values.assigneeUserId", expected: "string, 1 to 128 characters" },
  dueAt: { path: "values.dueAt", expected: "ISO datetime with Z or offset, from 2000-01-01 inclusive to 2101-01-01 exclusive" },
  timeZone: { path: "values.timeZone", expected: "valid Intl time zone, at most 100 characters" },
} as const;
const root = { path: "$", expected: "object with only values" };
const values = { path: "values", expected: "object with all declared task fields" };

/** Repair hints for propose_task only; validation and authorization remain separate. */
export function taskParameterHints(issues: readonly z.core.$ZodIssue[]): TaskParameterHint[] {
  const hints: TaskParameterHint[] = [];
  for (const issue of issues) {
    let field: { path: string; expected: string } | undefined;
    if (issue.path.length === 0) field = root;
    else if (issue.path[0] === "values" && issue.path.length === 1) field = values;
    else if (issue.path[0] === "values" && issue.path.length === 2) {
      for (const [name, contract] of Object.entries(taskFields)) {
        if (issue.path[1] === name) { field = contract; break; }
      }
    }
    if (!field) continue;
    let reason: HintReason | undefined;
    if (issue.code === "invalid_type") reason = "wrong_type";
    else if (issue.code === "unrecognized_keys" && (field === root || field === values)) reason = "undeclared_fields";
    else if (issue.code === "invalid_value" && field === taskFields.kind) reason = "invalid_value";
    else if (issue.code === "invalid_format" && field === taskFields.dueAt) reason = "invalid_format";
    else if (issue.code === "too_small" || issue.code === "too_big") reason = "out_of_range";
    else if (issue.code === "custom") {
      if (field === taskFields.title || field === taskFields.timeZone) reason = "invalid_value";
      else if (field === taskFields.dueAt) reason = "out_of_range";
    }
    if (!reason || hints.some(hint => hint.path === field.path && hint.reason === reason)) continue;
    const hint = { path: field.path, reason, expected: field.expected };
    // Omit an entire hint if it does not fit; never truncate fields or JSON.
    if (JSON.stringify([...hints, hint]).length <= 512) hints.push(hint);
    if (hints.length === 3) break;
  }
  return hints;
}
