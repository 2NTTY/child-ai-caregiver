import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const revision = z.int().positive().max(2147483647);
function safePath(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !/[\\?#\u0000-\u001f]/u.test(path)
    && !/%(?:2e|2f|5c|25|0[0-9a-f])/iu.test(path) && !path.split('/').some(part => part === '.' || part === '..');
}
export const registeredSourceUrlSchema = z.string().trim().max(4096).refine(value => {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/u, '');
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && !/[\s\\]/u.test(value) && host.includes('.') && !/^\d+(?:\.\d+){3}$/u.test(host) && !host.includes(':')
      && safePath(url.pathname) && !/(^|\.)(?:local|localhost|internal|lan|home)$/u.test(host)
      && ![...url.searchParams.keys()].some(key => /(?:token|password|passwd|secret|signature|credential|session|api[-_]?key|^sig$|^auth$|^key$)/iu.test(key));
  } catch { return false; }
}).transform(value => new URL(value).href);
export const registeredSourceSettingsSchema = z.strictObject({
  name: z.string().trim().min(1).max(160), kind: z.enum(['document', 'directory', 'bulletin']),
  url: registeredSourceUrlSchema, frequencyMinutes: z.int().positive().max(2147483647),
  allowedPath: z.string().trim().max(2048).refine(safePath).transform(path => new URL(path, 'https://scope.example').pathname).optional(),
});
export function sourceCardDefaultFrequencyMinutes(kind: RegisteredSourceSettings['kind']): number {
  return kind === 'bulletin' ? 1440 : 10080;
}
const newSourceSettings = registeredSourceSettingsSchema.partial({ frequencyMinutes: true }).transform(settings => ({
  ...settings, frequencyMinutes: settings.frequencyMinutes ?? sourceCardDefaultFrequencyMinutes(settings.kind),
}));
type SourceBoundary = Pick<RegisteredSourceSettings, 'url' | 'kind' | 'allowedPath'>;
export function sourceCardAllowsUrl(settings: SourceBoundary, candidate: string | URL): boolean {
  try {
    const entry = new URL(settings.url), target = new URL(candidate, entry);
    target.hash = '';
    if (target.origin !== entry.origin || target.protocol !== 'https:' || target.username || target.password || !safePath(target.pathname)) return false;
    if (target.href === entry.href) return true;
    if (settings.kind === 'document') return false;
    const root = (settings.allowedPath ?? entry.pathname).replace(/\/+$/u, '');
    return target.pathname === root || target.pathname.startsWith(root + '/');
  } catch { return false; }
}
export const registeredSourceResultSchema = z.strictObject({
  status: z.enum(['changed', 'unchanged', 'failed', 'needs_login', 'payment_required', 'mfa_required', 'captcha_required']),
  documentCount: z.int().nonnegative().optional(),
  savedDocumentCount: z.int().nonnegative().optional(),
  indexedDocumentCount: z.int().nonnegative().optional(),
});
export const registeredSourceCardSchema = registeredSourceSettingsSchema.extend({
  cardId: z.uuid(), revision, enabled: z.boolean(), credentialRef: z.uuid().nullable(), checking: z.boolean(),
  lastCheckedAt: timestamp.nullable(), nextCheckAt: timestamp.nullable(), lastResult: registeredSourceResultSchema.nullable(),
});
const identity = { cardId: z.uuid(), operationId: z.uuid(), expectedRevision: revision };
export const registeredSourceCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...identity, action: z.literal('create'), expectedRevision: z.literal(0), settings: newSourceSettings }),
  z.strictObject({ ...identity, action: z.literal('update'), settings: registeredSourceSettingsSchema }),
  z.strictObject({ ...identity, action: z.literal('set_enabled'), enabled: z.boolean() }),
  z.strictObject({ ...identity, action: z.literal('check_now') }),
  z.strictObject({ ...identity, action: z.literal('remove') }),
]);
export type RegisteredSourceSettings = z.infer<typeof registeredSourceSettingsSchema>;
export type RegisteredSourceCard = z.infer<typeof registeredSourceCardSchema>;
export type RegisteredSourceResult = z.infer<typeof registeredSourceResultSchema>;
export type RegisteredSourceCommand = z.infer<typeof registeredSourceCommandSchema>;
export function sourceCardAuthorizationPath(cardId: string) {
  return '/memory?sourceCard=' + z.uuid().parse(cardId) + '&sourceAction=authorize';
}
