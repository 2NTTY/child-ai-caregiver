import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { Firestore } from '@google-cloud/firestore';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { chatFileObjectAddress, type ChatFileObjects, type ChatFileObjectDescriptor } from '../server/firebase-chat-file-objects.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { readChatFile } from '../server/chat-file-reader.ts';

// One connected lifecycle, not a new per-format or per-platform test matrix.
test('private chat files retain original receipts, linked content and deletion while Word reads stay bounded', async () => {
  const fake = firestoreDomainFixture();
  function query(raw: any): any { return new Proxy(raw, { get(target, key) {
    if (key === 'id') return target.path.split('/').at(-1);
    if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
    const value = target[key]; return typeof value === 'function' ? (...args: any[]) => {
      const result = value(...args); return result?.path ? query(result) : result;
    } : value;
  } }); }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 41)), projectId: 'synthetic-file-project', namespace: 'file_lifecycle' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent','other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const zip = new JSZip(), paragraph = '下星期帶健康手冊到診。';
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + paragraph.repeat(1200) + '</w:t></w:r></w:p></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = new Map<string, ChatFileObjectDescriptor>(); let writes = 0;
  const objects: ChatFileObjects = {
    address: (scope,id) => chatFileObjectAddress({ ...options,bucketName:'synthetic-file-private' },scope,id).objectName,
    async write(scope,id,_base64,mimeType) {
      const objectName = this.address(scope,id); assert.equal(stored.has(objectName),false); writes++;
      stored.set(objectName,{ objectName,generation:'9007199254740993123',cipherSha256:'b'.repeat(64),sha256,bytes:bytes.length,mimeType });
      throw new Error('lost upload reply');
    },
    async inspect(scope,id) { return stored.get(this.address(scope,id)) ?? null; },
    async read(scope,id,descriptor) { assert.deepEqual(stored.get(this.address(scope,id)),descriptor); return { descriptor,buffer:bytes,base64:bytes.toString('base64') }; },
    async remove(scope,id,descriptor) { assert.deepEqual(stored.get(this.address(scope,id)),descriptor); stored.delete(this.address(scope,id)); },
  };
  const intents = new Map<string,FirebaseErasureIntent>();
  const journal: Pick<FirebaseErasureJournal,'writeOnce'|'read'> = {
    async writeOnce(intent) { const hash=firebaseErasureIntentHash(intent);intents.set(hash,intent);
      return {objectName:'erasures/v1/'+hash,generation:'1',cipherSha256:'c'.repeat(64),intentSha256:hash,bytes:1,format:'yuban-erasure-journal/v1'}; },
    async read(intent,proof) { assert.deepEqual(intents.get(proof.intentSha256),intent);return intent; },
  };
  const files = createFirestoreChatFilesStore({ ...options,objects,journal });
  const chat = createFirestoreChatStore({ ...options,files });
  const online = createFirestoreOnlineStore({ ...options,mutations:[chat.mutation] });
  const command = async (path:string,payload:unknown) => ({path,payload,operation:{...await online.context('parent',{path,payload}),opId:randomUUID(),deviceId:randomUUID()}});
  const created = await online.submit('parent',await command('/api/children',{displayName:'Synthetic file child'}));
  const childId = (created.result as any).child.id, id = randomUUID();
  const input = { opId:id,fileName:'到診.docx',bytes:bytes.length,sha256,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const origin='https://files.example.test';let userId='parent';
  const handler=createFirebaseRequestHandler({authority,online,chat,files,publicOrigin:origin,mailConfigured:false,
    auth:{ getSession:async()=>({user:{id:userId}}),handler:async()=>new Response(null,{status:404}) } as unknown as FirebaseAuthPort});
  const request=(path:string,payload?:unknown)=>handler(new Request(origin+path,{method:payload===undefined?'GET':'POST',headers:{origin,'content-type':'application/json','x-expected-user-id':userId},body:payload===undefined?undefined:JSON.stringify(payload)}));
  const path='/api/children/'+childId+'/files';
  const reserved=await (await request(path,input)).json(); assert.equal(reserved.file.id,id);
  assert.deepEqual(await files.reserve('parent',childId,input),reserved.file);
  await assert.rejects(files.reserve('parent',childId,{...input,fileName:'changed.docx'}),(e:any)=>e.code==='operation_conflict');
  assert.equal((await request(path+'/'+id+'/content',{expectedVersion:reserved.file.version,base64:bytes.toString('base64')})).status,503);
  const ready=await (await request(path+'/'+id+'/resolve',{})).json();assert.equal(ready.file.state,'ready');assert.equal(writes,1);
  userId='other';assert.equal((await request(path+'/'+id)).status,403);userId='parent';
  const save=await command('/api/children/'+childId+'/messages',{text:'請整理這份到診資料',file:{id,expectedVersion:ready.file.version}});
  const submitted=await online.submit('parent',save);const message=(submitted.result as any).message;
  assert.equal(message.file.id,id);assert.deepEqual(await online.submit('parent',save),submitted);
  assert.equal((await chat.listForUser('parent',childId))?.messages[0].file?.id,id);
  const content=await files.contentForMessage('parent',childId,message.id,message.file);
  const extracted=await readChatFile({...content,fileName:input.fileName,mimeType:input.mimeType,sha256});
  assert.equal(extracted.state,'read');if(extracted.state!=='read')throw new Error('Word extraction failed');
  assert.ok(extracted.text.startsWith(paragraph));assert.ok(extracted.text.length<=12_000);assert.equal(extracted.complete,false);assert.ok(extracted.next);
  const rest=await readChatFile({...content,fileName:input.fileName,mimeType:input.mimeType,sha256},extracted.next!);
  assert.equal(rest.state,'read');if(rest.state!=='read')throw new Error('Word continuation failed');assert.equal(rest.next,null);
  const download=await request(path+'/'+id+'/content');assert.equal(download.headers.get('content-type'),'application/octet-stream');
  assert.match(download.headers.get('content-disposition')??'',/^attachment;/u);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  const deletion=await files.delete('parent',childId,id,message.file.version,randomUUID());assert.equal(deletion.deleted,true);
  assert.equal((await request(path+'/'+id+'/content')).status,410);
  const intent=[...intents.values()][0];assert.equal(intent.type,'file-delete');assert.equal((await files.cleanupDeleted(intent.scope,id)).state,'complete');
  assert.equal(stored.size,0);assert.equal(writes,1);assert.deepEqual(await online.submit('parent',save),submitted);
});
