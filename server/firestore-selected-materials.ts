import { z } from 'zod';
import { assistantTaskScopeSchema } from '../src/shared/assistant-task-context.ts';
import type { MemoryFact } from '../src/shared/memory.ts';
import type { FamilyDocument } from '../src/shared/family-documents.ts';
import { materialCitationId, materialQuery, materialRef, type MaterialQuery, type MaterialRef, type MaterialCitationPage } from '../src/shared/assistant-material-citation.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';

type Binding = FirestoreAuthorityTransaction;
type MessageSource = Awaited<ReturnType<FirestoreChatStore['mixed']['sourceIn']>>;
type Material = {id:string; version:number; title:string; source:string; text:string};
type Selection = { binding:Binding; childId:string; childName:string; basis:string; nextFrom:number|null };

function fromFact(fact:MemoryFact):Material | null {
  if (fact.status !== 'confirmed' || !fact.applicable || fact.sourceState !== 'current') return null;
  const source = {manual:'手動記錄', care_record:'照護記錄', private_chat:'聊天', imported:'匯入記憶'}[fact.source.kind];
  return {id:fact.id,version:fact.version,title:fact.key,source,text:fact.content};
}

function fromDocument(doc:FamilyDocument):Material | null {
  const snapshot = doc.current;
  if (doc.readState !== 'ready' || doc.status !== 'active' || !snapshot) return null;
  const text = [snapshot.summary, ...snapshot.sections.flatMap(section =>
    [section.title, ...section.items.map(item => item.text)])].filter(Boolean).join('\n');
  return {id:doc.id, version:doc.version, title:snapshot.title, source:'文件版本 ' + snapshot.version, text};
}

export function createSelectedMaterials(options:FirestoreDomainOptions & {chat:FirestoreChatStore;memory:FirestoreMemoryStore}) {
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const documents = (transaction:Binding) => createFirestoreFamilyDocumentStore({...options, transaction, currentOnlyReads:true});

  async function withinSource<T>(actor: Binding, source: MessageSource, messageId:string, from:number,
    kind:MaterialRef['kind'], use:(selection:Selection)=>Promise<T>) {
    const {room,basis} = source;
    const taskScope = domainParse(assistantTaskScopeSchema,source.taskScope,'mixed_chat_binding',500);
    const childId = room.childIds[from];
    if (!childId) domainReject('not_found',404);
    async function read(binding:Binding) {
      const child = await binding.readChild(childId);
      if (!child) domainReject('not_found',404);
      return use({binding,childId,childName:child.displayName,nextFrom:from+1 < room.childIds.length ? from+1 : null,
        basis:firestoreDomainHash([room.id,messageId,from,kind,basis,binding.scope,binding.changeSeq,binding.sharedAccess?.basis ?? null])});
    }
    if (taskScope.kind === 'personal') {
      const child = await authority.assertPersonalSource(actor.transaction,{...actor.scope,childId});
      return read({...actor,scope:child.scope,authorizationVersion:child.authorizationVersion});
    }
    return sharing.inResourceTransaction(actor,{spaceId:taskScope.spaceId,childId,module:kind === 'memory' ? 'memory' : 'documents',mode:'read'}, access => {
      if (!access.binding.sharedAccess?.classMember || access.basis.spaceVersion !== taskScope.spaceVersion
        || (access.basis.teacherSpaceVersion ?? null) !== taskScope.teacherSpaceVersion) domainReject('sharing_scope_changed',403);
      return read(access.binding);
    });
  }

  function withMessage<T>(userId:string,roomId:string,messageId:string,use:(actor:Binding,source:MessageSource)=>Promise<T>) {
    return authority.runTransaction(userId,null,async actor => use(actor,await options.chat.mixed.sourceIn(actor,roomId,messageId)));
  }
  return {
    async search(userId:string,roomId:string,messageId:string,raw:MaterialQuery,maxRows=3) {
      const q = domainParse(materialQuery,raw);
      domainParse(z.int().min(1).max(3),maxRows);
      return withMessage(userId,roomId,messageId,(actor,source) => withinSource(actor,source,messageId,q.from,q.kind,async ({binding,childId,childName,basis,nextFrom}) => {
        const fingerprint = firestoreDomainHash([basis,q.query]);
        if (q.cursor && fingerprint !== q.cursor.basis) domainReject('cursor_changed',409);
        let values:(Material|null)[], after:string|null;
        if (q.kind === 'memory') {
          const page = await options.memory.readSelectedFactPage(binding,q.cursor?.after,maxRows);
          values = page.items.map(fromFact); after = page.nextAfterId;
        } else {
          const page = await documents(binding).list(userId,childId,{status:'active',limit:Math.min(maxRows,2),cursor:q.cursor?.after ?? null});
          if (!page) domainReject('not_found',404);
          values = page.items.map(fromDocument); after = page.nextCursor ?? null;
        }
        const items = values.flatMap(value => {
          if (!value) return [];
          const match = value.text.toLowerCase().indexOf(q.query.toLowerCase());
          if (match < 0 && !value.title.toLowerCase().includes(q.query.toLowerCase())) return [];
          const offset = Math.max(0,match-80);
          const text = value.text.slice(offset,offset+300);
          return [{childId,childName,kind:q.kind,id:value.id,version:value.version,title:value.title,source:value.source,
            text,offset,complete:offset === 0 && text.length === value.text.length,
            citationId:materialCitationId({kind:q.kind,from:q.from,id:value.id,version:value.version,offset})}];
        });
        return {childId,childName,items,nextFrom,nextCursor:after ? {after,basis:fingerprint} : null};
      }));
    },
    readIn,
    read(userId:string,roomId:string,messageId:string,ref:MaterialRef,position?:number) {
      return withMessage(userId,roomId,messageId,(actor,source) => readIn(actor,source,messageId,ref,position));
    },
  };

  async function readIn(actor:Binding,source:MessageSource,messageId:string,raw:MaterialRef,position?:number):Promise<MaterialCitationPage> {
    const ref = domainParse(materialRef,raw);
    const offset = domainParse(z.int().nonnegative(),position ?? ref.offset);
    return withinSource(actor,source,messageId,ref.from,ref.kind,async ({binding,childId,childName}) => {
      let value:Material|null;
      if (ref.kind === 'memory') {
        const fact = await options.memory.readFact(binding,ref.id);
        value = fact && fact.childId === childId && (!binding.sharedAccess || fact.visibility === 'family') ? fromFact(fact) : null;
      } else {
        const doc = await documents(binding).get(actor.actorUserId,childId,ref.id);
        value = doc && doc.childId === childId ? fromDocument(doc) : null;
      }
      if (!value) domainReject('not_found',404);
      if (value.version !== ref.version) domainReject('material_citation_changed',409);
      if (offset > value.text.length) domainReject('invalid_input',400);
      const text = value.text.slice(offset,offset+4000), end = offset+text.length;
      return {citationId:materialCitationId(ref),childId,childName,kind:ref.kind,id:ref.id,version:value.version,
        title:value.title,source:value.source,text,offset,nextOffset:end < value.text.length ? end : null};
    });
  }
}
export type SelectedMaterials = ReturnType<typeof createSelectedMaterials>;
