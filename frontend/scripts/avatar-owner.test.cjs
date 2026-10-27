const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'package.json')), ts = req('typescript');
const cache = new Map();
function compile(file) {
  file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','module','exports',js)(name => {
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(file), name);
    return compile(fs.existsSync(target) ? target : target + '.ts');
  }, module, module.exports); return module.exports;
}
const { AvatarOwner } = compile('frontend/src/production/AvatarOwner.ts');
const { AvatarApiError } = compile('src/client/avatars-api.ts');
const { avatarCropRect, avatarCropFromArea, avatarImageHeader, boundedAvatarCrop } = compile('frontend/src/avatar-image.ts');
const policy = { policyId: 'synthetic-v1', acceptedMimeTypes: ['image/jpeg','image/png'], maxInputBytes: 1024, maxInputPixels: 1e6, maxInputDimension: 2000, outputSize: 256, maxOutputBytes: 1024, maxCropZoom: 8 };
test('cropper percentage selection preserves the Server square on wide and tall images', () => {
  for (const [width, height, area, expected] of [
    [400, 200, { x: 37.5, y: 25, width: 25, height: 50 }, { left: 150, top: 50, size: 100 }],
    [200, 400, { x: 0, y: 50, width: 100, height: 50 }, { left: 0, top: 200, size: 200 }],
    [400, 200, { x: 75, y: 0, width: 25, height: 50 }, { left: 300, top: 0, size: 100 }],
  ]) assert.deepEqual(avatarCropRect(width, height, avatarCropFromArea(width, height, area, 8)), expected);
});
const target = { kind: 'self' }, child = { kind: 'child', childId: '11111111-1111-4111-8111-111111111111' };
const asset = id => ({ id, mimeType: 'image/jpeg', bytes: 3, sha256: 'a'.repeat(64), width: 256, height: 256 });
const avatar = (target, version = 0) => ({ target, version, asset: version ? asset('asset-' + version) : null, canManage: true, updatedAt: version ? '2026-10-23T00:00:00Z' : null });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const calls = [], lost = [], images = [];
  const data = { current: avatar(target, 1), pending: false, receipt: null, reserveFailure: null, commitFailure: null, readFailure: null, uploadWait: null, uploadStarted: deferred() };
  const upload = () => ({ id: 'upload-1', target, expectedVersion: data.current.version, policyId: policy.policyId, state: 'reserved', expiresAt: '2026-10-23T01:00:00Z', normalized: null, errorCode: null });
  let staged;
  const api = {
    read: async (target, signal, userId) => { calls.push(['read',target,userId]); if (data.readFailure) throw data.readFailure; return { avatar: { ...data.current, target }, policy }; },
    content: async (avatar, signal, userId) => { calls.push(['content',avatar.version,userId]); return new Blob([new Uint8Array([1,2,3])], { type: 'image/jpeg' }); },
    reserve: async (target, input) => { calls.push(['reserve',input]); if (data.reserveFailure) { data.pending = true; throw data.reserveFailure; } staged = { ...upload(), target, expectedVersion: input.expectedVersion }; return { upload: staged }; },
    uploadContent: async (upload, base64) => { calls.push(['upload',upload.id,base64]); data.uploadStarted.resolve(); if (data.uploadWait) return data.uploadWait.promise; staged = { ...upload, state: 'ready', normalized: asset('new') }; return staged; },
    commit: async (target, input) => { calls.push(['commit',input]); if (data.commitFailure) { data.pending = true; throw data.commitFailure; } data.current = avatar(target,input.expectedVersion + 1); return { avatar: data.current, cleanupPending: false }; },
    remove: async (target, input) => { calls.push(['remove',input]); data.current = { ...avatar(target,input.expectedVersion+1), asset: null }; return { avatar: data.current, cleanupPending: true }; },
    uploadStatus: async () => staged,
    hasPendingOnline: () => data.pending,
    reconcilePending: async () => { calls.push(['check']); if (data.receipt?.state === 'confirmed') data.pending = false; return data.receipt; },
    resetOnline: target => { calls.push(['reset',target]); data.pending = false; },
  };
  const owner = new AvatarOwner(api, error => lost.push(error), () => true, () => {});
  owner.syncContext({ key: 'identity-a', userId: 'user-a' }, { key: 'child-a', childId: child.childId }, true);
  const image = () => { const value = { uri: 'blob:synthetic', width: 100, height: 80, mimeType: 'image/png', bytes: new Uint8Array([1,2,3]), disposed: 0,
    dispose() { this.disposed++; this.bytes.fill(0); } }; images.push(value); return value; };
  const select = lane => { const value = image(); lane.select(lane.beginSelection(), value); return value; };
  return { owner, lane: owner.self, api, data, calls, lost, images, image, select };
}
test('crop matches oriented server coordinates, clamps and rejects oversized headers before decode', () => {
  assert.deepEqual(avatarCropRect(400,200,{ centerX:.5,centerY:.5,zoom:2 }), { size:100,left:150,top:50 });
  assert.deepEqual(avatarCropRect(200,400,{ centerX:0,centerY:1,zoom:1 }), { size:200,left:0,top:200 });
  assert.deepEqual(boundedAvatarCrop({ centerX:NaN,centerY:9,zoom:Infinity },8), { centerX:.5,centerY:1,zoom:1 });
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]); const view = new DataView(png.buffer); view.setUint32(8,13); png.set([73,72,68,82],12); view.setUint32(16,80); view.setUint32(20,100);
  assert.deepEqual(avatarImageHeader(png,policy), { mimeType:'image/png',width:80,height:100 }); view.setUint32(16,3000); assert.throws(()=>avatarImageHeader(png,policy),/avatar_decode_limit/);
});
test('EXIF mirrored and rotated headers use upright dimensions before crop', () => {
  const jpeg = new Uint8Array(50), v = new DataView(jpeg.buffer);
  jpeg.set([255,216,255,225],0); v.setUint16(4,34); jpeg.set([69,120,105,102,0,0],6);
  jpeg.set([73,73],12); v.setUint16(14,42,true); v.setUint32(16,8,true); v.setUint16(20,1,true);
  v.setUint16(22,274,true); v.setUint16(24,3,true); v.setUint32(26,1,true); v.setUint16(30,6,true);
  jpeg.set([255,192],38); v.setUint16(40,8); jpeg[42]=8; v.setUint16(43,100); v.setUint16(45,80); jpeg.set([255,217],48);
  assert.deepEqual(avatarImageHeader(jpeg,policy), {mimeType:'image/jpeg',width:100,height:80});
  v.setUint16(30,2,true); assert.deepEqual(avatarImageHeader(jpeg,policy), {mimeType:'image/jpeg',width:80,height:100});
});
test('self is independent from child; late picker is disposed after child scope switches', async () => {
  const f=fixture(); try { await f.lane.load(); await f.owner.child.load(); const uri=f.lane.getSnapshot().uri, ticket=f.owner.child.beginSelection();
    f.owner.syncContext({key:'identity-a',userId:'user-a'},{key:'child-b',childId:'22222222-2222-4222-8222-222222222222'},true);
    const image=f.image(); f.owner.child.select(ticket,image); assert.equal(image.disposed,1); assert.equal(f.owner.child.getSnapshot().selected,null);
    assert.equal(f.lane.getSnapshot().uri,uri); assert.equal(f.lane.getSnapshot().key,'identity-a');
  } finally { f.owner.dispose(); }
});
test('successful save only replaces committed image after reserve/content/commit and clears original', async () => {
  const f=fixture(); try { await f.lane.load(); const image=f.select(f.lane); await f.lane.save();
    assert.deepEqual(f.calls.filter(x=>['reserve','upload','commit'].includes(x[0])).map(x=>x[0]),['reserve','upload','commit']);
    assert.equal(f.lane.getSnapshot().avatar.version,2); assert.equal(f.lane.getSnapshot().unknown,false); assert.equal(f.lane.getSnapshot().selected,null); assert.equal(image.disposed,1);
  } finally {f.owner.dispose();}
});

