import { z } from "zod";
import { personalLimits, type ModelSettings, type ModelSettingsCommand } from "../../model-settings-view-model.ts";
import type { EffectiveModelLimits, PersonalModelCatalog, PersonalModelProvider } from "../../../../src/shared/model-settings.ts";
import { personalBaseUrlSchema, personalEmbeddingShape, personalModelIdSchema, personalProviderSchema } from "../../../../src/shared/model-settings-schema.ts";

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
  return { mode: settings.mode, provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl ?? "",
    embeddingProvider: settings.embeddingProvider ?? "gemini", embeddingProject: settings.embeddingProject ?? "", embeddingLocation: settings.embeddingLocation ?? "",
    keyText: "", embeddingKeyText: "", removeEmbeddingKey: false, consent: false, backgroundEnabled: settings.backgroundEnabled,
    dailyText: String(settings.dailyLimit), modelCallsText: String(settings.maxModelCalls), queryEmbeddingsText: String(settings.maxQueryEmbeddings),
    toolCallsText: String(settings.maxToolCalls ?? effective?.maxToolCalls ?? personalLimits.toolCalls.default),
    runSecondsText: String(settings.maxRunSeconds ?? effective?.maxRunSeconds ?? personalLimits.deadlineSeconds.default),
    requestSecondsText: String(settings.modelRequestSeconds ?? effective?.modelRequestSeconds ?? personalLimits.modelRequestSeconds.default),
    retriesText: String(settings.maxModelRetries ?? effective?.maxModelRetries ?? personalLimits.modelRetries.default) };
}
export type ModelSettingsDraft = ReturnType<typeof modelSettingsDraft>;
export function modelEmbeddingRouteChanged(draft: Pick<ModelSettingsDraft, "embeddingProvider" | "embeddingProject" | "embeddingLocation">, settings?: ModelSettings) {
  return draft.embeddingProvider !== (settings?.embeddingProvider ?? "gemini")
    || draft.embeddingProvider === "vertex" && (draft.embeddingProject !== settings?.embeddingProject || draft.embeddingLocation !== settings?.embeddingLocation);
}
export function modelSettingsSchema(keyConfigured: boolean, savedProvider: ModelSettings["provider"] = "gemini", savedBaseUrl?: string, savedSettings?: ModelSettings) {
  return z.object({ mode: z.enum(["platform", "personal", "disabled"]), provider: personalProviderSchema, model: z.string().max(128),
    baseUrl: z.string().max(512, "API 地址最多 512 個字元。"),
    embeddingProvider: personalEmbeddingShape.embeddingProvider.unwrap(), embeddingProject: z.string(), embeddingLocation: z.string(),
    keyText: z.string().max(512, "密鑰最多 512 個字元。"), embeddingKeyText: z.string().max(512, "密鑰最多 512 個字元。"),
    removeEmbeddingKey: z.boolean(), consent: z.boolean(), backgroundEnabled: z.boolean(),
    dailyText: z.string(), modelCallsText: z.string(), queryEmbeddingsText: z.string(), toolCallsText: z.string(),
    runSecondsText: z.string(), requestSecondsText: z.string(), retriesText: z.string(),
  }).superRefine((draft, context) => {
    if (draft.mode !== "personal") return;
    if (!personalModelIdSchema.safeParse(draft.model).success || /^[a-z][a-z\d+.-]*:\/\//iu.test(draft.model))
      context.addIssue({ code: "custom", path: ["model"], message: "請輸入供應商提供的模型 ID，不是 API 網址。" });
    const endpoint = draft.provider === "openai-compatible" ? personalBaseUrlSchema.safeParse(draft.baseUrl) : null;
    if (endpoint && !endpoint.success)
      context.addIssue({ code: "custom", path: ["baseUrl"], message: "請輸入公開 HTTPS API 基底地址，不含帳密、查詢參數或其他連接埠。" });
    const endpointChanged = endpoint?.success && endpoint.data !== savedBaseUrl?.replace(/\/+$/u, "");
    if (!draft.consent) context.addIssue({ code: "custom", path: ["consent"], message: "請確認費用及資料外送安排。" });
    if (!draft.keyText.trim()) {
      if (!keyConfigured || draft.provider !== savedProvider || endpointChanged)
        context.addIssue({ code: "custom", path: ["keyText"], message: "新增或更換供應商／API 地址時，請重新輸入相應密鑰。" });
    } else if (/[^\x21-\x7e]/u.test(draft.keyText)) {
      context.addIssue({ code: "custom", path: ["keyText"], message: "密鑰須為 1–512 個可列印 ASCII 字元，不能包含空格。" });
    }
    if (draft.embeddingKeyText && /[^\x21-\x7e]/u.test(draft.embeddingKeyText))
      context.addIssue({ code: "custom", path: ["embeddingKeyText"], message: "密鑰須為 1–512 個可列印 ASCII 字元，不能包含空格。" });
    if (draft.removeEmbeddingKey && draft.embeddingKeyText)
      context.addIssue({ code: "custom", path: ["embeddingKeyText"], message: "請選擇替換或刪除向量密鑰，不可同時進行。" });
    if (draft.embeddingProvider === "vertex") {
      if (!personalEmbeddingShape.embeddingProject.safeParse(draft.embeddingProject).success)
        context.addIssue({ code: "custom", path: ["embeddingProject"], message: "請輸入有效的本人 GCP 專案 ID 或專案編號。" });
      if (!personalEmbeddingShape.embeddingLocation.safeParse(draft.embeddingLocation).success)
        context.addIssue({ code: "custom", path: ["embeddingLocation"], message: "請輸入有效的 Vertex 地區，例如 asia-east1 或 global。" });
    }
    if (!draft.removeEmbeddingKey && !draft.embeddingKeyText && (modelEmbeddingRouteChanged(draft, savedSettings)
      || draft.embeddingProvider === "vertex" && !savedSettings?.embeddingKeyConfigured))
      context.addIssue({ code: "custom", path: ["embeddingKeyText"], message: "新增或更換向量服務／專案／地區時，請重新輸入相應的獨立向量密鑰。" });
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
    ...(personal && draft.provider === "openai-compatible" ? { baseUrl: personalBaseUrlSchema.parse(draft.baseUrl) } : {}),
    ...(personal ? { embeddingProvider: draft.embeddingProvider } : {}),
    ...(personal && draft.embeddingProvider === "vertex" ? { embeddingProject: draft.embeddingProject, embeddingLocation: draft.embeddingLocation } : {}),
    ...(personal && draft.embeddingKeyText ? { embeddingApiKey: draft.embeddingKeyText } : {}),
    ...(personal && draft.removeEmbeddingKey ? { removeEmbeddingKey: true } : {}),
  };
}
export function removeModelKeyCommand(settings: ModelSettings): ModelSettingsCommand {
  return { expectedVersion: settings.version, mode: "disabled", removeKey: true, backgroundEnabled: false, consent: false,
    dailyLimit: settings.dailyLimit, maxModelCalls: settings.maxModelCalls, maxQueryEmbeddings: settings.maxQueryEmbeddings };
}
