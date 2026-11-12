import type { DocumentSnapshot, Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { PushDelivery } from '../src/shared/web-push.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainUuid } from './firestore-domain-data.ts';
import { prepareFirestoreBackgroundWork } from './firestore-background-work.ts';

const uuid = z.uuid(), NIL = '00000000-0000-0000-0000-000000000000';
type ChatQueueItem = {delivery: PushDelivery; bindingVersion: number; generation: string; authorizationVersion: string;
  attempt: null; chatSession?: string; chatTarget: {childId: string; messageId: string}};
export function createChatNotificationQueue(data: FirestoreDomainData, config: {
  kind: 'push' | 'native-push'; bindings:string; identity:string; deliveries:string; record:string;
  recipient(b: Binding,id: string): Promise<{id:string; version:number; sessionHash?:string} | null>;
  read(b: Binding,row: DocumentSnapshot,id: string): {delivery:PushDelivery; chatTarget?: ChatQueueItem['chatTarget']; chatReason?: string|null};
  envelope(b: Binding,value: ChatQueueItem): FirebaseFirestore.DocumentData;
  dispatch?: (id: string) => Promise<unknown>;
}) {
  const personal = (b: Binding): Binding => ({ ...b, scope: { ...b.scope, childId: NIL } });
  function own(b: Binding) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('private_scope_unavailable', 403);
  }
  async function prepareChatDeliveries(b: Binding, messageId: string) {
    own(b); domainParse(uuid, messageId);
    if (b.scope.childId === NIL) domainReject('invalid_scope', 400);
    if (!await b.readChild(b.scope.childId)) domainReject('not_found', 404);
    const p = personal(b);
    let query: Query = data.collection(config.bindings);
    for (const [key, value] of Object.entries(data.tags(p.scope))) query = query.where(key, '==', value);
    const rows = await b.transaction.get(query.where('status', '==', 'active').limit(5));
    const writes: (() => void)[] = [], ids: string[] = [], createdAt = new Date(Date.now()).toISOString();
    for (const row of rows.docs) {
      const subscribed = await config.recipient(p, row.get('bindingId'));
      if (!subscribed) continue;
      const id = firestoreDomainUuid([config.identity, p.scope, b.scope.childId, messageId, subscribed.id]);
      const ref = data.ref(config.deliveries, config.record, id), existing = await b.transaction.get(ref);
      if (existing.exists) {
        const saved = config.read(p, existing, id);
        if (saved.delivery.id !== id || saved.delivery.bindingId !== subscribed.id
          || saved.chatTarget?.childId !== b.scope.childId || saved.chatTarget.messageId !== messageId) domainReject('push_binding', 500);
        ids.push(id); continue;
      }
      const saved: ChatQueueItem = { delivery: { id, bindingId: subscribed.id, status: 'queued', reason: null, providerStatus: null,
        createdAt, attemptedAt: null, finishedAt: null }, bindingVersion: subscribed.version, generation: b.generation,
        authorizationVersion: b.authorizationVersion, attempt: null, ...(subscribed.sessionHash ? {chatSession:subscribed.sessionHash} : {}), chatTarget: { childId: b.scope.childId, messageId } };
      const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: config.kind, scope: p.scope, resourceId: id,
        basis: id, generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
      writes.push(() => {
        b.transaction.create(ref, config.envelope(p, saved)); job.commit();
        if (config.dispatch) b.afterCommit?.(() => config.dispatch!(job.id));
      }); ids.push(id);
    }
    return { ids, commit() { for (const write of writes) write(); } };
  }
  async function readChatDeliveryStatuses(b: Binding, raw: string[]) {
    own(b); const ids = domainParse(z.array(uuid).max(5), raw), p = personal(b);
    const result: { id: string; status: PushDelivery['status']; reason: string | null }[] = [];
    for (const id of new Set(ids)) {
      const row = await b.transaction.get(data.ref(config.deliveries, config.record, id));
      if (!row.exists || Object.entries(data.tags(p.scope)).some(([key, value]) => row.get(key) !== value)) continue;
      const saved = config.read(p, row, id);
      if (saved.delivery.id !== id) domainReject('push_binding', 500);
      if (!saved.chatTarget || b.scope.childId !== NIL && saved.chatTarget.childId !== b.scope.childId) continue;
      result.push({ id, status: saved.delivery.status, reason: saved.chatReason ?? saved.delivery.reason });
    }
    return result;
  }
  return {prepareChatDeliveries, readChatDeliveryStatuses};
}

/** Both channels prepare reads before either channel writes inside the message transaction. */
export function combineChatNotificationChannels(native: ReturnType<typeof createChatNotificationQueue>, web: ReturnType<typeof createChatNotificationQueue>) {
  return {
    async prepareChatDeliveries(b:Binding,messageId:string) {
      const [app,browser] = await Promise.all([native.prepareChatDeliveries(b,messageId),web.prepareChatDeliveries(b,messageId)]);
      return {ids:[...app.ids,...browser.ids],commit(){app.commit(); browser.commit();}};
    },
    async readChatDeliveryStatuses(b:Binding,raw:string[]) {
      const ids=domainParse(z.array(uuid).max(10),raw);
      const result=[];
      for (let offset=0;offset<ids.length;offset+=5) {
        const slice=ids.slice(offset,offset+5);
        const app=await native.readChatDeliveryStatuses(b,slice);
        const browserIds=slice.filter(id=>!app.some(row=>row.id===id));
        const browser=browserIds.length ? await web.readChatDeliveryStatuses(b,browserIds) : [];
        result.push(...app.map(row=>({...row,channel:'native_push' as const})),...browser.map(row=>({...row,channel:'web_push' as const})));
      }
      return result;
    }
  };
}