test('save replaces an in-flight refresh without losing its lock or accepting late read state', async () => {
  const f=fixture(); try {
    await f.lane.load(); f.select(f.lane);
    const read=f.api.read, delayed=deferred(); let readSignal;
    f.api.read=async (target,signal,userId) => { readSignal=signal; return delayed.promise; };
    const refresh=f.lane.load(); f.api.read=read;
    f.data.uploadWait=deferred(); const saving=f.lane.save();
    await Promise.race([f.data.uploadStarted.promise,saving.then(()=>{throw Error('Save was dropped during refresh');})]);
    assert.equal(readSignal.aborted,true); assert.equal(f.lane.getSnapshot().busy,true);
    delayed.resolve({avatar:avatar(target,99),policy}); await refresh;
    assert.equal(f.lane.getSnapshot().busy,true); assert.equal(f.lane.getSnapshot().avatar.version,1);
    await f.lane.save(); assert.equal(f.calls.filter(x=>x[0]==='reserve').length,1);
    f.data.uploadWait.resolve({id:'upload-1',target,expectedVersion:1,policyId:policy.policyId,state:'ready',normalized:asset('new'),expiresAt:'2026-10-23T01:00:00Z',errorCode:null});
    await saving; assert.equal(f.lane.getSnapshot().avatar.version,2); assert.equal(f.lane.getSnapshot().busy,false);
  } finally {f.owner.dispose();}
});
test('unknown reserve blocks new writes and retry retains exact original reserve body', async () => {
  const f=fixture(); try {await f.lane.load(); f.select(f.lane); f.data.reserveFailure=new AvatarApiError(); await f.lane.save();
    assert.equal(f.lane.getSnapshot().unknown,true); const body=f.calls.find(x=>x[0]==='reserve')[1]; await f.lane.save(); assert.equal(f.calls.filter(x=>x[0]==='reserve').length,1);
    f.data.receipt={state:'unconfirmed'}; await f.lane.check(); assert.equal(f.lane.getSnapshot().retryAvailable,true);
    f.data.reserveFailure=null; f.data.pending=false; await f.lane.retry(); assert.deepEqual(f.calls.filter(x=>x[0]==='reserve')[1][1],body);
  } finally {f.owner.dispose();}
});
test('unknown commit keeps old avatar; confirmed null rereads current instead of inventing a result', async () => {
  const f=fixture(); try {await f.lane.load(); const old=f.lane.getSnapshot().uri; f.select(f.lane); f.data.commitFailure=new AvatarApiError(); await f.lane.save();
    assert.equal(f.lane.getSnapshot().uri,old); assert.equal(f.lane.getSnapshot().unknown,true);
    f.data.current=avatar(target,2); f.data.receipt={state:'confirmed',kind:'commit',target,result:null}; await f.lane.check();
    assert.equal(f.lane.getSnapshot().avatar.version,2); assert.equal(f.lane.getSnapshot().unknown,false); assert.equal(f.calls.filter(x=>x[0]==='commit').length,1);
  } finally {f.owner.dispose();}
});
test('late upload after logout cannot mutate new identity or commit original image', async () => {
  const f=fixture(); try {await f.lane.load(); const image=f.select(f.lane); const wait=deferred(); f.data.uploadWait=wait; const save=f.lane.save();
    await Promise.race([f.data.uploadStarted.promise, save.then(() => { throw new Error('Save ended before upload'); })]);
    f.owner.syncContext(null,null,true); wait.resolve({id:'old',target,expectedVersion:1,policyId:policy.policyId,state:'ready',normalized:asset('old'),expiresAt:'2026-10-23T01:00:00Z',errorCode:null}); await save;
    assert.equal(f.lane.getSnapshot().key,null); assert.equal(f.lane.getSnapshot().uri,null); assert.equal(image.disposed,1); assert.equal(f.calls.some(x=>x[0]==='commit'),false);
    f.owner.syncContext({key:'identity-b',userId:'user-b'},null,true); await f.lane.load(); assert.equal(f.lane.getSnapshot().selected,null);
  } finally {f.owner.dispose();}
});
test('version conflict requires successful reread and explicit new basis, never automatic rebase', async () => {
  const f=fixture(); try {await f.lane.load(); f.select(f.lane); f.api.reserve=async()=>{throw new AvatarApiError(409,'avatar_version_conflict');}; await f.lane.save();
    assert.equal(f.lane.getSnapshot().conflict,true); f.data.readFailure=new AvatarApiError(); await f.lane.acceptCurrentBasis(); assert.equal(f.lane.getSnapshot().conflict,true);
    f.data.readFailure=null; f.data.current=avatar(target,3); await f.lane.acceptCurrentBasis(); assert.equal(f.lane.getSnapshot().conflict,false); assert.equal(f.lane.getSnapshot().avatar.version,3); assert.ok(f.lane.getSnapshot().selected);
  } finally {f.owner.dispose();}
});
test('unavailable is not empty success; revocation hides committed and local images immediately', async () => {
  const f=fixture(); try {f.data.readFailure=new AvatarApiError(503,'avatar_unavailable'); await f.lane.load(); assert.equal(f.lane.getSnapshot().available,false); assert.equal(f.lane.getSnapshot().avatar,null);
    f.data.readFailure=null; await f.lane.load(); const image=f.select(f.lane); f.data.readFailure=new AvatarApiError(409,'storage_epoch_changed'); await f.lane.load();
    assert.equal(f.lane.getSnapshot().uri,null); assert.equal(f.lane.getSnapshot().selected,null); assert.equal(image.disposed,1); assert.equal(f.lost[0].code,'storage_epoch_changed');
  } finally {f.owner.dispose();}
});
test('remove is versioned and reports pending physical cleanup', async () => {
  const f=fixture(); try {await f.lane.load(); await f.lane.remove(); assert.deepEqual(f.calls.find(x=>x[0]==='remove')[1],{expectedVersion:1,confirmRemove:true});
    assert.equal(f.lane.getSnapshot().avatar.asset,null); assert.match(f.lane.getSnapshot().notice,/清理中/);
  } finally {f.owner.dispose();}
});
test('remove refuses a stale reviewed version even if its callback runs after a newer read', async () => {
  const f = fixture(); try {
    await f.lane.load(); const reviewed = f.lane.getSnapshot().avatar.version;
    f.data.current = avatar(target, reviewed + 1); await f.lane.load();
    await f.lane.remove(reviewed); assert.equal(f.calls.filter(call => call[0] === 'remove').length, 0);
    await f.lane.remove(reviewed + 1);
    assert.deepEqual(f.calls.find(call => call[0] === 'remove')[1], { expectedVersion: reviewed + 1, confirmRemove: true });
  } finally { f.owner.dispose(); }
});

