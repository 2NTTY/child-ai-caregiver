import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { assistantTaskScopeSchema } from '../src/shared/assistant-task-context.ts';
import { mixedChatAppendSchema, mixedChatCreateSchema, type MixedChatRoom, type MixedChatMessage } from '../src/shared/mixed-chat.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, FirestoreDomainError, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { mixedRecordId, validMixedRecord, mixedRoomRecordSchema, mixedMessageRecordSchema, type MixedRoomRecord, type MixedMessageRecord } from './mixed-chat-records.ts';

type Binding = FirestoreAuthorityTransaction;
type Selection = Pick<MixedChatRoom, 'scope'|'childIds'>;
const roomPageSize=3, messagePageSize=16;

function publicRoom({id, version, scope, childIds, createdAt, updatedAt}:MixedRoomRecord):MixedChatRoom {
  return {id,version,scope,childIds,createdAt,updatedAt};
}
function publicMessage({id,roomId,version,role,text,createdAt}:MixedMessageRecord):MixedChatMessage {
  return {id,roomId,version,role,text,createdAt};
}
export function createFirestoreMixedChat(options:FirestoreDomainOptions) {
  const authority=createFirestoreAuthority(options), sharing=createFirestoreSharingStore(options), data=new FirestoreDomainData(options);
  const roomRef=(id:string)=>data.ref('mixed_rooms','mixed-room',id);
  const messageRef=(id:string)=>data.ref('mixed_messages','mixed-message',id);

  function matchesActor(b:Binding,row:DocumentSnapshot) {
    return row.exists && Object.entries(data.tags(b.scope)).every(([key,value])=>row.get(key)===value);
  }
  function openRoom(b:Binding,row:DocumentSnapshot,id:string) {
    if (!matchesActor(b,row)) domainReject('not_found',404);
    const value=data.open('mixed-room',id,b.scope,mixedRoomRecordSchema,row);
    if (row.id !== roomRef(id).id || row.get('roomId') !== id
      || !validMixedRecord('mixed-room',id,b.scope,row.get('recordVersion'),value)) domainReject('mixed_chat_binding',500);
    return value;
  }
  function openMessage(b:Binding,row:DocumentSnapshot,id:string,room:MixedRoomRecord) {
    if (!matchesActor(b,row)) domainReject('not_found',404);
    const value=data.open('mixed-message',id,b.scope,mixedMessageRecordSchema,row);
    if (!validMixedRecord('mixed-message',id,b.scope,row.get('recordVersion'),value) || value.roomId !== room.id
      || firestoreDomainHash([value.scope,value.childIds]) !== firestoreDomainHash([room.scope,room.childIds])) domainReject('not_found',404);
    return value;
  }
  async function checkSelection(b:Binding, selection:Selection, expected?:z.infer<typeof assistantTaskScopeSchema>) {
    let membership:MixedRoomRecord['membership']=null;
    const versions:string[]=[];
    let taskScope:z.infer<typeof assistantTaskScopeSchema>={kind:'personal'};
    for (const childId of selection.childIds) {
      if (selection.scope.kind === 'personal') {
        if (!await b.readChild(childId)) domainReject('not_found',404);
      } else {
        membership=await sharing.inResourceTransaction(b,{spaceId:selection.scope.spaceId,childId,module:'tasks',mode:'read'},async access=>{
          const member=access.binding.sharedAccess?.classMember;
          if (!member) domainReject('class_required',403);
          if (expected?.kind === 'class' && (access.basis.spaceVersion !== expected.spaceVersion
            || (access.basis.teacherSpaceVersion ?? null) !== expected.teacherSpaceVersion)) domainReject('sharing_scope_changed');
          versions.push(firestoreDomainHash([childId,access.basis,access.binding.changeSeq]));
          taskScope={kind:'class',spaceId:member.spaceId,spaceVersion:access.basis.spaceVersion,teacherSpaceVersion:access.basis.teacherSpaceVersion ?? null};
          return {membershipId:member.membershipId,membershipScopeId:member.membershipScopeId};
        });
      }
    }
    return {membership,taskScope,basis:firestoreDomainHash([b.authorizationVersion,b.changeSeq,selection.scope,selection.childIds,versions])};
  }
  async function authorizeRoom(b:Binding,room:MixedRoomRecord) {
    const current=await checkSelection(b,room);
    if (current.membership?.membershipId !== room.membership?.membershipId || current.membership?.membershipScopeId !== room.membership?.membershipScopeId)
      domainReject('sharing_scope_changed',403);
    return current;
  }
  async function readRoom(b:Binding,id:string) {
    const room=openRoom(b,await b.transaction.get(roomRef(id)),id);
    await authorizeRoom(b,room);
    return room;
  }
  function sealRoom(b:Binding,room:MixedRoomRecord) {
    return {...data.tags(b.scope), roomId:room.id, ...data.seal('mixed-room',room.id,b.scope,mixedRoomRecordSchema,room,room.version)};
  }
  function readMessageIn(b:Binding,room:MixedRoomRecord,id:string) {
    return b.transaction.get(messageRef(id)).then(row=>openMessage(b,row,id,room));
  }

  return {
    async sourceIn(b:Binding,roomId:string,messageId:string,includeEarlier=false) {
      if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || b.scope.childId !== '00000000-0000-0000-0000-000000000000')
        domainReject('private_scope_unavailable',403);
      const room=openRoom(b,await b.transaction.get(roomRef(roomId)),roomId);
      const {basis,taskScope}=await authorizeRoom(b,room);
      const message=await readMessageIn(b,room,messageId), earlier:MixedChatMessage[]=[];
      let previous=message.previousMessageId;
      if (includeEarlier) {
        while (previous && earlier.length<3) {
          const row=await readMessageIn(b,room,previous);
          if (row.version !== message.version-earlier.length-1) domainReject('mixed_chat_binding',500);
          earlier.unshift(publicMessage(row)); previous=row.previousMessageId;
        }
      }
      return {room:publicRoom(room),message:publicMessage(message),basis,taskScope,earlier,hasEarlier:previous!==null};
    },
    async create(userId:string,raw:unknown) {
      const input=domainParse(mixedChatCreateSchema,raw), childIds=[...input.childIds].sort();
      const id=mixedRecordId('mixed-room',userId,input.operationId), fingerprint=firestoreDomainHash({...input,childIds});
      return authority.runTransaction(userId,null,async b=>{
        const ref=roomRef(id), existing=await b.transaction.get(ref);
        if (existing.exists) {
          const room=openRoom(b,existing,id);
          await authorizeRoom(b,room);
          if (room.fingerprint !== fingerprint) domainReject('operation_conflict');
          return {room:publicRoom(room)};
        }
        const scope:MixedChatRoom['scope']=input.scope.kind==='class'?{kind:'class',spaceId:input.scope.spaceId}:{kind:'personal'};
        const {membership}=await checkSelection(b,{scope,childIds},input.scope);
        const change=await b.prepareChange(input.operationId,'chat',false), now=new Date().toISOString();
        const room:MixedRoomRecord={id,scope,childIds,membership,version:1,createdAt:now,updatedAt:now,
          operationId:input.operationId,fingerprint,latestMessageId:null};
        b.transaction.create(ref,sealRoom(b,room)); change.commit();
        return {room:publicRoom(room)};
      });
    },
    async append(userId:string,roomId:string,raw:unknown) {
      const input=domainParse(mixedChatAppendSchema,raw), id=mixedRecordId('mixed-message',userId,input.operationId);
      const fingerprint=firestoreDomainHash([roomId,input]);
      return authority.runTransaction(userId,null,async b=>{
        const room=await readRoom(b,roomId), ref=messageRef(id), old=await b.transaction.get(ref);
        if (old.exists) {
          const message=openMessage(b,old,id,room);
          if (message.fingerprint !== fingerprint) domainReject('operation_conflict');
          return {message:publicMessage(message)};
        }
        if (room.version !== input.expectedVersion) domainReject('version_conflict');
        const change=await b.prepareChange(input.operationId,'chat',false), now=new Date().toISOString();
        const message:MixedMessageRecord={id,roomId,text:input.text,role:'user',version:room.version+1,createdAt:now,
          operationId:input.operationId,fingerprint,scope:room.scope,childIds:room.childIds,previousMessageId:room.latestMessageId};
        const head={...room,version:message.version,updatedAt:now,latestMessageId:id};
        b.transaction.create(ref,{...data.tags(b.scope), ...data.seal('mixed-message',id,b.scope,mixedMessageRecordSchema,message,message.version)});
        b.transaction.set(roomRef(roomId),sealRoom(b,head)); change.commit();
        return {message:publicMessage(message)};
      });
    },
    async detail(userId:string,roomId:string,cursor:string|null) {
      if (cursor) domainParse(z.uuid(),cursor);
      return authority.runTransaction(userId,null,async b=>{
        const room=await readRoom(b,roomId), messages:MixedChatMessage[]=[];
        let id=cursor ?? room.latestMessageId;
        let version=cursor ? null : room.version;
        while (id && messages.length < messagePageSize) {
          const message=openMessage(b,await b.transaction.get(messageRef(id)),id,room);
          if (version !== null && version !== message.version) domainReject('mixed_chat_binding',500);
          messages.push(publicMessage(message)); id=message.previousMessageId; version=message.version-1;
        }
        return {room:publicRoom(room),messages:messages.reverse(),nextCursor:id};
      });
    },
    async list(userId:string,cursor:string|null) {
      if (cursor) domainParse(z.string().regex(/^[a-f0-9]{64}$/u),cursor);
      return authority.runTransaction(userId,null,async b=>{
        let query=data.collection('mixed_rooms').where('userTag','==',data.tags(b.scope).userTag)
          .orderBy(FieldPath.documentId()).limit(roomPageSize+1);
        if (cursor) query=query.startAfter(cursor);
        const rows=await b.transaction.get(query), rooms:MixedChatRoom[]=[];
        for (const row of rows.docs.slice(0,roomPageSize)) {
          if (!matchesActor(b,row)) continue;
          const room=openRoom(b,row,domainParse(z.uuid(),row.get('roomId'),'mixed_chat_binding',500));
          try { await authorizeRoom(b,room); }
          catch (error) {
            if ((error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError) && [403,404].includes(error.status)) continue;
            throw error;
          }
          rooms.push(publicRoom(room));
        }
        return {rooms,nextCursor:rows.size>roomPageSize?rows.docs[roomPageSize-1]!.id:null};
      });
    },
  };
}
