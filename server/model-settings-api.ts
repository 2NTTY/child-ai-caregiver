import { apiError, jsonResponse } from "./workspace-api.ts";
import { ModelSettingsError } from "./model-settings-contract.ts";
import { parseModelSettingsCommand } from "./model-settings.ts";
import type { ModelRouting } from "./model-routing.ts";
import { MODEL_SETTINGS_MEDIA_TYPE, PERSONAL_MODEL, type ModelSettings, type PersonalModelCatalog, type PersonalModelProvider } from '../src/shared/model-settings.ts';

type SettingsRouting = Pick<ModelRouting, 'view' | 'settings' | 'check'> & {
  catalog?(userId: string, version: number, refresh: boolean, signal: AbortSignal, provider?: PersonalModelProvider): Promise<PersonalModelCatalog>;
};
function legacySettings(value: ModelSettings): ModelSettings {
  if (value.provider !== 'gemini' || value.model !== PERSONAL_MODEL) throw new ModelSettingsError('client_update_required', 409);
  const { limitPolicyVersion, maxToolCalls, maxRunSeconds, modelRequestSeconds, maxModelRetries, ...legacy } = value;
  return legacy;
}

export async function handleModelSettingsRequest(request: Request, userId: string | null, routing: SettingsRouting): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.headers.get("x-expected-user-id") !== userId) return apiError("session_changed", "登入身份已改變，請重新讀取。", 403);
  const url = new URL(request.url), path = url.pathname, v2 = request.headers.get('accept') === MODEL_SETTINGS_MEDIA_TYPE;
  try {
    const catalogProvider = url.searchParams.get('provider');
    if (url.search && !(v2 && request.method === 'GET' && path === '/api/ai/settings/models'
      && [...url.searchParams].length === 1 && (catalogProvider === 'gemini' || catalogProvider === 'vertex')))
      throw new ModelSettingsError('invalid_input');
    if (request.method === "GET" && path === "/api/ai/settings") {
      const view = await routing.view(userId);
      if (v2) return jsonResponse(view);
      const { effective, ...legacy } = view;
      return jsonResponse({ ...legacy, settings: legacySettings(view.settings) });
    }
    const operation = /^\/api\/ai\/settings\/operations\/([a-f0-9-]{36})$/i.exec(path);
    if (v2 && request.method === 'GET' && operation && routing.settings.getOperation)
      return jsonResponse(await routing.settings.getOperation(userId, operation[1].toLowerCase()));
    if (v2 && request.method === 'GET' && path === '/api/ai/settings/models' && routing.catalog) {
      const state = await routing.settings.get(userId);
      return jsonResponse(await routing.catalog(userId, state.version, false, request.signal,
        catalogProvider === 'gemini' || catalogProvider === 'vertex' ? catalogProvider : undefined));
    }
    if (request.method !== "POST") return apiError("not_found", "找不到此服務。", 404);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ModelSettingsError("invalid_input");
    let input: unknown;
    try { input = await request.json(); } catch { throw new ModelSettingsError("invalid_input"); }
    if (path === "/api/ai/settings") {
      const command = parseModelSettingsCommand(input);
      if (!v2) {
        legacySettings(await routing.settings.get(userId));
        if (['opId', 'provider', 'model', 'maxToolCalls', 'maxRunSeconds', 'modelRequestSeconds', 'maxModelRetries'].some(key => Object.hasOwn(command, key)))
          throw new ModelSettingsError('client_update_required', 409);
      } else if (!command.opId) throw new ModelSettingsError('invalid_input');
      const result = await routing.settings.save(userId, command);
      return jsonResponse(v2 ? result : legacySettings(result));
    }
    if (path === "/api/ai/settings/check" || v2 && path === '/api/ai/settings/models') {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1
        || !("expectedVersion" in input) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) throw new ModelSettingsError("invalid_input");
      if (path.endsWith('/models')) {
        if (!routing.catalog) throw new ModelSettingsError('unavailable', 503);
        return jsonResponse(await routing.catalog(userId, input.expectedVersion as number, true, request.signal));
      }
      if (!v2) legacySettings(await routing.settings.get(userId));
      const result = await routing.check(userId, input.expectedVersion as number, request.signal);
      if (v2) return jsonResponse(result);
      const { reason, ...legacy } = result; return jsonResponse(legacy);
    }
    return apiError("not_found", "找不到此服務。", 404);
  } catch (error) {
    if (error instanceof ModelSettingsError) return apiError(error.code,
      error.code === "version_conflict" ? "設定已改變，請重新讀取後再操作。" : error.code === 'client_update_required'
        ? '這份模型設定需要新版應用程式，請更新後再操作。' : "未能完成模型設定，請核對輸入或稍後再試。", error.status);
    return apiError("service_unavailable", "模型設定暫時未能處理。", 503);
  }
}