test('real AvatarApi and online transport deliver reserve/commit conflicts to owner without unknown retry loop', async () => {
  const { createAvatarApi } = compile('src/client/avatars-api.ts');
  const id = '33333333-3333-4333-8333-333333333333', epoch = '44444444-4444-4444-8444-444444444444';
  for (const code of ['avatar_policy_changed','avatar_version_conflict']) {
    const requests = []; let version = 0;
    const upload = {id,target,expectedVersion:0,policyId:policy.policyId,state:'reserved',expiresAt:'2026-10-23T01:00:00Z',normalized:null,errorCode:null};
    const normalized = {...asset(id),id};
    const transport = async (url, init) => {
      const route=String(url); requests.push(route); assert.equal(init.headers['x-expected-user-id'],'synthetic-user');
      if (route === '/api/me/avatar') return Response.json({avatar:{...avatar(target,version),asset:null},policy});
      if (route === '/api/online/context') return Response.json({workspaceId:id,storageEpoch:epoch});
      if (route === `/api/me/avatar/uploads/${id}/content`) return Response.json({upload:{...upload,state:'ready',normalized}});
      assert.equal(route,'/api/online/submit'); const body=JSON.parse(init.body);
      if (code==='avatar_policy_changed' || body.path==='/api/me/avatar/commit') {
        version=1; return Response.json({error:{code,message:'private decoder sentinel'}},{status:409});
      }
      assert.equal(body.path,'/api/me/avatar/uploads'); return Response.json({state:'confirmed',operation:body.operation,changeSeq:'1',statusCode:201,result:{upload}});
    };
    const owner=new AvatarOwner(createAvatarApi('',transport),()=>{},()=>true,()=>{}), lane=owner.self;
    try {
      owner.syncContext({key:'real-client-test',userId:'synthetic-user'},null,true); await lane.load();
      lane.select(lane.beginSelection(),{uri:'blob:synthetic',width:80,height:80,mimeType:'image/png',bytes:new Uint8Array([1,2,3]),dispose(){}});
      await lane.save(); assert.equal(lane.getSnapshot().conflict,true,code); assert.equal(lane.getSnapshot().unknown,false,code); assert.equal(lane.getSnapshot().retryAvailable,false,code);
      assert.ok(lane.getSnapshot().selected); assert.doesNotMatch(lane.getSnapshot().notice,/sentinel/); const count=requests.length;
      await lane.check(); await lane.retry(); assert.equal(requests.length,count,'conflict never retries a terminal operation');
      await lane.acceptCurrentBasis(); assert.equal(lane.getSnapshot().conflict,false); assert.equal(lane.getSnapshot().avatar.version,1); assert.equal(requests.at(-1),'/api/me/avatar');
    } finally {owner.dispose();}
  }
});

