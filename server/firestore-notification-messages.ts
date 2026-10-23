import { z } from 'zod';
import type { Query } from '@google-cloud/firestore';
import { notificationMessageSchema, notificationMessagesPageSchema, type NotificationMessage } from '../src/shared/notification-messages.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { firestorePushDeliverySchema } from './firestore-web-push.ts';
import { firestoreNativeDeliverySchema } from './firestore-native-push.ts';
import { firestoreTelegramDeliverySchema } from './firestore-telegram.ts';
import { firestoreContactRequestSchema } from './firestore-contact.ts';

const definitions = [
  ['push_deliveries', 'push-delivery', 'deliveryId', 'web_push'],
  ['native_push_deliveries', 'native-push-delivery', 'deliveryId', 'native_push'],
  ['telegram_deliveries', 'telegram-delivery', 'deliveryId', 'telegram'],
  ['contact_requests', 'contact-request', 'requestId', 'contact'],
] as const;
const position = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();
const positions = z.array(z.object({ after: position.nullable(), done: z.boolean() }).strict()).length(4);
const querySchema = z.object({ scopeVersion: z.string().regex(/^[a-f0-9]{64}$/u).optional(), cursor: z.string().min(1).max(16000).optional() }).strict();
const cursorSchema = z.object({ v: z.literal(1), userId: z.string(), scopeVersion: z.string(), asOf: z.iso.datetime(), positions }).strict();
const scopeVersion = (binding: FirestoreAuthorityTransaction) => firestoreDomainHash([
  'notification-messages:1', binding.scope, binding.authorizationVersion, binding.childAccessVersion,
]);

