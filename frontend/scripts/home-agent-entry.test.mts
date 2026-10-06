import assert from "node:assert/strict";
import { test } from "node:test";
import { homeAgentScope } from "../src/home-agent-entry.ts";
const context = { caregiverName: "Synthetic caregiver", selectedChildId: "a", children: [
  { id: "a", displayName: "A", ageLabel: "未知", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false, accessRole: "owner" as const },
] };

test("capture scope requires the selected child and changes with identity or access", () => {
  const scope = homeAgentScope(context);
  assert.ok(scope);
  assert.equal(homeAgentScope({ ...context, selectedChildId: "missing" }), null);
  assert.notEqual(homeAgentScope({ ...context, caregiverName: "Other caregiver" }), scope);
  assert.notEqual(homeAgentScope({ ...context, children: [{ ...context.children[0], accessRole: "viewer" }] }), scope);
});