test('real transport old-server avatar 404 remains local and never invalidates identity or child scope', async () => {
  const { createAvatarApi } = compile('src/client/avatars-api.ts');
  for (const kind of ['self','child']) for (const stage of ['read','reserve']) {
    const target = kind==='self' ? {kind:'self'} : child, denied=[];
    const id='33333333-3333-4333-8333-333333333333', epoch='44444444-4444-4444-8444-444444444444';
    const api=createAvatarApi('',async (url,init)=>{
      assert.equal(init.headers['x-expected-user-id'],'synthetic-user');
      if (String(url).endsWith('/online/context')) return Response.json({workspaceId:id,storageEpoch:epoch});
      if (stage==='reserve' && init.method==='GET') return Response.json({avatar:avatar(target),policy});
      return Response.json({error:{code:'not_found'}},{status:404});
    });
    const owner=new AvatarOwner(api,error=>denied.push(error),()=>true,()=>{}), lane=owner[kind];
    try {
      owner.syncContext({key:'identity-ready',userId:'synthetic-user'},{key:'child-ready',childId:child.childId},true); await lane.load();
      if(stage==='reserve') { lane.select(lane.beginSelection(),{uri:'blob:synthetic',width:80,height:80,mimeType:'image/png',bytes:new Uint8Array([1,2,3]),dispose(){}}); await lane.save(); }
      assert.equal(lane.getSnapshot().key,kind==='self'?'identity-ready':'child-ready'); assert.equal(lane.getSnapshot().available,false);
      assert.equal(lane.getSnapshot().unknown,false); assert.equal(lane.getSnapshot().uri,null); assert.deepEqual(denied,[]);
      assert.equal(owner.self.getSnapshot().key,'identity-ready'); assert.equal(owner.child.getSnapshot().key,'child-ready'); assert.match(lane.getSnapshot().notice,/暫未可用/);
    } finally {owner.dispose();}
  }
});
test('unknown remove receipt retains remove wording and physical cleanup distinction', async () => {
  for (const pending of [true,false,null]) {
    const f=fixture(); try {
      await f.lane.load(); f.api.remove=async()=>{f.data.pending=true; throw new AvatarApiError();}; await f.lane.remove(); assert.equal(f.lane.getSnapshot().unknown,true);
      f.data.current={...avatar(target,2),asset:null}; f.data.receipt={state:'confirmed',kind:'remove',target,result:pending===null?null:{avatar:f.data.current,cleanupPending:pending}};
      await f.lane.check(); assert.equal(f.lane.getSnapshot().unknown,false); assert.match(f.lane.getSnapshot().notice,/移除/); assert.doesNotMatch(f.lane.getSnapshot().notice,/已保存/);
      if(pending===true) assert.match(f.lane.getSnapshot().notice,/清理中/);
    } finally {f.owner.dispose();}
  }
});
test('cancel/scope change aborts picker immediately; browser decoder drops URL and handlers before onload', async () => {
  const {readAvatarFile}=compile('frontend/src/platform/avatar-picker.ts');
  const f=fixture(); const oldWindow=global.window, oldReader=global.FileReader, revoke=URL.revokeObjectURL;
  const started=deferred(), images=[], revoked=[]; let reader;
  class SyntheticReader {
    readAsArrayBuffer(file){reader=this;file.arrayBuffer().then(result=>{if(!this.aborted){this.result=result;this.onload?.();}});}
    abort(){this.aborted=true;this.onabort?.();}
  }
  class SyntheticImage {
    constructor(){images.push(this);}
    set src(value){this.value=value;if(value.startsWith('blob:'))started.resolve();}
    get src(){return this.value;}
  }
  global.FileReader=SyntheticReader; global.window={Image:SyntheticImage}; URL.revokeObjectURL=value=>{revoked.push(value);revoke(value);};
  try {
    await f.lane.load(); const committedUri=f.lane.getSnapshot().uri, ticket=f.lane.beginSelection(), signal=f.lane.selectionSignal(ticket);
    const bytes=new Uint8Array(33),view=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);bytes.set([73,72,68,82],12);view.setUint32(16,80);view.setUint32(20,100);
    const reading=readAvatarFile(new File([bytes],'synthetic.png',{type:'image/png'}),policy,signal);
    const rejected=assert.rejects(reading,/canceled/); await started.promise;
    const decodeUri=images[0].src, lateOnload=images[0].onload; assert.notEqual(decodeUri,committedUri);
    f.owner.syncContext(null,null,true); assert.equal(signal.aborted,true);
    assert.equal(revoked.filter(uri=>uri===committedUri).length,1,'committed URL released once');
    assert.equal(revoked.filter(uri=>uri===decodeUri).length,1,'decoder URL released immediately once'); assert.equal(images[0].src,''); assert.equal(images[0].onload,null); assert.equal(images[0].onerror,null);
    assert.ok(new Uint8Array(reader.result).every(value=>value===0));
    images[0].naturalWidth=80; images[0].naturalHeight=100; lateOnload(); await rejected;
    assert.deepEqual(revoked.slice().sort(),[committedUri,decodeUri].sort(),'exact resources released, no duplicate after late onload');
    assert.equal(f.lane.getSnapshot().selected,null); assert.equal(f.lane.getSnapshot().uri,null);
  } finally {f.owner.dispose();global.window=oldWindow;global.FileReader=oldReader;URL.revokeObjectURL=revoke;}
});

