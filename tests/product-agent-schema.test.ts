import assert from "node:assert/strict";
import test from "node:test";
import { FunctionTool } from "@google/adk";
import { AgentBudget } from "../server/agent-budget.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";

test("product tool declarations use Vertex-compatible integer bounds and server-owned topic filters", () => {
  const budget = new AgentBudget();
  try {
    const tools = createProductAgentTools({ run: { scope: {}, runId: "schema-only", budget },
      knowledge: { createRun: () => ({}) }, contact: {}, authorize: async () => false,
    } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    for (const [name, field] of [["propose_task_change", "expectedVersion"], ["contact_caregiver", "taskVersion"], ["contact_caregiver", "grantVersion"]]) {
      const tool = tools.find(value => value.name === name)!;
      const schema = new FunctionTool({ name, description: tool.description, parameters: tool.parameters.strict(), execute: async () => ({}) })._getDeclaration()!.parameters!.properties![field];
      assert.equal(schema.type, "INTEGER"); assert.equal(schema.minimum, 1);
      assert.equal(Object.hasOwn(schema, "exclusiveMinimum"), false);
      const validator = tool.parameters.shape[field];
      assert.equal(validator.safeParse(0).success, false); assert.equal(validator.safeParse(1).success, true);
    }
    const schema = tools.find(tool => tool.name === "search_knowledge")!.parameters.strict();
    assert.equal(schema.safeParse({query:"半歲加固",classification:"official_guidance"}).success,true);
    assert.equal(schema.safeParse({query:"半歲加固",topics:["invented-topic"],classification:"official_guidance"}).success,false);
  } finally { budget.close(); }
});
