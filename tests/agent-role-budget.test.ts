import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { AgentBudget } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { readAiConfig } from "../server/ai-config.ts";

test("tool-free roles see the remaining shared budget and do not acquire another allowance", async t => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  budget.configurePersonal({ modelCalls: 8, toolCalls: 16, queryEmbeddings: 4 });
  budget.take("modelCalls", 3);
  budget.take("toolCalls", 2);
  const snapshots: { remaining: { modelCallsIncludingThisCall: number; toolCalls: number; queryEmbeddings: number } }[] = [];
  let attempts = 0, recorded = 0;
  const model = new AgentGatewayModel({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    budget, userId: "synthetic-parent", childId: "synthetic-child", authorize: async () => true,
    usage: { reserve: async () => { attempts++; return true; }, record: async () => { recorded++; } },
    provider: { async generate(request) {
      const instruction = request.config?.systemInstruction;
      assert.equal(typeof instruction, "string");
      assert.ok(String(instruction).startsWith("Return the reviewed structured result."));
      assert.deepEqual(request.toolsDict, {});
      snapshots.push(JSON.parse(String(instruction).split("\nServer role budget:\n")[1]!).budget);
      return { content: { role: "model", parts: [{ text: '{"decision":"approve"}' }] }, finishReason: FinishReason.STOP };
    } },
  });
  for (const stage of ["compose", "review"]) assert.equal(await model.completeText({
    system: "Return the reviewed structured result.", user: "Synthetic authorized evidence", attemptKey: stage,
  }), '{"decision":"approve"}');
  assert.deepEqual(snapshots.map(item => item.remaining.modelCallsIncludingThisCall), [5, 4]);
  assert.ok(snapshots.every(item => item.remaining.toolCalls === 14 && item.remaining.queryEmbeddings === 4));
  assert.deepEqual(budget.counts, { modelCalls: 5, toolCalls: 2, queryEmbeddings: 0 });
  assert.equal(attempts, 2);
  assert.equal(recorded, 2);
});