test('ambiguous404 clears selected raw and aborts in-flight picker locally without losing context', async () => {
  const f=fixture(); try {
    await f.lane.load(); const selected=f.select(f.lane), ticket=f.lane.beginSelection(), signal=f.lane.selectionSignal(ticket);
    let aborted=0; signal.addEventListener('abort',()=>aborted++);
    f.data.readFailure=new AvatarApiError(404,'not_found'); await f.lane.load();
    assert.equal(aborted,1); assert.equal(signal.aborted,true); assert.equal(selected.disposed,1); assert.ok(selected.bytes.every(value=>value===0));
    assert.equal(f.lane.getSnapshot().uri,null); assert.equal(f.lane.getSnapshot().selected,null); assert.equal(f.lane.getSnapshot().avatar,null); assert.equal(f.lane.getSnapshot().key,'identity-a');
    assert.equal(f.lane.beginSelection(),null); const notice=f.lane.getSnapshot().notice, late=f.image(); f.lane.select(ticket,late);
    assert.equal(late.disposed,1); assert.equal(f.lane.getSnapshot().notice,notice); assert.deepEqual(f.lost,[]);
  } finally {f.owner.dispose();}
});
test('read-only response aborts decoder even before a selected image exists', async () => {
  const f=fixture(); try {
    await f.lane.load(); const ticket=f.lane.beginSelection(), signal=f.lane.selectionSignal(ticket);
    f.api.read=async target=>({avatar:{...avatar(target,1),canManage:false},policy}); await f.lane.load();
    assert.equal(signal.aborted,true); assert.equal(f.lane.getSnapshot().selected,null); assert.equal(f.lane.getSnapshot().avatar.canManage,false);
    const late=f.image(); f.lane.select(ticket,late); assert.equal(late.disposed,1);
  } finally {f.owner.dispose();}
});
test('404 during original-operation lookup clears raw, retains operation recovery and never retransmits bytes', async () => {
  const f=fixture(); try {
    await f.lane.load(); const selected=f.select(f.lane); f.data.commitFailure=new AvatarApiError(); await f.lane.save();
    const originalLookup=f.api.reconcilePending; f.api.reconcilePending=async()=>{throw new AvatarApiError(404,'not_found');}; await f.lane.check();
    assert.equal(f.lane.getSnapshot().unknown,true); assert.equal(selected.disposed,1); assert.equal(f.lane.getSnapshot().selected,null); assert.equal(f.lane.getSnapshot().key,'identity-a');
    const before=f.calls.filter(x=>x[0]==='upload').length; await f.lane.retry(); assert.equal(f.calls.filter(x=>x[0]==='upload').length,before);
    f.api.reconcilePending=originalLookup; f.data.current=avatar(target,2); f.data.receipt={state:'confirmed',kind:'commit',target,result:null}; await f.lane.check();
    assert.equal(f.lane.getSnapshot().unknown,false); assert.equal(f.lane.getSnapshot().avatar.version,2); assert.equal(f.calls.filter(x=>x[0]==='upload').length,before);
  } finally {f.owner.dispose();}
});

