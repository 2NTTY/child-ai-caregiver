import { modelProviderStopReason, type ModelProviderStopReason } from '../src/shared/agent-stop-message.ts';

export type ProviderStage = 'generation' | 'embedding';
/** A public diagnostic contains classifications, never provider bodies or request echoes. */
export interface PersonalProviderDiagnostic {
  stage: ProviderStage;
  reason: ModelProviderStopReason;
  httpStatus: number | null;
  providerCode?: string;
}
const knownCodes = new Set(['invalid_api_key', 'api_key_invalid', 'invalid_key', 'model_not_found',
  'model_not_available', 'insufficient_quota', 'quota_exceeded', 'resource_exhausted',
  'rate_limit_exceeded', 'context_length_exceeded', 'unsupported_parameter', 'permission_denied',
  'invalid_argument', 'not_found', 'unauthenticated']);

export class PersonalProviderError extends Error {
  readonly diagnostic: PersonalProviderDiagnostic;
  constructor(diagnostic: PersonalProviderDiagnostic) {
    super(diagnostic.reason);
    this.name = 'PersonalProviderError';
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

export function providerConfigurationError(reason: ModelProviderStopReason, stage: ProviderStage = 'generation') {
  return new PersonalProviderError({ stage, reason, httpStatus: null });
}

/** Inspect only bounded error fields, then discard the original message (it may echo a key or prompt). */
export function personalProviderHttpError(status: number, body: unknown, stage: ProviderStage = 'generation'): PersonalProviderError {
  let value: unknown = body;
  if (typeof body === 'string') {
    try { value = JSON.parse(body.slice(0, 16384)); } catch { value = { message: body.slice(0, 2048) }; }
  }
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown> : root;
  const message = typeof error.message === 'string' ? error.message.slice(0, 2048) : '';
  const code = [error.code, error.status, error.type].find(v => typeof v === 'string' && knownCodes.has(v.toLowerCase()));
  const providerCode = typeof code === 'string' ? code.toLowerCase() : undefined;
  const hint = `${providerCode ?? ''} ${message}`;
  let reason: ModelProviderStopReason = modelProviderStopReason(status) === 'unavailable'
    ? 'model_provider_rejected' : modelProviderStopReason(status) as ModelProviderStopReason;
  if (status === 401 || /invalid[_ ]api[_ ]key|api[_ ]key[_ ]invalid|API key not valid|unauthenticated/i.test(hint)) reason = 'model_key_invalid';
  else if (/user location is not supported|not available in your (country|region)/i.test(hint)) reason = 'model_region_unavailable';
  else if (/insufficient_quota|quota[_ ]exceeded|quota.*(exceeded|exhausted)|exceeded.*(quota|credit)|credit.*(exhausted|insufficient)|billing.*(limit|balance)|insufficient.*balance/i.test(hint)) reason = 'model_provider_quota';
  else if (status === 429) reason = 'model_provider_rate_limit';
  else if (/context_length_exceeded|context (length|window).*exceed|too many tokens/i.test(hint)) reason = 'model_context_exceeded';
  else if (/(tools?|function.calling).*(not supported|unsupported|not allowed)|does not support.*(tools?|function)/i.test(hint)) reason = 'model_tools_unsupported';
  else if (/(image|audio|input_audio|media).*(not supported|unsupported)|does not support.*(image|audio|media)/i.test(hint)) reason = 'model_input_unsupported';
  else if (status === 404 || /model_not_found|model_not_available/i.test(hint)) reason = 'model_not_available';
  if (stage === 'embedding') {
    reason = reason === 'model_key_invalid' ? 'embedding_key_invalid'
      : reason === 'model_provider_quota' ? 'embedding_provider_quota'
      : reason === 'model_provider_rate_limit' ? 'embedding_provider_rate_limit'
      : reason === 'model_not_available' ? 'embedding_model_unavailable'
      : reason === 'model_region_unavailable' ? 'embedding_region_unavailable'
      : status === 403 ? 'embedding_permission_denied' : 'embedding_provider_failed';
  }
  return new PersonalProviderError({ stage, reason, httpStatus: status, ...(providerCode ? { providerCode } : {}) });
}