/** Bounded live merge of saved acceptance evidence, not a reconstruction of the delivery ledger. */
export function createFirestoreNotificationMessages(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const aad = (owner: string) => 'notification-messages-cursor:1:' + owner;
  function decode(raw: string, owner: string) {
    try {
      const bytes = Buffer.from(raw, 'base64url');
      if (bytes.toString('base64url') !== raw) throw new Error();
      return cursorSchema.parse(JSON.parse(options.cipher.decrypt(bytes.toString(), aad(owner))));
    } catch { return domainReject('invalid_message_cursor', 400); }
  }
  const encode = (value: z.infer<typeof cursorSchema>) => Buffer.from(options.cipher.encrypt(JSON.stringify(value), aad(value.userId))).toString('base64url');
  async function page(owner: string, raw: unknown) {
    if (options.messageHistoryEnabled !== true) domainReject('message_history_unavailable', 503);
    const input = domainParse(querySchema, raw);
    if (input.cursor && !input.scopeVersion) domainReject('invalid_message_cursor', 400);
    const previous = input.cursor ? decode(input.cursor, owner) : null;
    await authority.activateNotificationMessageHistory(owner);
    const result = await authority.runTransaction(owner, null, async binding => {
      const version = scopeVersion(binding), tags = data.tags(binding.scope);
      if (input.scopeVersion && input.scopeVersion !== version) domainReject('messages_scope_changed');
      if (previous && (previous.userId !== owner || previous.scopeVersion !== version)) domainReject('invalid_message_cursor', 400);
      const asOf = previous?.asOf ?? new Date().toISOString();
      // A retried transaction must start from the same input, not the discarded attempt's progress.
      const cursor = previous ? structuredClone(previous.positions) : definitions.map(() => ({ after: null, done: false }));
      const streams = await Promise.all(definitions.map(async ([suffix, , field], index) => {
        if (cursor[index].done) return [];
        let query: Query = data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag)
          .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag);
        if (suffix !== 'contact_requests') query = query.where('childTag', '==', tags.childTag);
        // The range also excludes legacy rows with no captured message sort field.
        query = query.where('messageSentAt', '<=', asOf).orderBy('messageSentAt', 'desc').orderBy(field, 'desc').limit(21);
        if (cursor[index].after) query = query.startAfter(cursor[index].after!.at, cursor[index].after!.id);
        const found = await binding.transaction.get(query);
        return found.docs.map(row => ({ row, position: domainParse(position, { at: row.get('messageSentAt'), id: row.get(field) }, 'message_content_binding', 500) }));
      }));
      const offsets = definitions.map(() => 0), items: NotificationMessage[] = [];
      for (let scanned = 0; scanned < 20; scanned++) {
        let selected = -1;
        for (let index = 0; index < streams.length; index++) {
          const next = streams[index][offsets[index]]; if (!next) continue;
          const current = selected < 0 ? null : streams[selected][offsets[selected]];
          if (!current || next.position.at > current.position.at || next.position.at === current.position.at
            && (next.position.id > current.position.id || next.position.id === current.position.id && index < selected)) selected = index;
        }
        if (selected < 0) break;
        const { row, position: next } = streams[selected][offsets[selected]++];
        const [suffix, kind, , channel] = definitions[selected]; cursor[selected].after = next;
        const body = row.data(), { context, value } = openRecoveryEnvelope({ ...options, locator: body.recovery,
          envelope: { family: 'domain', version: body.version, recordVersion: body.recordVersion, ciphertext: body.ciphertext } });
        if (context.kind !== kind || context.id !== next.id || data.ref(suffix, kind, context.id).path !== row.ref.path
          || context.scope.ownerUserId !== owner || context.scope.workspaceId !== binding.scope.workspaceId
          || context.scope.storageEpoch !== binding.scope.storageEpoch
          || Object.entries(data.tags(context.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('message_content_binding', 500);
        let item: NotificationMessage;
        if (channel === 'contact') {
          const saved = firestoreContactRequestSchema.parse(value);
          if (saved.request.id !== next.id || saved.reminderId !== next.id) domainReject('message_content_binding', 500);
          const child = await binding.readChild(context.scope.childId); if (!child) continue;
          const messages = saved.messages ?? [];
          for (const evidence of messages) {
            const attempt = saved.request.attempts.find(attempt => attempt.id === evidence.attemptId);
            if (!attempt || attempt.status !== 'accepted' || evidence.recipientUserId !== attempt.recipientUserId
              || evidence.content.channel !== attempt.channel) domainReject('message_content_binding', 500);
          }
          const contents = messages.filter(message => message.recipientUserId === owner).map(message => message.content);
          if (!contents.length) continue;
          item = { messageId: 'contact:' + next.id, contentVersion: 1,
            scope: { kind: 'child', childId: child.id, childName: child.displayName }, sentAt: next.at, contents };
        } else {
          if (context.scope.childId !== binding.scope.childId) domainReject('message_content_binding', 500);
          const saved = channel === 'web_push' ? firestorePushDeliverySchema.parse(value)
            : channel === 'native_push' ? firestoreNativeDeliverySchema.parse(value) : firestoreTelegramDeliverySchema.parse(value);
          if (saved.delivery.id !== next.id || saved.delivery.status !== 'accepted' || !saved.message
            || saved.message.channel !== channel) domainReject('message_content_binding', 500);
          item = { messageId: channel + ':' + next.id, contentVersion: 1, scope: { kind: 'account' }, sentAt: next.at, contents: [saved.message] };
        }
        if (item.sentAt !== item.contents.map(content => content.sentAt).sort()[0]
          || new Set(item.contents.map(content => content.channel)).size !== item.contents.length) domainReject('message_content_binding', 500);
        items.push(domainParse(notificationMessageSchema, item, 'message_content_binding', 500));
      }
      for (let index = 0; index < streams.length; index++)
        if (offsets[index] === streams[index].length && streams[index].length < 21) cursor[index].done = true;
      const complete = cursor.every(stream => stream.done);
      return notificationMessagesPageSchema.parse({ schemaVersion: 1, userId: owner, scopeVersion: version, asOf, items, complete,
        nextCursor: complete ? null : encode({ v: 1, userId: owner, scopeVersion: version, asOf, positions: cursor }),
        coverage: { kind: 'recorded_provider_acceptances', historical: 'unknown',
          excluded: ['authentication_email', 'unconfirmed_or_unsaved_sends'], pagination: 'live' } });
    });
    // Recheck the account and every returned child, including deletion barriers, after the page read.
    await authority.runTransaction(owner, null, async binding => {
      if (scopeVersion(binding) !== result.scopeVersion) domainReject('messages_scope_changed');
      for (const item of result.items) if (item.scope.kind === 'child' && !await binding.readChild(item.scope.childId)) domainReject('messages_scope_changed');
    });
    return result;
  }
  return { page };
}