test('real online lookup404 preserves original commit; terminal POST404 never offers a new op as original retry', async () => {
  const {createAvatarApi}=compile('src/client/avatars-api.ts');
  for(const terminalPost404 of [false,true]) {
    const id='33333333-3333-4333-8333-333333333333',epoch='44444444-4444-4444-8444-444444444444';
    const normalized={...asset(id),id}; const upload={id,target,expectedVersion:0,policyId:policy.policyId,state:'reserved',expiresAt:'2026-10-23T01:00:00Z',normalized:null,errorCode:null};
    let original=null,lookups=0,posts=0,uploads=0,version=0,disposed=0;
    const api=createAvatarApi('',async(url,init)=>{
      const route=String(url);assert.equal(init.headers['x-expected-user-id'],'synthetic-user');
      if(route==='/api/me/avatar')return Response.json({avatar:{...avatar(target,version),asset:null},policy});
      if(route==='/api/online/context')return Response.json({workspaceId:id,storageEpoch:epoch});
      if(route===`/api/me/avatar/uploads/${id}/content`){uploads++;return Response.json({upload:{...upload,state:'ready',normalized}});}
      if(route.startsWith('/api/online/operations/')){
        lookups++;assert.equal(route,`/api/online/operations/${original.opId}`);
        if(lookups===1)return Response.json({error:{code:'not_found'}},{status:404});
        version=1;return Response.json({state:'confirmed',operation:original,changeSeq:'2',statusCode:200,result:{avatar:{...avatar(target,1),asset:normalized},cleanupPending:false}});
      }
      assert.equal(route,'/api/online/submit');posts++;const body=JSON.parse(init.body);
      if(body.path.endsWith('/uploads'))return Response.json({state:'confirmed',operation:body.operation,changeSeq:'1',statusCode:201,result:{upload}});
      original=body.operation;
      if(terminalPost404)return Response.json({error:{code:'not_found'}},{status:404});
      throw new Error('Synthetic response lost');
    });
    const owner=new AvatarOwner(api,()=>{throw new Error('404 must stay local');},()=>true,()=>{}),lane=owner.self;
    try{
      owner.syncContext({key:'identity-ready',userId:'synthetic-user'},null,true);await lane.load();lane.select(lane.beginSelection(),{uri:'blob:synthetic',width:80,height:80,mimeType:'image/png',bytes:new Uint8Array([1,2,3]),dispose(){disposed++;}});await lane.save();
      if(terminalPost404){assert.equal(lane.getSnapshot().unknown,false);assert.equal(lane.getSnapshot().retryAvailable,false);await lane.retry();assert.equal(lookups,0);}
      else{assert.equal(api.hasPendingOnline(),true);await lane.check();assert.equal(api.hasPendingOnline(),true);assert.equal(lane.getSnapshot().unknown,true);assert.equal(lane.getSnapshot().selected,null);await lane.retry();assert.equal(posts,2);await lane.check();assert.equal(lane.getSnapshot().unknown,false);assert.equal(lookups,2);}
      assert.equal(disposed,1);assert.equal(posts,2);assert.equal(uploads,1);assert.equal(lane.getSnapshot().key,'identity-ready');
    }finally{owner.dispose();}
  }
});

