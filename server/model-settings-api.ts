import { apiError, jsonResponse } from "./workspace-api.ts";
import { ModelSettingsError } from "./model-settings-contract.ts";
import { parseModelSettingsCommand } from "./model-settings.ts";
import type { ModelRouting } from "./model-routing.ts";
import { MODEL_SETTINGS_MEDIA_TYPE, MODEL_SETTINGS_V3_MEDIA_TYPE, PERSONAL_MODEL, type ModelSettings, type PersonalModelCatalog, type PersonalModelProvider } from '../src/shared/model-settings.ts';

type SettingsRouting = Pick<ModelRouting, 'view' | 'settings' | 'check'> & {
  catalog?(userId: string, version: number, refresh: boolean, signal: AbortSignal, provider?: PersonalModelProvider): Promise<PersonalModelCatalog>;
};
const v3Fields = ['baseUrl', 'embeddingApiKey', 'removeEmbeddingKey'];
function v2Settings(value: ModelSettings): ModelSettings {
  if (value.provider === 'openai-compatible' || value.baseUrl || value.embeddingKeyConfigured)
    throw new ModelSettingsError('client_update_required', 409);
  const { baseUrl, embeddingKeyConfigured, ...compatible } = value;
  return compatible;
}
function legacySettings(value: ModelSettings): ModelSettings {
  value = v2Settings(value);
  if (value.provider !== 'gemini' || value.model !== PERSONAL_MODEL) throw new ModelSettingsError('client_update_required', 409);
  const { limitPolicyVersion, maxToolCalls, maxRunSeconds, modelRequestSeconds, maxModelRetries, ...legacy } = value;
  return legacy;
}
function v2Catalog(value: PersonalModelCatalog): PersonalModelCatalog {
  if (value.provider === 'openai-compatible' || value.models.some(model => model.provider === 'openai-compatible'))
    throw new ModelSettingsError('client_update_required', 409);
  return value;
}

const errorMessages: Record<ModelSettingsError['code'], string> = {
  invalid_input: '模型設定輸入有誤，請核對後再試。',
  version_conflict: '設定已改變，請重新讀取後再操作。',
  operation_conflict: '這次操作的內容已改變，請重新讀取設定後再提交。',
  key_required: '請輸入 API Key 後再啟用個人模型。',
  consent_required: '請先確認個人模型的使用及收費安排。',
  model_unsupported: '所選模型暫時不支援這項操作，請核對模型設定。',
  client_update_required: '這份模型設定需要新版應用程式，請更新後再操作。',
  unavailable: '模型設定暫時未能處理，請稍後再試。',
};

export async function handleModelSettingsRequest(request: Request, userId: string | null, routing: SettingsRouting): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.headers.get("x-expected-user-id") !== userId) return apiError("session_changed", "登入身份已改變，請重新讀取。", 403);
  const url = new URL(request.url), path = url.pathname, accept = request.headers.get('accept');
  const v3 = accept === MODEL_SETTINGS_V3_MEDIA_TYPE, v2 = accept === MODEL_SETTINGS_MEDIA_TYPE, versioned = v2 || v3;
  const publicSettings = (value: ModelSettings) => v3 ? value : v2 ? v2Settings(value) : legacySettings(value);
  try {
    const catalogProvider = url.searchParams.get('provider');
    if (url.search && !(versioned && request.method === 'GET' && path === '/api/ai/settings/models'
      && [...url.searchParams].length === 1 && (catalogProvider === 'gemini' || catalogProvider === 'vertex' || v3 && catalogProvider === 'openai-compatible')))
      throw new ModelSettingsError('invalid_input');
    if (request.method === "GET" && path === "/api/ai/settings") {
      const view = await routing.view(userId);
      if (versioned) return jsonResponse({ ...view, settings: publicSettings(view.settings) });
      const { effective, ...legacy } = view;
      return jsonResponse({ ...legacy, settings: legacySettings(view.settings) });
    }
    const operation = /^\/api\/ai\/settings\/operations\/([a-f0-9-]{36})$/i.exec(path);
    if (versioned && request.method === 'GET' && operation && routing.settings.getOperation) {
      const result = await routing.settings.getOperation(userId, operation[1].toLowerCase());
      return jsonResponse(result ? { ...result, settings: publicSettings(result.settings) } : null);
    }
    if (versioned && request.method === 'GET' && path === '/api/ai/settings/models' && routing.catalog) {
      const state = await routing.settings.get(userId);
      publicSettings(state);
      const result = await routing.catalog(userId, state.version, false, request.signal,
        catalogProvider === 'gemini' || catalogProvider === 'vertex' || v3 && catalogProvider === 'openai-compatible' ? catalogProvider : undefined);
      return jsonResponse(v3 ? result : v2Catalog(result));
    }
    if (request.method !== "POST") return apiError("not_found", "找不到此服務。", 404);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ModelSettingsError("invalid_input");
    let input: unknown;
    try { input = await request.json(); } catch { throw new ModelSettingsError("invalid_input"); }
    if (path === "/api/ai/settings") {
      const command = parseModelSettingsCommand(input);
      if (!v3) {
        if (v3Fields.some(key => Object.hasOwn(command, key)) || command.provider === 'openai-compatible')
          throw new ModelSettingsError('client_update_required', 409);
      }
      if (!versioned) {
        publicSettings(await routing.settings.get(userId));
        if (['opId', 'provider', 'model', 'maxToolCalls', 'maxRunSeconds', 'modelRequestSeconds', 'maxModelRetries'].some(key => Object.hasOwn(command, key)))
          throw new ModelSettingsError('client_update_required', 409);
      } else if (!command.opId) throw new ModelSettingsError('invalid_input');
      const result = await routing.settings.save(userId, command, v3 ? undefined : { maxSettingsVersion: 2 });
      return jsonResponse(publicSettings(result));
    }
    if (path === "/api/ai/settings/check" || versioned && path === '/api/ai/settings/models') {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1
        || !("expectedVersion" in input) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) throw new ModelSettingsError("invalid_input");
      if (path.endsWith('/models')) {
        if (!routing.catalog) throw new ModelSettingsError('unavailable', 503);
        if (!v3) publicSettings(await routing.settings.get(userId));
        const result = await routing.catalog(userId, input.expectedVersion as number, true, request.signal);
        return jsonResponse(v3 ? result : v2Catalog(result));
      }
      if (!v3) publicSettings(await routing.settings.get(userId));
      const result = await routing.check(userId, input.expectedVersion as number, request.signal);
      if (versioned) return jsonResponse(result);
      const { reason, ...legacy } = result; return jsonResponse(legacy);
    }
    return apiError("not_found", "找不到此服務。", 404);
  } catch (error) {
    if (error instanceof ModelSettingsError) return apiError(error.code, errorMessages[error.code], error.status);
    return apiError("service_unavailable", "模型設定暫時未能處理。", 503);
  }
}
