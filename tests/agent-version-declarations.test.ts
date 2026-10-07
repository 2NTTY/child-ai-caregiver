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
  let versions = 0;
  function check(value: unknown): void {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.hasOwn(value, "exclusiveMinimum"), false);
    for (const [key, child] of Object.entries(value)) {
      if (key === "expectedVersion") {
        assert.equal(child.type, "INTEGER"); assert.equal(child.minimum, 1); versions++;
      }
      check(child);
    }
  }
  for (const tool of tools) {
    check(new FunctionTool({ name: tool.name, description: tool.description,
      parameters: tool.parameters.strict(), execute: async () => ({}) })._getDeclaration());
  }
  assert.equal(versions, 7);
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
