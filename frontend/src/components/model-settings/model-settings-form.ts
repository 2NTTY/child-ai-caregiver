import { z } from "zod";
import { personalLimits, type ModelSettings, type ModelSettingsCommand } from "../../model-settings-view-model.ts";
import type { EffectiveModelLimits, PersonalModelCatalog, PersonalModelProvider } from "../../../../src/shared/model-settings.ts";
import { personalModelIdSchema } from "../../../../src/shared/model-settings-schema.ts";

/** Only project the server's selected-provider catalog; never substitute a model. */
export function modelCatalogSelection(catalog: PersonalModelCatalog | null | undefined, provider: PersonalModelProvider, selected: string) {
  const loaded = catalog?.provider === provider;
  const models = loaded ? catalog.models.filter(item => item.provider === provider) : [];
  const match = models.find(item => item.id === selected);
  return { loaded, listed: Boolean(match), capabilities: match?.capabilities,
    options: [...(!match ? [{ value: selected, label: selected || "輸入模型 ID" }] : []),
      ...models.map(item => ({ value: item.id, label: item.label }))] };
}

export const modelLimitFields = [
  ["dailyText", "個人每日呼叫上限", personalLimits.daily, "次"],
  ["modelCallsText", "每輪生成上限", personalLimits.modelCalls, "次"],
  ["queryEmbeddingsText", "每輪查詢向量上限", personalLimits.queryEmbeddings, "次"],
  ["toolCallsText", "每輪工具上限", personalLimits.toolCalls, "次"],
  ["runSecondsText", "整輪期限", personalLimits.deadlineSeconds, "秒"],
  ["requestSecondsText", "單次模型等待", personalLimits.modelRequestSeconds, "秒"],
  ["retriesText", "最多額外重試", personalLimits.modelRetries, "次"],
] as const;
export function modelSettingsDraft(settings: ModelSettings, effective?: EffectiveModelLimits) {
  return { mode: settings.mode, provider: settings.provider, model: settings.model, keyText: "", consent: false, backgroundEnabled: settings.backgroundEnabled,
    dailyText: String(settings.dailyLimit), modelCallsText: String(settings.maxModelCalls), queryEmbeddingsText: String(settings.maxQueryEmbeddings),
    toolCallsText: String(settings.maxToolCalls ?? effective?.maxToolCalls ?? personalLimits.toolCalls.default),
    runSecondsText: String(settings.maxRunSeconds ?? effective?.maxRunSeconds ?? personalLimits.deadlineSeconds.default),
    requestSecondsText: String(settings.modelRequestSeconds ?? effective?.modelRequestSeconds ?? personalLimits.modelRequestSeconds.default),
    retriesText: String(settings.maxModelRetries ?? effective?.maxModelRetries ?? personalLimits.modelRetries.default) };
}
export type ModelSettingsDraft = ReturnType<typeof modelSettingsDraft>;
export function modelSettingsSchema(keyConfigured: boolean, savedProvider: ModelSettings["provider"] = "gemini") {
  return z.object({ mode: z.enum(["platform", "personal", "disabled"]), provider: z.enum(["gemini", "vertex"]), model: z.string().max(128),
    keyText: z.string().max(512, "密鑰最多 512 個字元。"), consent: z.boolean(), backgroundEnabled: z.boolean(),
    dailyText: z.string(), modelCallsText: z.string(), queryEmbeddingsText: z.string(), toolCallsText: z.string(),
    runSecondsText: z.string(), requestSecondsText: z.string(), retriesText: z.string(),
  }).superRefine((draft, context) => {
    if (draft.mode !== "personal") return;
    if (!personalModelIdSchema.safeParse(draft.model).success)
      context.addIssue({ code: "custom", path: ["model"], message: "請輸入 Gemini 模型 ID，例如 gemini-3.1-flash-lite；不需填寫網址。" });
    if (!draft.consent) context.addIssue({ code: "custom", path: ["consent"], message: "請確認費用及資料外送安排。" });
    if (!draft.keyText.trim()) {
      if (!keyConfigured || draft.provider !== savedProvider) context.addIssue({ code: "custom", path: ["keyText"], message: "請輸入此供應商的個人 API 密鑰。" });
    } else if (draft.keyText.length < 20 || /[^\x21-\x7e]/u.test(draft.keyText)) {
      context.addIssue({ code: "custom", path: ["keyText"], message: "密鑰須為 20–512 個可列印 ASCII 字元，不能包含空格。" });
    }
    for (const [path, , range] of modelLimitFields) {
      const number = Number(draft[path]);
      if (!/^\d+$/u.test(draft[path]) || !Number.isInteger(number) || number < range.min || number > range.max)
        context.addIssue({ code: "custom", path: [path], message: `請輸入 ${range.min}–${range.max} 的整數。` });
    }
  });
}
export function modelCommandFromDraft(draft: ModelSettingsDraft, settings: ModelSettings): ModelSettingsCommand {
  const personal = draft.mode === "personal";
  return { expectedVersion: settings.version, mode: draft.mode,
    backgroundEnabled: personal && draft.backgroundEnabled, consent: personal && draft.consent,
    dailyLimit: personal ? Number(draft.dailyText) : settings.dailyLimit,
    maxModelCalls: personal ? Number(draft.modelCallsText) : settings.maxModelCalls,
    maxQueryEmbeddings: personal ? Number(draft.queryEmbeddingsText) : settings.maxQueryEmbeddings,
    ...(personal ? { provider: draft.provider, model: draft.model, maxToolCalls: Number(draft.toolCallsText), maxRunSeconds: Number(draft.runSecondsText),
      modelRequestSeconds: Number(draft.requestSecondsText), maxModelRetries: Number(draft.retriesText) } : {}),
    ...(personal && draft.keyText.trim() ? { apiKey: draft.keyText } : {}),
  };
}
export function removeModelKeyCommand(settings: ModelSettings): ModelSettingsCommand {
  return { expectedVersion: settings.version, mode: "disabled", removeKey: true, backgroundEnabled: false, consent: false,
    dailyLimit: settings.dailyLimit, maxModelCalls: settings.maxModelCalls, maxQueryEmbeddings: settings.maxQueryEmbeddings };
}
