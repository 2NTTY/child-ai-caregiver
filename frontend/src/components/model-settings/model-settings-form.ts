import { formatMoneyMicros, parseMoneyBudget } from '../admin/usage-amounts.ts';
import { z } from "zod";
import { personalLimits, type ModelSettings, type ModelSettingsCommand } from "../../model-settings-view-model.ts";
import { DEFAULT_SOFT_BUDGET_RATIO, SOFT_BUDGET_RATIO_RANGE, deriveSoftBudgetTargets } from "../../../../src/shared/agent-run-limits.ts";
import type { EffectiveModelLimits, PersonalModelCatalog, PersonalModelProvider, PolicyLimitSource } from "../../../../src/shared/model-settings.ts";
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
    publicMaintenanceEnabled: settings.publicMaintenanceEnabled ?? false,
    monthlyText: settings.monthlyMoneyBudget ? formatMoneyMicros(String(settings.monthlyMoneyBudget.micros)) : '',
    monthlyCurrency: settings.monthlyMoneyBudget?.currency ?? 'HKD',
    monthlyMaintenanceText: settings.monthlyMaintenanceBudget ? formatMoneyMicros(String(settings.monthlyMaintenanceBudget.micros)) : '',
    monthlyMaintenanceCurrency: settings.monthlyMaintenanceBudget?.currency ?? 'HKD',
    moneyText: settings.dailyMoneyBudget ? formatMoneyMicros(String(settings.dailyMoneyBudget.micros)) : '',
    moneyCurrency: settings.dailyMoneyBudget?.currency ?? 'HKD',
    maintenanceText: settings.maintenanceMoneyBudget ? formatMoneyMicros(String(settings.maintenanceMoneyBudget.micros)) : '',
    maintenanceCurrency: settings.maintenanceMoneyBudget?.currency ?? 'HKD',
    dailyText: String(settings.dailyLimit), modelCallsText: String(settings.maxModelCalls), queryEmbeddingsText: String(settings.maxQueryEmbeddings),
    toolCallsText: String(settings.maxToolCalls ?? effective?.maxToolCalls ?? personalLimits.toolCalls.default),
    runSecondsText: String(settings.maxRunSeconds ?? effective?.maxRunSeconds ?? personalLimits.deadlineSeconds.default),
    requestSecondsText: String(settings.modelRequestSeconds ?? effective?.modelRequestSeconds ?? personalLimits.modelRequestSeconds.default),
    retriesText: String(settings.maxModelRetries ?? effective?.maxModelRetries ?? personalLimits.modelRetries.default),
    softBudgetRatioText: settings.softBudgetRatio !== undefined ? String(settings.softBudgetRatio) : "" };
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
    monthlyText: z.string(), monthlyCurrency: z.string(), monthlyMaintenanceText: z.string(), monthlyMaintenanceCurrency: z.string(),
    moneyText: z.string(), moneyCurrency: z.string(), maintenanceText: z.string(), maintenanceCurrency: z.string(),
    publicMaintenanceEnabled: z.boolean(), softBudgetRatioText: z.string(),
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
    for (const [amount, currency] of [['moneyText', 'moneyCurrency'], ['maintenanceText', 'maintenanceCurrency'], ['monthlyText', 'monthlyCurrency'], ['monthlyMaintenanceText', 'monthlyMaintenanceCurrency']] as const) {
      if (parseMoneyBudget(draft[amount], draft[currency]) === undefined)
        context.addIssue({ code: 'custom', path: [amount], message: '請輸入三個大寫字母的幣別及最多六位小數的非負金額。' });
    }
    for (const [path, , range] of modelLimitFields) {
      const number = Number(draft[path]);
      if (!/^\d+$/u.test(draft[path]) || !Number.isInteger(number) || number < range.min || number > range.max)
        context.addIssue({ code: "custom", path: [path], message: `請輸入 ${range.min}–${range.max} 的整數。` });
    }
    const softText = (draft.softBudgetRatioText ?? "").trim();
    if (softText !== "") {
      const parsedRatio = parseAdminSoftBudgetRatioInput(softText);
      if (!Number.isFinite(parsedRatio) || parsedRatio < SOFT_BUDGET_RATIO_RANGE.min || parsedRatio > SOFT_BUDGET_RATIO_RANGE.max) {
        context.addIssue({ code: "custom", path: ["softBudgetRatioText"],
          message: `請輸入 ${SOFT_BUDGET_RATIO_RANGE.min}–${SOFT_BUDGET_RATIO_RANGE.max} 之間的小數，或留空沿用管理員比例。` });
      }
    }
  });
}
export function modelCommandFromDraft(draft: ModelSettingsDraft, settings: ModelSettings): ModelSettingsCommand {
  const personal = draft.mode === "personal";
  const softText = (draft.softBudgetRatioText ?? "").trim();
  const parsedSoftRatio = softText === "" ? Number.NaN : parseAdminSoftBudgetRatioInput(softText);
  const budgets: Pick<ModelSettingsCommand, 'dailyMoneyBudget' | 'maintenanceMoneyBudget' | 'monthlyMoneyBudget' | 'monthlyMaintenanceBudget'> = {};
  if (personal) {
    for (const [field, amount, currency] of [['dailyMoneyBudget', draft.moneyText, draft.moneyCurrency],
      ['maintenanceMoneyBudget', draft.maintenanceText, draft.maintenanceCurrency], ['monthlyMoneyBudget', draft.monthlyText, draft.monthlyCurrency],
      ['monthlyMaintenanceBudget', draft.monthlyMaintenanceText, draft.monthlyMaintenanceCurrency]] as const) {
      const value = parseMoneyBudget(amount, currency), saved = settings[field];
      if (value !== undefined && (value?.currency !== saved?.currency || value?.micros !== saved?.micros)) budgets[field] = value;
    }
  }
  const sponsor = personal && draft.backgroundEnabled && draft.publicMaintenanceEnabled;
  return { expectedVersion: settings.version, mode: draft.mode, ...budgets,
    ...(sponsor !== Boolean(settings.publicMaintenanceEnabled) ? { publicMaintenanceEnabled: sponsor } : {}),
    backgroundEnabled: personal && draft.backgroundEnabled, consent: personal && draft.consent,
    dailyLimit: personal ? Number(draft.dailyText) : settings.dailyLimit,
    maxModelCalls: personal ? Number(draft.modelCallsText) : settings.maxModelCalls,
    maxQueryEmbeddings: personal ? Number(draft.queryEmbeddingsText) : settings.maxQueryEmbeddings,
    ...(personal ? { provider: draft.provider, model: draft.model, maxToolCalls: Number(draft.toolCallsText), maxRunSeconds: Number(draft.runSecondsText),
      modelRequestSeconds: Number(draft.requestSecondsText), maxModelRetries: Number(draft.retriesText) } : {}),
    ...(personal && Number.isFinite(parsedSoftRatio) ? { softBudgetRatio: parsedSoftRatio } : {}),
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

export function formatPolicyLimitSourceLabel(source?: PolicyLimitSource): string {
  if (source === "personal") return "個人設定";
  if (source === "administrator") return "管理員政策";
  return "系統預設";
}

export function formatEffectiveSoftBudgetLine(effective: EffectiveModelLimits): string {
  const ratio = effective.softBudgetRatio ?? DEFAULT_SOFT_BUDGET_RATIO;
  const targets = effective.softTargets ?? deriveSoftBudgetTargets({
    modelCalls: effective.maxModelCalls,
    toolCalls: effective.maxToolCalls,
    queryEmbeddings: effective.maxQueryEmbeddings,
  }, ratio);
  return `軟預算目標（${Math.round(ratio * 100)}%，向下取整）：生成 ${targets.modelCalls}／工具 ${targets.toolCalls}／查詢向量 ${targets.queryEmbeddings} 次`;
}

export function formatEffectiveLimitSourcesLine(effective: EffectiveModelLimits): string | null {
  if (!effective.limitSources) return null;
  const s = effective.limitSources;
  return `規則來源：生成${formatPolicyLimitSourceLabel(s.maxModelCalls)} · 工具${formatPolicyLimitSourceLabel(s.maxToolCalls)} · 期限${formatPolicyLimitSourceLabel(s.maxRunSeconds)} · 軟比例${formatPolicyLimitSourceLabel(s.softBudgetRatio)}`;
}

export function parseAdminSoftBudgetRatioInput(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return Number.NaN;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}
