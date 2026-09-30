import { z } from "zod";
import { personalLimits, type ModelSettings, type ModelSettingsCommand } from "../../model-settings-view-model.ts";

export function modelSettingsDraft(settings: ModelSettings) {
  return { mode: settings.mode, keyText: "", consent: false, backgroundEnabled: settings.backgroundEnabled,
    dailyText: String(settings.dailyLimit), modelCallsText: String(settings.maxModelCalls), queryEmbeddingsText: String(settings.maxQueryEmbeddings) };
}
export type ModelSettingsDraft = ReturnType<typeof modelSettingsDraft>;
export function modelSettingsSchema(keyConfigured: boolean) {
  return z.object({ mode: z.enum(["platform", "personal", "disabled"]), keyText: z.string().max(512, "密鑰最多 512 個字元。"),
    consent: z.boolean(), backgroundEnabled: z.boolean(), dailyText: z.string(), modelCallsText: z.string(), queryEmbeddingsText: z.string(),
  }).superRefine((draft, context) => {
    if (draft.mode !== "personal") return;
    if (!draft.consent) context.addIssue({ code: "custom", path: ["consent"], message: "請確認費用及資料外送安排。" });
    if (!keyConfigured && !draft.keyText.trim()) context.addIssue({ code: "custom", path: ["keyText"], message: "請輸入你的個人 API 密鑰。" });
    for (const [path, range] of [["dailyText", personalLimits.daily], ["modelCallsText", personalLimits.modelCalls], ["queryEmbeddingsText", personalLimits.queryEmbeddings]] as const) {
      const number = Number(draft[path]);
      if (!/^\d+$/u.test(draft[path]) || !Number.isInteger(number) || number < range.min || number > range.max) {
        context.addIssue({ code: "custom", path: [path], message: `請輸入 ${range.min}–${range.max} 的整數。` });
      }
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
    ...(personal && draft.keyText.trim() ? { apiKey: draft.keyText.trim() } : {}),
  };
}
export function removeModelKeyCommand(settings: ModelSettings): ModelSettingsCommand {
  return { expectedVersion: settings.version, mode: "disabled", removeKey: true, backgroundEnabled: false, consent: false,
    dailyLimit: settings.dailyLimit, maxModelCalls: settings.maxModelCalls, maxQueryEmbeddings: settings.maxQueryEmbeddings };
}
