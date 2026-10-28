import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { handleSharingControlRequest } from '../server/sharing-control-api.ts';
import { createSharingApi, SharingApiError } from '../src/client/sharing-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

test('class control uses the real API for a bounded roster, original receipts and current access', async () => {
  const fixture = serialFirestoreFixture();
  const options = {database:fixture.database, cipher:createStorageCipher(Buffer.alloc(32, 61)),
    projectId:'demo-class-control', namespace:'class_control', serverClock:()=>Date.parse('2026-10-28T10:00:00Z')};
  const authority=createFirestoreAuthority(options), store=createFirestoreSharingStore(options);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  for (const userId of ['teacher','viewer','outsider']) {
    await authority.issueInvitation({email:userId+'@example.test',expiresAt:'2026-10-30T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email:userId+'@example.test',emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const api=createSharingApi('http://localhost',async (url, init)=>{
    const request=new Request(url,init), userId=request.headers.get('x-expected-user-id')!;
    try { return await handleSharingControlRequest(request,userId,store,async()=>true,request=>request.json()); }
    catch (error) {const failure=error as {status?:number;code?:string};
      return Response.json({error:{code:failure.code??'unexpected_error'}},{status:failure.status??500});}
  }), signal=new AbortController().signal;
  const created=await api.submit({action:'create',kind:'class',name:'Class A',operationId:randomUUID()},'teacher',signal);
  let classroom=created.space!;
  const ids:string[]=[], commands:Parameters<typeof api.submit>[0][]=[];
  for(let i=0;i<50;i++) {
    const command={action:'addClassChild' as const,operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
      displayName:i===4||i===36?'阿晴':'Learner '+i};
    const result=await api.submit(command,'teacher',signal);
    assert.ok(result.childId);ids.push(result.childId);commands.push(command);classroom=result.space!;
  }
  assert.equal((await api.submit(commands[0],'teacher',signal)).childId,ids[0]);
  assert.equal((await api.operation(commands[0].operationId,'teacher',signal))?.childId,ids[0]);
  assert.equal((await api.spaces('teacher',signal)).items.length,0,'the original family list does not mix in classes');
  assert.equal((await api.classes('teacher',signal)).items[0].id,classroom.id);
  const seen:string[]=[], found:string[]=[];
  for(const query of ['', '阿晴']) {
    let cursor:string|undefined;
    do {
      const page=await api.roster(classroom.id,'teacher',signal,cursor,query);
      assert.ok(page.items.length<=20);
      assert.ok(page.items.every(item=>!item.canWithdraw),'roster entries are not personal shares');
      (query?found:seen).push(...page.items.map(item=>item.childId));
      if(cursor===undefined&&page.nextCursor) {
        await assert.rejects(api.roster(classroom.id,'teacher',signal,page.nextCursor,query+'other'),
          (error:unknown)=>error instanceof SharingApiError&&error.code==='invalid_cursor');
      }
      cursor=page.nextCursor??undefined;
    }while(cursor);
  }
  assert.equal(seen.length,50);assert.equal(new Set(seen).size,50);assert.equal(found.length,2);
  const child=await api.child(classroom.id,ids[0],'teacher',signal);
  assert.equal(child.childId,ids[0]);
  await assert.rejects(api.roster(classroom.id,'outsider',signal),(e:unknown)=>e instanceof SharingApiError&&e.status===403);
  await assert.rejects(api.submit({...commands[0],operationId:randomUUID()},'teacher',signal),
    (e:unknown)=>e instanceof SharingApiError&&e.code==='version_conflict');
  const invitation=await api.submit({action:'invite',spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),
    email:'viewer@example.test',role:'viewer',expiresAt:'2026-10-30T00:00:00Z'},'teacher',signal);
  const joined=await api.submit({action:'acceptInvitation',operationId:randomUUID(),token:invitation.invitationToken!},'viewer',signal);
  classroom=joined.space!;
  const first=await api.roster(classroom.id,'viewer',signal);
  assert.equal(first.items.length,20);
  await assert.rejects(api.submit({action:'addClassChild',operationId:randomUUID(),spaceId:classroom.id,
    expectedVersion:classroom.version,displayName:'Not permitted'},'viewer',signal),
    (e:unknown)=>e instanceof SharingApiError&&e.code==='read_only');
  await api.submit({action:'updateMember',operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    targetUserId:'viewer',role:null},'teacher',signal);
  await assert.rejects(api.roster(classroom.id,'viewer',signal,first.nextCursor!),
    (e:unknown)=>e instanceof SharingApiError&&e.status===403);
  const old=await api.operation(joined.operationId,'viewer',signal);
  assert.equal(old?.redacted,true);assert.equal(old?.space,null);
});
