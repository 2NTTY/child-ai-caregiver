import { z } from 'zod';
import type { Query } from '@google-cloud/firestore';
import type { ChatMessage } from '../src/shared/chat.ts';
import { firestoreChatMessageSchema, firestoreChatMessageStorageSchema, originalChatMessageSchema } from './chat-message-schema.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { readOriginalAttachment } from './handover-original-attachments.ts';
import { readImportMapping } from './handover-import-records.ts';
import type { HandoverAttachmentPorts } from './firestore-handover-attachments.ts';

const positionSchema = z.object({ workspaceId:z.uuid(), sortKey:z.string().regex(/^[0-9]{19}$/u)
  .refine(value => BigInt(value) > 0n && BigInt(value) < 9223372036854775807n) }).strict();
const backupSchema = originalChatMessageSchema.safeExtend({ originalPosition:positionSchema.optional(), version:z.literal(1).optional() });
type Snapshot = { message:ChatMessage; position?:z.infer<typeof positionSchema>; needsLink?:boolean;
  state:'unchanged'|'unavailable'|'backup_newer'|'different'; reason?:string; localVersion:number };

/** Only used after the original-backup issuer and owner have been verified. A handover copy has its own reader. */
export async function inspectOriginalChat(data:FirestoreDomainData, b:Binding, row:HandoverImportRow):Promise<Snapshot> {
  const { originalPosition:position, version:_version, ...message } = backupSchema.parse(row.value);
  if (b.sharedAccess || row.section !== 'chat' || b.actorUserId !== row.source.accountId || b.actorUserId !== b.scope.ownerUserId
    || row.childId !== b.scope.childId || message.childId !== b.scope.childId || (message.role === 'user'
      ? message.authorUserId !== b.actorUserId || message.inReplyTo !== null
      : message.authorUserId !== null || (message.inReplyTo === null) !== !!message.proactive)) domainReject('invalid_import_target',403);
  const stored = await b.transaction.get(data.ref('chat_messages','chat-message',message.id));
  const localVersion = stored.exists ? 1 : 0;
  const unavailable = (reason:string):Snapshot => ({state:'unavailable',message,localVersion,reason});
  const same = (left:ChatMessage,right:ChatMessage) => firestoreDomainHash(left) === firestoreDomainHash(right);
  let live:ChatMessage | null = null;
  const attachment = message.file ?? message.voice ?? message.photo;
  let matchesArchivedMessage = false;
  if (stored.exists) {
    if (Object.entries(data.tags(b.scope)).some(([k,v]) => stored.get(k) !== v)) return unavailable('message_scope_changed');
    live = data.open('chat-message',message.id,b.scope,firestoreChatMessageSchema,stored);
    if (live.id !== message.id || live.childId !== b.scope.childId || stored.get('messageId') !== message.id
      || stored.get('createdAt') !== live.createdAt || stored.get('recordVersion') !== 1) domainReject('chat_binding',500);
    if (position?.workspaceId === b.scope.workspaceId && position.sortKey !== stored.get('sortKey')) return unavailable('original_position_changed');
    matchesArchivedMessage = same(live,message);
    if (matchesArchivedMessage && (!attachment || !position)) return {state:'unchanged',message,localVersion};
  }
  if (!position || position.workspaceId !== b.scope.workspaceId) return unavailable('original_position_unavailable');
  let needsLink = false;
  if (attachment) {
    const section = message.file ? 'files' : message.voice ? 'voices' : 'photos';
    const { mapping } = await readImportMapping(data,b,{ serverId:row.source.serverId,accountId:b.actorUserId,
      childId:b.scope.childId,section,resourceId:attachment.id },true);
    const resolved = await readOriginalAttachment(data,b,section,mapping?.target.id ?? attachment.id);
    const asset = resolved.value;
    if (!asset || asset.bytes !== attachment.bytes || asset.sha256 !== attachment.sha256 || asset.mimeType !== attachment.mimeType
      || message.voice && resolved.durationMs !== message.voice.durationMs) return unavailable('chat_attachment_unavailable');
    if (section !== 'photos' && resolved.messageId !== message.id) {
      if (resolved.messageId || !mapping || asset.id !== mapping.target.id || asset.version !== mapping.target.version)
        return unavailable('chat_attachment_link_changed');
      needsLink = true;
    }
    if (matchesArchivedMessage && asset.id === attachment.id && !needsLink) return {state:'unchanged',message,localVersion};
    const ref = { id:asset.id,version:asset.version };
    if (message.file) message.file = {...message.file,...ref};
    else if (message.voice) message.voice = {...message.voice,...ref};
    else if (message.photo) message.photo = {...message.photo,...ref};
  }
  if (live) {
    if (same(live,message) && !needsLink) return {state:'unchanged',message,localVersion};
    if (matchesArchivedMessage && attachment) return {state:'different',message,position,localVersion,needsLink,reason:'restored_attachment_link'};
    return unavailable('immutable_message_conflict');
  }
  let query:Query = data.collection('chat_messages');
  for (const [key,value] of Object.entries(data.tags(b.scope))) query = query.where(key,'==',value);
  if ((await b.transaction.get(query.where('sortKey','==',position.sortKey).limit(1))).docs.length > 0) return unavailable('original_position_in_use');
  return {state:'backup_newer',message,position,localVersion,needsLink};
}

export async function prepareOriginalChat(data:FirestoreDomainData,b:Binding,snapshot:Snapshot,opId:string,assets?:HandoverAttachmentPorts) {
  if ((snapshot.state !== 'backup_newer' && snapshot.state !== 'different') || !snapshot.position || !b.prepareHistoricalChatChange || b.sharedAccess) domainReject('original_unavailable');
  const message = { ...snapshot.message };
  let link: { commit():void } | undefined;
  if (snapshot.needsLink && message.file && assets?.files) {
    const prepared = await assets.files.prepareLink(b,message.file.id,message.file.version,message.id);
    message.file = prepared.file; link = prepared;
  } else if (snapshot.needsLink && message.voice && assets?.voices) {
    const prepared = await assets.voices.prepareLink(b,message.voice.id,message.voice.version,message.id,'restore');
    message.voice = prepared.voice; link = prepared;
  } else if (snapshot.needsLink) domainReject('chat_attachment_unavailable');
  const context = await prepareContextChange(data,b,{proactive:false});
  const change = await b.prepareHistoricalChatChange(opId,snapshot.position.sortKey);
  const ref = data.ref('chat_messages','chat-message',message.id);
  const local = await b.transaction.get(ref);
  // Public backup rows carry the conversation, but cannot attest that it is still eligible for derived memory.
  const previous = local.exists ? data.open('chat-message',message.id,b.scope,firestoreChatMessageStorageSchema,local) : null;
  const memorySummaryUntil = previous ? previous.memorySummaryUntil : new Date(0).toISOString();
  const body = { ...data.tags(b.scope), messageId:message.id, createdAt:message.createdAt, sortKey:snapshot.position.sortKey,
    ...data.seal('chat-message',message.id,b.scope,firestoreChatMessageStorageSchema,{ ...message,
      ...(memorySummaryUntil && { memorySummaryUntil }), ...(previous?.memorySources && { memorySources: previous.memorySources }) }) };
  return { changeSeq:change.changeSeq, commit() {
    change.commit(); context(); link?.commit();
    if (snapshot.state === 'different') b.transaction.update(ref,body);
    else b.transaction.create(ref,body);
  } };
}
