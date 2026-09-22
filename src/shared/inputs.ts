export interface CreateChildInput {
  displayName: string;
}

export interface CreateTextRecordInput {
  childId: string;
  text: string;
}

export interface InputIssue {
  field: "input" | "displayName" | "childId" | "text";
  code: "invalid_type" | "required" | "too_long" | "invalid_identifier";
  message: string;
}

export type InputResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: InputIssue[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidObject(): InputResult<never> {
  return {
    ok: false,
    issues: [{ field: "input", code: "invalid_type", message: "請檢查輸入資料。" }],
  };
}

export function validateCreateChild(input: unknown): InputResult<CreateChildInput> {
  if (!isObject(input)) return invalidObject();
  if (typeof input.displayName !== "string") {
    return { ok: false, issues: [{ field: "displayName", code: "invalid_type", message: "請輸入孩子的稱呼。" }] };
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    return { ok: false, issues: [{ field: "displayName", code: "required", message: "請輸入孩子的稱呼。" }] };
  }
  if ([...displayName].length > 80) {
    return { ok: false, issues: [{ field: "displayName", code: "too_long", message: "孩子的稱呼不可超過 80 個字。" }] };
  }
  // Identity and workspace ownership are established by the server, never input fields.
  return { ok: true, value: { displayName } };
}

export function validateCreateTextRecord(input: unknown): InputResult<CreateTextRecordInput> {
  if (!isObject(input)) return invalidObject();
  const issues: InputIssue[] = [];
  const { childId, text } = input;
  if (typeof childId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(childId)) {
    issues.push({ field: "childId", code: "invalid_identifier", message: "請先選擇孩子。" });
  }
  if (typeof text !== "string") {
    issues.push({ field: "text", code: "invalid_type", message: "請輸入文字記錄。" });
  } else if (text.trim().length === 0) {
    issues.push({ field: "text", code: "required", message: "請輸入文字記錄。" });
  } else if ([...text].length > 10000) {
    issues.push({ field: "text", code: "too_long", message: "每則文字記錄不可超過 10,000 個字。" });
  }
  if (issues.length > 0) return { ok: false, issues };
  // Keep the user's original wording, whitespace, approximate quantities and times.
  return { ok: true, value: { childId: childId as string, text: text as string } };
}
