import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERSONAL_MODEL, PERSONAL_DAILY_LIMIT, PERSONAL_RUN_LIMITS, type ModelSettings } from '../src/shared/model-settings.ts';
import { ModelSettingsError, type ModelSettingsStore } from './model-settings-contract.ts';
import { parseModelSettingsCommand } from './model-settings.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { modelSettingsOperationSchema, personalAdvancedShape, personalEmbeddingShape, personalModelIdSchema, personalProviderSchema, personalBaseUrlSchema } from '../src/shared/model-settings-schema.ts';

const savedSchema = z.object({
  limitPolicyVersion: z.literal(2).optional(),
  version: z.number().int().positive().max(2147483647), mode: z.enum(['platform', 'personal', 'disabled']),
  backgroundEnabled: z.boolean(),
  dailyLimit: z.number().int().min(PERSONAL_DAILY_LIMIT.min).max(PERSONAL_DAILY_LIMIT.max),
  maxModelCalls: z.number().int().min(PERSONAL_RUN_LIMITS.modelCalls.min).max(PERSONAL_RUN_LIMITS.modelCalls.max),
  maxQueryEmbeddings: z.number().int().min(PERSONAL_RUN_LIMITS.queryEmbeddings.min).max(PERSONAL_RUN_LIMITS.queryEmbeddings.max),
  provider: personalProviderSchema.optional(), model: personalModelIdSchema.optional(), ...personalAdvancedShape,
  apiKey: z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/u).nullable(),
  baseUrl: personalBaseUrlSchema.optional(), ...personalEmbeddingShape,
  embeddingApiKey: z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/u).nullable().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();
type Saved = z.infer<typeof savedSchema>;
export const firestoreModelSettingsRecoverySchema = savedSchema;
export const firestoreModelSettingsOperationRecoverySchema = modelSettingsOperationSchema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const advanced = (value: Saved | null) => Object.fromEntries(Object.keys(personalAdvancedShape)
  .filter(key => value && Object.hasOwn(value, key)).map(key => [key, value![key as keyof Saved]]));
