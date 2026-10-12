import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERSONAL_MODEL, PERSONAL_DAILY_LIMIT, PERSONAL_RUN_LIMITS, type ModelSettings } from '../src/shared/model-settings.ts';
import { ModelSettingsError, type ModelSettingsStore } from './model-settings-contract.ts';
import { parseModelSettingsCommand } from './model-settings.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';

const savedSchema = z.object({
  version: z.number().int().positive().max(2147483647), mode: z.enum(['platform', 'personal', 'disabled']),
  backgroundEnabled: z.boolean(),
  dailyLimit: z.number().int().min(PERSONAL_DAILY_LIMIT.min).max(PERSONAL_DAILY_LIMIT.max),
  maxModelCalls: z.number().int().min(PERSONAL_RUN_LIMITS.modelCalls.min).max(PERSONAL_RUN_LIMITS.modelCalls.max),
  maxQueryEmbeddings: z.number().int().min(PERSONAL_RUN_LIMITS.queryEmbeddings.min).max(PERSONAL_RUN_LIMITS.queryEmbeddings.max),
  apiKey: z.string().min(20).max(512).regex(/^[\x21-\x7e]+$/u).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();
type Saved = z.infer<typeof savedSchema>;
function publicSettings(value: Saved | null): ModelSettings {
  return { version: value?.version ?? 0, mode: value?.mode ?? 'platform', provider: 'gemini', model: PERSONAL_MODEL,
    keyConfigured: value?.apiKey != null, backgroundEnabled: value?.backgroundEnabled ?? false,
    dailyLimit: value?.dailyLimit ?? PERSONAL_DAILY_LIMIT.default, maxModelCalls: value?.maxModelCalls ?? PERSONAL_RUN_LIMITS.modelCalls.default,
    maxQueryEmbeddings: value?.maxQueryEmbeddings ?? PERSONAL_RUN_LIMITS.queryEmbeddings.default, updatedAt: value?.updatedAt ?? null };
}
/** Secrets stay within the server resolver; responses, receipts and change metadata contain no key. */
export function createFirestoreModelSettings(options: FirestoreDomainOptions): ModelSettingsStore {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const ref = (id: string) => data.ref('model_settings', 'model-settings', id);
  async function read(binding: FirestoreAuthorityTransaction): Promise<Saved | null> {
    const id = binding.scope.ownerUserId, row = await binding.transaction.get(ref(id));
    if (!row.exists) return null;
    const value = data.open('model-settings', id, binding.scope, savedSchema, row);
    if (value.version !== row.get('recordVersion') || value.mode === 'personal' && value.apiKey === null)
      throw new ModelSettingsError('unavailable', 503);
    return value;
  }
  return {
    get: userId => authority.runTransaction(userId, null, async binding => publicSettings(await read(binding))),
    resolve: userId => authority.runTransaction(userId, null, async binding => {
      const saved = await read(binding); return { settings: publicSettings(saved), apiKey: saved?.apiKey ?? null };
    }),
    isCurrent: (userId, expectedVersion) => authority.runTransaction(userId, null, async binding => ((await read(binding))?.version ?? 0) === expectedVersion),
    async save(userId, raw) {
      const command = parseModelSettingsCommand(raw), operationId = randomUUID();
      return authority.runTransaction(userId, null, async binding => {
        const current = await read(binding);
        if ((current?.version ?? 0) !== command.expectedVersion) throw new ModelSettingsError('version_conflict', 409);
        const apiKey = command.removeKey ? null : command.apiKey ?? current?.apiKey ?? null;
        if (command.mode === 'personal' && !apiKey) throw new ModelSettingsError('key_required');
        const saved = savedSchema.parse({ version: command.expectedVersion + 1, mode: command.mode, backgroundEnabled: command.backgroundEnabled,
          dailyLimit: command.dailyLimit, maxModelCalls: command.maxModelCalls, maxQueryEmbeddings: command.maxQueryEmbeddings,
          apiKey, updatedAt: new Date().toISOString() });
        const change = await binding.prepareChange(operationId, 'preferences', false);
        const envelope = { ...data.tags(binding.scope), ...data.seal('model-settings', userId, binding.scope, savedSchema, saved, saved.version) };
        change.commit(); binding.transaction.set(ref(userId), envelope); return publicSettings(saved);
      });
    },
  };
}
