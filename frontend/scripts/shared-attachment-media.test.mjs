import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

const childId='child-a', spaceId='space-a', hash='a'.repeat(64);
const file={id:'file-a',version:2,sha256:hash,bytes:12,mimeType:'application/pdf'};
const voice={id:'voice-a',version:3,sha256:hash,bytes:12,mimeType:'audio/mp4',durationMs:1000};
const metadata=ref=>({...ref,childId,state:'ready',sharedSpaceId:spaceId,messageId:null,fileName:'SHARED_ORIGINAL'});
const transcript=()=>({voice,messageId:null,sharedSpaceId:spaceId,state:'available',content:{complete:true,segments:[{text:'SHARED_TRANSCRIPT',startMs:null,endMs:null,unclear:false}]}});
const settle=async h=>{await new Promise(setImmediate);h.render();await new Promise(setImmediate);h.render();};
function setup(){
  let active='scope-a', env;
  const calls=[],exports=[],locals=[];
  const privateApi={get:async()=>{calls.push('private');throw Error('Private requests forbidden');}};
  const makeEnv=scope=>({scopeKey:scope,childId,userId:'actor',online:true,sharedMode:true,sharing:{spaceId},allows:module=>module==='attachments',
    owner:{fileApi:privateApi,voiceApi:privateApi},current:()=>active===scope,accessError(){}});
  env=makeEnv(active);
  let h;
  h=harness({
    './useDomainEnvironment':{useDomainEnvironment:()=>env},
    '../../../src/client/chat-file-api':{ChatFileApiError:class extends Error{}},
    '../../../src/client/voice-api':{VoiceApiError:class extends Error{}},
    '../platform/file-export':{exportAttachment:async(...args)=>{exports.push(args);return 'Exported';}},
    '../platform/voice-playback':{voicePlayback:async()=>{const local={uri:'SYNTHETIC_AUDIO',disposed:false,dispose(){this.disposed=true;}};locals.push(local);return local;}},
    '../components/agent/LocalAudioPreview':{LocalAudioPreview:'AudioPreview'},
    '@tanstack/react-query':{useQuery(options){
      const key=JSON.stringify(options.queryKey),[state,setState]=h.react.useState({key:null});
      const run=signal=>Promise.resolve().then(()=>options.queryFn({signal})).then(data=>{if(!signal.aborted)setState({key,data});},error=>{if(!signal.aborted)setState({key,error});});
      h.react.useEffect(()=>{const controller=new AbortController();if(options.enabled)void run(controller.signal);return()=>controller.abort();},[key,options.enabled]);
      const current=state.key===key?state:{};
      return {...current,isError:!!current.error,isPending:!current.data&&!current.error,isFetching:false,refetch:()=>run(new AbortController().signal)};
    }},
  });
  const components={file:h.load('src/production/ChatFileMessage.tsx').ChatFileMessage,voice:h.load('src/production/VoiceMessage.tsx').VoiceMessage};
  const api={get:async(_child,id)=>{calls.push('shared-get');return metadata(id===file.id?file:voice);},
    transcript:async()=>transcript(),content:async()=>{calls.push('content');return{bytes:new Uint8Array(12),mimeType:'application/octet-stream'};}};
  const render=(kind,...options)=>{const [override,messageId=null]=options.length?options:[api];return h.render(h.jsx(components[kind],{messageId,[kind==='file'?'file':'voice']:kind==='file'?file:voice,api:override}));};
  const button=label=>{const node=h.hosts().find(node=>node.type==='Button'&&node.props.label===label);assert.ok(node,label);return node.props;};
  return{h,api,calls,exports,locals,render,button,scope(){active='scope-b';env=makeEnv(active);},deny(){env={...env,allows:()=>false};},
    personal(){env={...env,sharedMode:false,sharing:undefined,owner:{fileApi:api,voiceApi:api}};
      api.get=async(_child,id)=>({...metadata(id===file.id?file:voice),sharedSpaceId:undefined,messageId:'message-a'});
      api.transcript=async()=>({...transcript(),sharedSpaceId:undefined,messageId:'message-a'});},text:()=>JSON.stringify(h.hosts())};
}
test('shared null-message files and voice use explicit APIs and preserve download/playback',async()=>{
  for(const kind of ['file','voice']){
    const f=setup();f.render(kind);
    if(kind==='voice'){f.button('錄音 · 1 秒').onPress();f.h.render();}
    await settle(f.h);
    assert.equal(f.calls.includes('private'),false);
    if(kind==='file'){assert.equal(f.button('下載原檔').disabled,false);f.button('下載原檔').onPress();await settle(f.h);assert.equal(f.exports.length,1);}
    else{assert.match(f.text(),/SHARED_TRANSCRIPT/);f.button('讀取原錄音播放').onPress();await settle(f.h);assert.equal(f.locals.length,1);assert.ok(f.h.hosts().some(n=>n.type==='AudioPreview'));}
    f.h.unmount();
  }
});
test('shared metadata and transcripts reject another space',async()=>{
  for(const [kind,part] of [['file','metadata'],['voice','metadata'],['voice','transcript']]){
    const f=setup();
    if(part==='metadata')f.api.get=async()=>({...metadata(kind==='file'?file:voice),sharedSpaceId:'other-space'});
    else f.api.transcript=async()=>({...transcript(),sharedSpaceId:'other-space'});
    f.render(kind);if(kind==='voice'){f.button('錄音 · 1 秒').onPress();f.h.render();}await settle(f.h);
    assert.doesNotMatch(f.text(),/SHARED_TRANSCRIPT|SHARED_ORIGINAL/);
    if(kind==='file')assert.equal(f.button('下載原檔').disabled,true);
    f.h.unmount();
  }
});
test('personal media retains original owner API and private message matching',async()=>{
  for(const kind of ['file','voice']){
    const f=setup();f.personal();f.render(kind,undefined,'message-a');
    if(kind==='voice'){f.button('錄音 · 1 秒').onPress();f.h.render();}await settle(f.h);
    if(kind==='file')assert.equal(f.button('下載原檔').disabled,false);else assert.match(f.text(),/SHARED_TRANSCRIPT/);
    f.h.unmount();
  }
});
test('shared media without an override or attachment permission never requests private APIs',async()=>{
  for(const kind of ['file','voice'])for(const override of [false,true]){
    const f=setup();if(override)f.deny();f.render(kind,override?f.api:undefined);
    if(kind==='voice'){f.button('錄音 · 1 秒').onPress();f.h.render();}await settle(f.h);
    assert.deepEqual(f.calls,[]);f.h.unmount();
  }
});
test('scope changes discard late original bytes before export or audio preview disclosure',async()=>{
  for(const kind of ['file','voice']){
    const f=setup();let finish;f.api.content=()=>new Promise(resolve=>{finish=resolve;});f.render(kind);
    if(kind==='voice'){f.button('錄音 · 1 秒').onPress();f.h.render();}await settle(f.h);
    f.button(kind==='file'?'下載原檔':'讀取原錄音播放').onPress();await settle(f.h);assert.ok(finish);
    f.scope();f.render(kind);finish({bytes:new Uint8Array(12),mimeType:'audio/mp4'});await settle(f.h);
    assert.equal(f.exports.length,0);assert.ok(f.locals.every(local=>local.disposed));assert.equal(f.h.hosts().some(n=>n.type==='AudioPreview'),false);f.h.unmount();
  }
});