test('latest real avatar client identity_changed clears the lane and original operation without allowing retry', async () => {
  const { createAvatarApi } = compile('src/client/avatars-api.ts');
  for (const stage of ['submit', 'lookup']) {
    const id = '33333333-3333-4333-8333-333333333333', epoch = '44444444-4444-4444-8444-444444444444';
    const lost = [], requests = []; let original;
    const api = createAvatarApi('', async (url, init) => {
      const route = String(url); requests.push(route);
      assert.equal(init.headers['x-expected-user-id'], 'synthetic-user');
      if (route === '/api/me/avatar') return Response.json({ avatar: avatar(target), policy });
      if (route === '/api/online/context') return Response.json({ workspaceId: id, storageEpoch: epoch });
      if (route === '/api/online/submit') {
        original = JSON.parse(init.body).operation;
        if (stage === 'lookup') throw new Error('Synthetic response lost');
      } else assert.equal(route, `/api/online/operations/${original.opId}`);
      return Response.json({ error: { code: 'identity_changed' } }, { status: 409 });
    });
    const owner = new AvatarOwner(api, error => lost.push(error), () => true, () => {}), lane = owner.self;
    let disposed = 0; const bytes = new Uint8Array([1, 2, 3]);
    try {
      owner.syncContext({ key: 'old-identity', userId: 'synthetic-user' }, null, true); await lane.load();
      lane.select(lane.beginSelection(), { uri: 'blob:synthetic', width: 80, height: 80, mimeType: 'image/png', bytes,
        dispose() { disposed++; bytes.fill(0); } });
      await lane.save();
      if (stage === 'lookup') { assert.equal(lane.getSnapshot().unknown, true); assert.equal(api.hasPendingOnline(), true); await lane.check(); }
      assert.equal(api.hasPendingOnline(), false); assert.equal(lane.getSnapshot().key, null);
      assert.equal(lane.getSnapshot().selected, null); assert.equal(lane.getSnapshot().uri, null);
      assert.equal(lane.getSnapshot().unknown, false); assert.equal(lane.getSnapshot().retryAvailable, false);
      assert.equal(disposed, 1); assert.deepEqual([...bytes], [0, 0, 0]);
      assert.deepEqual(lost, [{ status: 409, code: 'identity_changed', target }]);
      const count = requests.length; await lane.check(); await lane.retry(); await lane.save();
      assert.equal(requests.length, count, 'An obsolete identity cannot restart or retry the original command');
    } finally { owner.dispose(); }
  }
});
