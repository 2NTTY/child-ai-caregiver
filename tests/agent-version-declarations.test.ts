import assert from "node:assert/strict";
import test from "node:test";
import { FunctionTool } from "@google/adk";
import { createAgentConcernTools } from "../server/agent-concern-tools.ts";
import { createAgentDocumentTools } from "../server/agent-document-tools.ts";
import { concernChangeSchema } from "../src/shared/concerns.ts";
import { documentChangeSchema } from "../src/shared/family-documents.ts";

test("concern and document ADK declarations use inclusive positive integer bounds", () => {
  const run = { scope: {}, runId: "synthetic-schema-only" } as never;
  const tools = [...createAgentConcernTools({} as never, {} as never, run, async () => false),
    ...createAgentDocumentTools({} as never, {} as never, run, async () => false)];
  const versionedActions = new Map<string, string[]>();
  function check(value: unknown, toolName: string): void {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.hasOwn(value, "exclusiveMinimum"), false);
    const schema = value as { properties?: Record<string, { type?: string; minimum?: number; enum?: string[] }>; required?: string[] };
    const version = schema.properties?.expectedVersion;
    if (version) {
      assert.equal(version.type, "INTEGER", toolName);
      assert.equal(version.minimum, 1, toolName);
      assert.ok(schema.required?.includes("expectedVersion"), toolName);
      assert.ok(schema.required?.includes("authorityVersion"), toolName);
      const actions = schema.properties?.action?.enum;
      assert.ok(actions?.length, `${toolName} version must guard a declared action`);
      versionedActions.set(toolName, [...(versionedActions.get(toolName) ?? []), ...actions]);
    }
    for (const child of Object.values(value)) check(child, toolName);
  }
  for (const tool of tools) {
    check(new FunctionTool({ name: tool.name, description: tool.description,
      parameters: tool.parameters.strict(), execute: async () => ({}) })._getDeclaration(), tool.name);
  }
  assert.deepEqual(Object.fromEntries([...versionedActions].map(([name, actions]) => [name, actions.sort()])), {
    propose_concern_change: ["append", "archive", "restore", "schedule_followup"],
    change_family_document: ["archive", "check_item", "patch", "refresh", "restore"],
    propose_family_document_change: ["patch"],
  });
});

test("version validators keep positive integer limits and strict objects", () => {
  for (const schema of [...concernChangeSchema.options, ...documentChangeSchema.options]) {
    const version = schema.shape.expectedVersion;
    for (const value of [-1, 0, 0.5, "1", null, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(version.safeParse(value).success, false);
    assert.equal(version.safeParse(1).success, true);
  }
  assert.equal(concernChangeSchema.safeParse({ action: "archive", expectedVersion: 1, authorityVersion: "synthetic", confirm: true }).success, true);
  assert.equal(concernChangeSchema.safeParse({ action: "archive", expectedVersion: 2147483647, authorityVersion: "synthetic", confirm: true }).success, false);
  assert.equal(documentChangeSchema.safeParse({ action: "refresh", expectedVersion: 1, authorityVersion: "synthetic" }).success, true);
  assert.equal(documentChangeSchema.safeParse({ action: "refresh", expectedVersion: 1, authorityVersion: "synthetic", extra: true }).success, false);
});
