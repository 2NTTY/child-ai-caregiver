import { LlmAgent } from "@google/adk";
import type { Event, InvocationContext, LlmAgentConfig, LlmRequest, LlmResponse } from "@google/adk";
import { FunctionCallingConfigMode } from "@google/genai";
import { AgentStopped } from "./agent-budget.ts";
import type { AgentBudget } from "./agent-budget.ts";

// Server-owned protocol correction, never a new chat message or operation authorization.
export const PRESENTATION_REPAIR_MESSAGE = "伺服器正在補齊本次運行的展示收尾。請只調用一次 present_answer，根據已有上下文、工具結果及有效引用回覆。不得調用其他工具、重做操作，或把被拒絕及未確定的操作說成成功。已保存候選仍未確認；未完成的事項如實說明，缺資料時只作必要補問。不得捏造引用或添加無依據的照護建議。這是展示修正，不是新的操作授權。";

interface PresentationRepair {
  budget: AgentBudget;
  authorize: () => Promise<boolean>;
  accepted: () => boolean;
  stopped: () => boolean;
}

/** One presentation-only turn on ADK 2.1.0's original invocation and cost manager. */
export class PresentationRepairAgent extends LlmAgent {
  failure?: AgentStopped;
  private readonly repair: PresentationRepair;
  private naturalFinal = false;
  private repairStarted = false;
  private repairRequestStarted = false;

  constructor(config: Omit<LlmAgentConfig, "beforeModelCallback" | "afterModelCallback">, repair: PresentationRepair) {
    super(config);
    this.repair = repair;
    this.beforeModelCallback = ({ request }) => { this.prepareRepairRequest(request); };
    this.afterModelCallback = ({ response }) => { this.observePrimaryResponse(response); };
  }

  get repairing() { return this.repairStarted; }

  private observePrimaryResponse(response: LlmResponse) {
    if (this.repairStarted) return;
    const parts = response.content?.parts;
    // The gateway already validates STOP and completeness. Repeat the positive
    // checks here; errors, blocked/empty/thought-only and unknown part types fail closed.
    this.naturalFinal = response.finishReason === "STOP" && !response.errorCode && !response.partial && !response.interrupted
      && response.content?.role === "model" && Boolean(parts?.length)
      && parts!.every(part => Object.keys(part).every(key => ["text", "thought", "thoughtSignature"].includes(key)))
      && parts!.some(part => !part.thought && typeof part.text === "string" && Boolean(part.text.trim()));
  }

  private prepareRepairRequest(request: LlmRequest) {
    if (!this.repairStarted) return;
    // A phase guard is not a daily-quota or global-model-limit failure.
    if (this.repairRequestStarted) throw this.failure = new AgentStopped("invalid_response");
    this.repairRequestStarted = true;
    const terminal = request.toolsDict.present_answer;
    const declarations = request.config?.tools?.flatMap(tool =>
      typeof tool === "object" && tool !== null && "functionDeclarations" in tool ? tool.functionDeclarations ?? [] : [])
      .filter(declaration => declaration.name === "present_answer") ?? [];
    if (!terminal || declarations.length !== 1) throw this.failure = new AgentStopped("invalid_tool");
    request.config ??= {};
    request.config.tools = [{ functionDeclarations: declarations }];
    request.toolsDict = { present_answer: terminal };
    request.allowedTools = ["present_answer"];
    request.config.toolConfig = { functionCallingConfig: {
      mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["present_answer"],
    } };
    // Keep every original native part and opaque signature. This request-local
    // control part is not appended to the session, chat history or source ledger.
    request.contents = [...request.contents, { role: "user", parts: [{ text: PRESENTATION_REPAIR_MESSAGE }] }];
  }

  protected override async *runAsyncImpl(context: InvocationContext): AsyncGenerator<Event, void, void> {
    let primaryError = false;
    for await (const event of super.runAsyncImpl(context)) {
      if (event.errorCode) primaryError = true;
      yield event;
    }
    if (primaryError || this.repairStarted || !this.naturalFinal || this.repair.accepted() || this.repair.stopped()) return;
    const { budget, authorize } = this.repair;
    budget.check();
    if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
    if (budget.counts.modelCalls >= budget.limits.modelCalls) throw new AgentStopped("model_limit");
    if (budget.counts.toolCalls >= budget.limits.toolCalls) throw new AgentStopped("tool_limit");
    this.repairStarted = true;
    // Reuse the same invocation, shared model-call counter, signal and deadline.
    for await (const event of super.runAsyncImpl(context)) {
      yield event;
      // Rejected or invalid-argument presentation is the end of this one repair
      // too. Never let the native loop start a third presentation attempt.
      if (event.errorCode || event.content?.parts?.some(part => part.functionResponse)) break;
    }
  }
}
