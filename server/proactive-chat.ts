import { z } from 'zod';
import type { ChatMessage } from '../src/shared/chat.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid, type FirestoreDomainData } from './firestore-domain-data.ts';
import type { FirestoreNativePush } from './firestore-native-push.ts';
import { messageText } from './chat-message-schema.ts';

const origin = z.enum(['demo', 'daily', 'followup', 'task']);
const contactSchema = z.object({ opId: z.uuid(), origin, text: messageText.refine(s => s.trim().length > 0), runId: z.uuid().optional() }).strict();
type Contact = z.infer<typeof contactSchema>;
export const proactiveReceiptSchema = z.object({ proactive: z.literal(true), opId: z.uuid(), origin, messageId: z.uuid(),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/u), deliveryIds: z.array(z.uuid()).max(10), seenAt: z.iso.datetime().nullable() }).strict();
export function proactiveMessageId(owner: string, child: string, source: Contact['origin'], opId: string) {
  return firestoreDomainUuid(['contact-parent', owner, child, source, opId]);
}
type ReadMessage = (b: Binding, childId: string, messageId: string) => Promise<ChatMessage | null>;
type PrepareMessage = (b: Binding, message: ChatMessage, opId: string) => Promise<{commit():void}>;
export function createParentContact(data: FirestoreDomainData, read: ReadMessage, prepare: PrepareMessage, notifications?: Pick<FirestoreNativePush,'prepareChatDeliveries'>) {
  async function original(b: Binding, id: string) {
    if (b.sharedAccess || b.scope.ownerUserId !== b.actorUserId || !await b.readChild(b.scope.childId)) domainReject('not_found', 404);
    const key = JSON.stringify([b.actorUserId, b.scope.childId, 'proactive', domainParse(z.uuid(), id)]);
    const ref = data.ref('chat_replies','chat-reply',key), row = await b.transaction.get(ref);
    const receipt = row.exists ? data.open('chat-reply',key,b.scope,proactiveReceiptSchema,row) : null;
    if (receipt && (receipt.messageId !== id || id !== proactiveMessageId(b.actorUserId,b.scope.childId,receipt.origin,receipt.opId))) domainReject('chat_binding',500);
    return { key, ref, receipt };
  }
  const seal = (b: Binding,key: string,r: z.infer<typeof proactiveReceiptSchema>) =>
    ({...data.tags(b.scope), ...data.seal('chat-reply',key,b.scope,proactiveReceiptSchema,r)});
  async function getContact(b: Binding, source: Contact['origin'], opId: string) {
    const messageId = proactiveMessageId(b.actorUserId,b.scope.childId,source,domainParse(z.uuid(),opId));
    const {receipt} = await original(b,messageId);
    if (!receipt) return null;
    const message = await read(b,b.scope.childId,messageId);
    if (!message?.proactive) domainReject('not_found',404);
    return {opId,messageId,text:message.text,deliveryIds:receipt.deliveryIds,seenAt:receipt.seenAt};
  }
  async function prepareParentContact(b: Binding, input: Contact) {
      const request = domainParse(contactSchema,input), {opId,origin:source,text,runId} = request;
      const messageId = proactiveMessageId(b.actorUserId,b.scope.childId,source,opId);
      const {receipt,key,ref} = await original(b,messageId), requestHash = firestoreDomainHash(request);
      if (receipt) {
        if (receipt.requestHash !== requestHash) domainReject('operation_conflict',409);
        if (!(await read(b,b.scope.childId,messageId))?.proactive) domainReject('not_found',404);
        return {receipt:{opId,messageId,text,deliveryIds:receipt.deliveryIds,seenAt:receipt.seenAt},commit() {}};
      }
      const message = await prepare(b,{id:messageId, childId:b.scope.childId, authorUserId:null, role:'model',
        text,inReplyTo:null,proactive:true,createdAt:new Date().toISOString(),...(runId ? {agentRunId:runId} : {})},messageId);
      const dispatch = await notifications?.prepareChatDeliveries(b,messageId), deliveryIds = dispatch?.ids ?? [];
      const saved = seal(b,key,{proactive:true,origin:source,opId,messageId,requestHash,deliveryIds,seenAt:null});
      return {receipt:{opId,messageId,text,deliveryIds,seenAt:null},commit() {
        message.commit(); dispatch?.commit(); b.transaction.create(ref,saved);
      }};
  }
  return { getContact,prepareParentContact,
    async contactParent(b:Binding,input:Contact) {
      const prepared = await prepareParentContact(b,input);
      prepared.commit();
      return prepared.receipt;
    },
    async markSeen(b: Binding, id: string) {
      const message = await read(b,b.scope.childId,id);
      if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || message?.role !== 'model') domainReject('not_found',404);
      if (message.proactive) {
        const {receipt,key,ref} = await original(b,id);
        if (!receipt) domainReject('not_found',404);
        if (!receipt.seenAt) b.transaction.set(ref,seal(b,key,{...receipt,seenAt:new Date().toISOString()}));
      }
      return {seen:true as const};
    },
  };
}
