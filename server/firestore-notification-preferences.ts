import { z } from 'zod';
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema, type NotificationPreferences } from '../src/shared/family.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject } from './firestore-domain-data.ts';

export const storedNotificationPreferences = notificationPreferencesSchema.extend({ version: z.number().int().positive().max(2147483647) });
const preferencesInput = storedNotificationPreferences.omit({ version: true }).extend({
  expectedVersion: z.number().int().nonnegative().max(2147483646),
}).strict().refine(value => value.quietStart !== value.quietEnd);

export function sameNotificationPreferences(a: NotificationPreferences, b: NotificationPreferences) {
  return a.timeZone === b.timeZone && a.quietStart === b.quietStart && a.quietEnd === b.quietEnd
    && a.allowAppointmentDuringQuiet === b.allowAppointmentDuringQuiet;
}

export function createNotificationPreferencesData(data: FirestoreDomainData) {
  const kind = 'notification-preferences';
  const ref = (owner: string) => data.ref('notification_preferences', kind, owner);
  async function read(b: FirestoreAuthorityTransaction) {
    const { scope } = b;
    if (scope.ownerUserId !== b.actorUserId || scope.childId !== '00000000-0000-0000-0000-000000000000') domainReject('preferences_binding', 500);
    const snapshot = await b.transaction.get(ref(scope.ownerUserId));
    if (!snapshot.exists) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    for (const [key, value] of Object.entries(data.tags(scope)))
      if (snapshot.get(key) !== value) domainReject('projection_binding', 500);
    const prefs = data.open(kind, scope.ownerUserId, scope, storedNotificationPreferences, snapshot);
    if (prefs.version !== snapshot.get('recordVersion')) domainReject('preferences_binding', 500);
    return prefs;
  }
  async function prepare(b: FirestoreAuthorityTransaction, opId: string, raw: unknown, current: NotificationPreferences) {
    const { expectedVersion, ...values } = domainParse(preferencesInput, raw);
    if (current.version !== expectedVersion) domainReject('version_conflict');
    const preferences = { ...values, version: expectedVersion + 1 };
    const change = await b.prepareChange(opId, 'preferences', false);
    const envelope = { ...data.tags(b.scope), ...data.seal(kind, b.actorUserId, b.scope, storedNotificationPreferences, preferences, preferences.version) };
    return { preferences, changeSeq: change.changeSeq, commit() {
      change.commit(); b.transaction.set(ref(b.actorUserId), envelope);
    } };
  }
  return { read, prepare };
}