function publicSettings(value: Saved | null): ModelSettings {
  return { ...(value?.limitPolicyVersion ? { limitPolicyVersion: value.limitPolicyVersion } : {}),
    version: value?.version ?? 0, mode: value?.mode ?? 'platform', provider: value?.provider ?? 'gemini', model: value?.model ?? PERSONAL_MODEL,
    keyConfigured: value?.apiKey != null, backgroundEnabled: value?.backgroundEnabled ?? false,
    ...(value?.baseUrl ? { baseUrl: value.baseUrl } : {}),
    ...Object.fromEntries(Object.keys(personalEmbeddingShape).filter(key => value && Object.hasOwn(value, key)).map(key => [key, value![key as keyof Saved]])),
    ...(value?.embeddingApiKey !== undefined ? { embeddingKeyConfigured: value.embeddingApiKey !== null } : {}),
    dailyLimit: value?.dailyLimit ?? PERSONAL_DAILY_LIMIT.default, maxModelCalls: value?.maxModelCalls ?? PERSONAL_RUN_LIMITS.modelCalls.default,
    maxQueryEmbeddings: value?.maxQueryEmbeddings ?? PERSONAL_RUN_LIMITS.queryEmbeddings.default, ...advanced(value), updatedAt: value?.updatedAt ?? null };
}
/** Secrets stay within the server resolver; responses, receipts and change metadata contain no key. */
export function createFirestoreModelSettings(options: FirestoreDomainOptions): ModelSettingsStore {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const ref = (id: string) => data.ref('model_settings', 'model-settings', id);
  const operationIdFor = (userId: string, opId: string) => JSON.stringify([userId, opId]);
  const operationRef = (id: string) => data.ref('model_settings_operations', 'model-settings-operation', id);
  async function readOperation(binding: FirestoreAuthorityTransaction, opId: string) {
    const id = operationIdFor(binding.scope.ownerUserId, opId), row = await binding.transaction.get(operationRef(id));
    return row.exists ? data.open('model-settings-operation', id, binding.scope, firestoreModelSettingsOperationRecoverySchema, row) : null;
  }
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
      const saved = await read(binding); return { settings: publicSettings(saved), apiKey: saved?.apiKey ?? null,
        embeddingApiKey: saved?.embeddingApiKey ?? null };
    }),
    isCurrent: (userId, expectedVersion) => authority.runTransaction(userId, null, async binding => ((await read(binding))?.version ?? 0) === expectedVersion),
    getOperation: (userId, opId) => {
      if (!z.uuid().safeParse(opId).success) throw new ModelSettingsError('invalid_input');
      return authority.runTransaction(userId, null, async binding => {
        const result = await readOperation(binding, opId);
        return result ? { opId: result.opId, settings: result.settings } : null;
      });
    },
    async save(userId, raw, client) {
      const command = parseModelSettingsCommand(raw), operationId = command.opId ?? randomUUID();
      const fingerprint = firestoreDomainHash(command);
      return authority.runTransaction(userId, null, async binding => {
        const original = command.opId ? await readOperation(binding, command.opId) : null;
        if (original) {
          if (original.fingerprint !== fingerprint) throw new ModelSettingsError('operation_conflict', 409);
          return original.settings;
        }
        const current = await read(binding);
        // Check in the same write transaction; an extra pre-read would consume a lost-response recovery attempt.
        if (client && (current?.embeddingProvider === 'vertex' || command.embeddingProvider === 'vertex')) throw new ModelSettingsError('client_update_required', 409);
        if (client?.maxSettingsVersion === 2 && (current?.provider === 'openai-compatible' || current?.baseUrl || current?.embeddingApiKey))
          throw new ModelSettingsError('client_update_required', 409);
        if ((current?.version ?? 0) !== command.expectedVersion) throw new ModelSettingsError('version_conflict', 409);
        const apiKey = command.removeKey ? null : command.apiKey ?? current?.apiKey ?? null;
        const provider = command.provider ?? current?.provider ?? 'gemini', model = command.model ?? current?.model ?? PERSONAL_MODEL;
        if (command.baseUrl !== undefined && provider !== 'openai-compatible') throw new ModelSettingsError('invalid_input');
        const baseUrl = provider === 'openai-compatible' ? command.baseUrl ?? current?.baseUrl ?? 'https://api.openai.com/v1' : undefined;
        if (provider !== (current?.provider ?? 'gemini') && apiKey && !command.apiKey) throw new ModelSettingsError('key_required');
        if (baseUrl !== current?.baseUrl && provider === 'openai-compatible' && apiKey && !command.apiKey)
          throw new ModelSettingsError('key_required');
        if (command.mode === 'personal' && !apiKey) throw new ModelSettingsError('key_required');
        const embeddingProvider = command.embeddingProvider ?? current?.embeddingProvider ?? 'gemini';
        const embeddingProject = embeddingProvider === 'vertex' ? command.embeddingProject ?? current?.embeddingProject : undefined;
        const embeddingLocation = embeddingProvider === 'vertex' ? command.embeddingLocation ?? current?.embeddingLocation : undefined;
        if (embeddingProvider === 'vertex' && (!embeddingProject || !embeddingLocation)
          || embeddingProvider !== 'vertex' && (command.embeddingProject !== undefined || command.embeddingLocation !== undefined))
          throw new ModelSettingsError('invalid_input');
        const embeddingChanged = embeddingProvider !== (current?.embeddingProvider ?? 'gemini')
          || embeddingProject !== current?.embeddingProject || embeddingLocation !== current?.embeddingLocation;
        if (embeddingChanged && !(command.removeKey || command.removeEmbeddingKey) && (!command.embeddingApiKey || !command.consent))
          throw new ModelSettingsError('key_required');
        const saved = savedSchema.parse({ version: command.expectedVersion + 1, mode: command.mode, backgroundEnabled: command.backgroundEnabled,
          dailyLimit: command.dailyLimit, maxModelCalls: command.maxModelCalls, maxQueryEmbeddings: command.maxQueryEmbeddings,
          ...(command.opId || current?.limitPolicyVersion ? { limitPolicyVersion: 2 } : {}),
          provider, model, ...advanced(current), ...Object.fromEntries(Object.keys(personalAdvancedShape)
            .filter(key => Object.hasOwn(command, key)).map(key => [key, command[key as keyof typeof command]])),
          apiKey, ...(baseUrl ? { baseUrl } : {}),
          ...(command.embeddingProvider !== undefined || current?.embeddingProvider !== undefined ? { embeddingProvider } : {}),
          ...(embeddingProvider === 'vertex' ? { embeddingProject, embeddingLocation } : {}),
          ...(command.removeKey || command.removeEmbeddingKey || command.embeddingApiKey || current?.embeddingApiKey !== undefined
            ? { embeddingApiKey: command.removeKey || command.removeEmbeddingKey ? null : command.embeddingApiKey ?? current?.embeddingApiKey ?? null } : {}),
          updatedAt: new Date().toISOString() });
        const change = await binding.prepareChange(operationId, 'preferences', false);
        const envelope = { ...data.tags(binding.scope), ...data.seal('model-settings', userId, binding.scope, savedSchema, saved, saved.version) };
        const result = publicSettings(saved);
        change.commit(); binding.transaction.set(ref(userId), envelope);
        if (command.opId) {
          const id = operationIdFor(userId, command.opId);
          binding.transaction.set(operationRef(id), { ...data.tags(binding.scope),
            ...data.seal('model-settings-operation', id, binding.scope, firestoreModelSettingsOperationRecoverySchema,
              { opId: command.opId, fingerprint, settings: result }, saved.version) });
        }
        return result;
      });
    },
  };
}
