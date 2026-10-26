const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const base = path.resolve(__dirname, '..'), req = createRequire(path.join(base, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply an existing test-only JSDOM_MODULE');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<div id="root"></div>', {url:'https://fictional.invalid/photos',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Node','ShadowRoot','MutationObserver','getComputedStyle']) global[key]=dom.window[key];
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
global.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);global.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);global.IS_REACT_ACT_ENVIRONMENT=true;
let network=0;global.fetch=()=>{network++;throw Error('Network forbidden');};
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client'),rn=req('react-native-web'),ts=req('typescript');
let width=1440;const cache=new Map();
// Actual AppTabPanel function and ID contract, with only motion as a no-animation host port.
const uiSource=fs.readFileSync(path.join(base,'src/components/ui.tsx'),'utf8');
const uiTree=ts.createSourceFile('ui.tsx',uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const panelCode=uiTree.statements.filter(node=>ts.isFunctionDeclaration(node)&&['tabId','tabPanelId','AppTabPanel'].includes(node.name?.text)).map(node=>node.getText(uiTree)).join('\n');
const panelModule={exports:{}};
new Function('require','module','exports','useRef','useLayoutEffect','Platform','MotionEntrance','styles',ts.transpileModule(panelCode,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText)(req,panelModule,panelModule.exports,React.useRef,React.useLayoutEffect,rn.Platform,({preset,triggerKey,scopeKey,enabled,...props})=>React.createElement(rn.View,props),{hiddenPanel:{display:'none'}});
const ActualTabPanel=panelModule.exports.AppTabPanel;

const view=({children,...props})=>React.createElement(rn.View,props,children);
const text=({children,...props})=>React.createElement(rn.Text,props,children);
function Button({label,accessibilityLabel,onPress,disabled,ref,expanded}){return React.createElement(rn.Pressable,{ref,accessibilityRole:'button',accessibilityLabel:accessibilityLabel||label,disabled,'aria-disabled':disabled,'aria-expanded':expanded,onPress},React.createElement(rn.Text,null,label));}
const SectionHeader=({title,subtitle,action})=>React.createElement(rn.View,null,React.createElement(rn.Text,{accessibilityRole:'header'},title),subtitle&&React.createElement(rn.Text,null,subtitle),action);
const Dialog=()=>null;Object.assign(Dialog,{Title:view,Content:view,Actions:view,ScrollArea:view});
function load(relative){const file=path.resolve(base,relative);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);
 const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});assert.equal(result.diagnostics.length,0);
 new Function('require','module','exports',result.outputText)(name=>{
  if(name==='react-native')return rn;if(name==='react-native-paper')return {Text:rn.Text,Portal:view,MD3LightTheme:{colors:{},fonts:{}},configureFonts:x=>x};
  if(name.endsWith('/ui'))return {AppButton:Button,OperationPill:()=>null,SectionCard:view,SectionHeader,AppTabPanel:ActualTabPanel,AppTextField:({label,value,onChangeText,disabled})=>React.createElement(rn.TextInput,{accessibilityLabel:label,value,onChangeText,editable:!disabled})};
  if(name.endsWith('/AppCheckbox'))return {AppCheckbox:({label,checked,disabled,onChange})=>React.createElement(rn.Pressable,{accessibilityRole:'checkbox',accessibilityLabel:label,'aria-checked':checked,disabled,'aria-disabled':disabled,onPress:()=>onChange(!checked)},React.createElement(rn.Text,null,label))};
  if(name.endsWith('/PageFrame'))return {PageFrame:view};if(name.endsWith('/AppScrollView'))return {AppScrollView:rn.ScrollView};if(name.endsWith('/AppIcon'))return {AppIcon:()=>null};
  if(name.endsWith('/AppDialog'))return {AppDialog:Dialog};if(name.endsWith('/StatusAnnouncement'))return {StatusAnnouncement:()=>null};
  if(name.endsWith('/ReadStateNotice'))return {ReadStateNotice:({message,children})=>React.createElement(rn.View,null,React.createElement(rn.Text,null,message),children)};
  if(name.endsWith('/EmptyListCard'))return {EmptyListCard:({title,detail,children})=>React.createElement(rn.View,null,React.createElement(rn.Text,null,title),React.createElement(rn.Text,null,detail),children)};
  if(name.endsWith('/AppStatusBadge'))return {AppStatusBadge:({label})=>React.createElement(rn.Text,null,label)};
  if(name.endsWith('/useContainerWidth'))return {useContainerWidth:()=>({width,ref:React.useRef(null),onLayout(){}})};
  if(name.endsWith('/useContentDeletionFocus'))return {useContentDeletionFocus:()=>({listRef:React.useRef(null),rowRef(){},start(){},onClosed(){}})};
  if(name.endsWith('/useContentListMotion'))return {useContentListMotion:()=>false};
  if(name.endsWith('/motion'))return {MotionFeedback:view,MotionDisclosure:({expanded,children})=>expanded?children:null,MotionReveal:({value,children})=>children(value),MotionList:({items,renderItem,keyExtractor,...props})=>React.createElement(rn.View,{testID:props.testID,style:props.style},items.map(item=>React.createElement(rn.View,{key:keyExtractor(item)},renderItem(item,{exiting:false}))))};
  if(name.endsWith('/PreviewNavigationGuard'))return {usePreviewNavigation:()=>action=>action()};
  for(const leaf of ['SourceComposer','SourceRecordForm','SourceIntakeConversation'])if(name.endsWith('/'+leaf))return {[leaf]:()=>null};
  if(name.endsWith('/FormErrorSummary'))return {FormFieldMessage:()=>null};
  if(name.endsWith('/FormDialog'))return {FormDialog:Dialog,ManualFormDialog:({label})=>React.createElement(Button,{label,onPress(){}})};
  if(name.endsWith('/HistoryEntryCard'))return {HistoryEntryCard:({cardRef,children,...props})=>React.createElement(rn.Pressable,{ref:cardRef,...props,accessibilityRole:'button'},children)};
  if(name.endsWith('/PhotoFilePicker'))return {PhotoFilePicker:()=>null};if(name.endsWith('/PhotoRecordForm'))return {PhotoRecordForm:()=>null};
  if(!name.startsWith('.'))return req(name);const p=path.resolve(path.dirname(file),name);return load(fs.existsSync(p)?p:fs.existsSync(p+'.tsx')?p+'.tsx':p+'.ts');
 },mod,mod.exports);return mod.exports;}
const {PhotosView}=load('src/components/photos/PhotosView.tsx'),{SourceDetails}=load('src/components/shared-inputs/SourceDetails.tsx'),{SourcesView}=load('src/components/shared-inputs/SourcesView.tsx');
const root=createRoot(document.getElementById('root'));
const noop=()=>{};const actions=new Proxy({},{get:(_,name)=>name==='readThumbnail'?undefined:noop});
const photo={id:'photo-1',childId:'child-1',fileName:'海邊散步.png',mimeType:'image/png',bytes:12000,sha256:'a'.repeat(64),source:'週末散步',ownerLabel:'家長',isUploader:true,createdAtLabel:'10月24日',version:2,canManage:true,state:'ready',visibility:'private',recordId:null,imageSource:null,extraction:{state:'not_requested',candidate:null}};
const photoModel=()=>({childName:'小晴',online:true,access:'editable',load:'ready',canCreate:true,capacityReached:false,items:[photo],selected:null,latest:null,original:null,source:'',sourceError:'',draft:{text:'保留的核對草稿',kind:'note',rawValue:'',unit:'',approximate:false,timeRaw:''},formKey:1,reviewed:null,modelConsent:false,sharedConsent:false,operation:{state:'none',phase:null,reference:null,message:'',checked:false},notice:'',reservationUnidentified:false,replacement:null,deletion:false,deleteScope:false,deleteFinal:false,busy:false,fresh:true,formLocked:false,canPick:true,canUpload:false,canExtract:true,canConfirm:true,canDelete:true});
const byLabel=label=>document.querySelector(`[aria-label="${label}"]`);
const click=async node=>{assert.ok(node);await act(async()=>node.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));};
const render=async element=>act(async()=>root.render(element));
test('photo library becomes a focused two-part inspector and same-photo reopening retains original actions and draft',async()=>{
 for(width of [320,390,1024,1440]){let model=photoModel(),opens=0;const command={...actions,openPhoto:item=>{opens++;model={...model,selected:item};root.render(ui());}};
 function ui(){return React.createElement(PhotosView,{key:width,model,actions:new Proxy(command,{get:(obj,key)=>key in obj?obj[key]:actions[key]}),onCare:noop,scopeKey:'scope-1',production:true});}
 await render(ui());await click(byLabel('開啟照片：私人 · 海邊散步.png'));
 assert.equal(opens,1);assert.equal(document.activeElement.getAttribute('aria-label'),'照片核對工作區');assert.equal(byLabel('附件清單').getAttribute('aria-hidden'),'true');
 const photoTab=document.querySelector('[role=tab][aria-selected=true]');const photoPanel=document.getElementById(photoTab.getAttribute('aria-controls'));assert.ok(photoPanel.contains(byLabel('照片核對工作區')));assert.equal(photoPanel.closest('[aria-hidden=true]'),null);assert.equal(photoPanel.getAttribute('role'),'tabpanel');assert.equal(photoPanel.inert,false);
 assert.ok(document.body.textContent.includes('核對照片內容'));assert.equal(model.draft.text,'保留的核對草稿');
 await click(byLabel('返回附件清單（保留本頁草稿）'));assert.notEqual(byLabel('附件清單').getAttribute('aria-hidden'),'true');assert.equal(document.activeElement.getAttribute('aria-label'),'開啟照片：私人 · 海邊散步.png');
 await click(byLabel('開啟照片：私人 · 海邊散步.png'));assert.equal(opens,2);assert.equal(byLabel('附件清單').getAttribute('aria-hidden'),'true');assert.equal(model.draft.text,'保留的核對草稿');
 }
});
test('photo unknown operation keeps inspector exit, extraction and deletion gated',async()=>{
 const model={...photoModel(),selected:photo,canExtract:false,canDelete:false,formLocked:true,operation:{state:'unknown',phase:'extract',reference:'same-op',message:'先查核原結果',checked:false}};
 await render(React.createElement(PhotosView,{key:'unknown',model,actions,onCare:noop,scopeKey:'scope-1',production:true}));
 for(const label of ['返回附件清單（保留本頁草稿）','提取照片內容','刪除照片及連結記錄'])assert.equal(byLabel(label).getAttribute('aria-disabled'),'true',label);
 assert.ok(byLabel('查核同一照片附件'));assert.ok(document.body.textContent.includes('same-op'));
});
const source={id:'source-1',childId:'child-1',ownerUserId:'parent-1',version:3,createdAt:'2026-10-24T02:00:00Z',canManage:true,kind:'paste',sourceNotes:'',sourceId:null,sourceLabel:'老師的觀察',sourceUrl:null,sourceDateText:'上星期',text:'小晴願意與同學輪流玩積木。',sha256:'b'.repeat(64),retrievedAt:null,fetchState:'ready',extraction:{state:'not_requested',draft:null},recordId:null,confirmationKind:null};
const sourceModel=()=>({scopeKey:'scope-1',selected:source,online:true,access:'editable',load:'ready',fresh:true,busy:false,operation:{state:'none',phase:null},direct:null,formLocked:false,canFetch:false,canExtract:true,canDelete:true,fetchConsent:false,modelConsent:false,excerpt:source.text});
test('source opens readable original before injected purpose workflow; technical data remains deliberate and writes stay consent-gated',async()=>{
 const model=sourceModel();let deletes=0;await render(React.createElement(SourceDetails,{key:'source',model,actions:new Proxy({openDeletion:()=>deletes++},{get:(obj,key)=>obj[key]||noop}),onRecord:noop},React.createElement(rn.Text,null,'來源用途工作區')));
 assert.ok(document.querySelector('[data-testid="source-full-text"]'));const copy=document.body.textContent;assert.ok(copy.indexOf(source.text)<copy.indexOf('來源用途工作區'));assert.ok(copy.indexOf('來源用途工作區')<copy.indexOf('可選的 AI 提取'));assert.ok(copy.indexOf('可選的 AI 提取')<copy.indexOf('管理這份來源'));
 assert.equal(byLabel('提取所選片段').getAttribute('aria-disabled'),'true');assert.ok(!document.body.textContent.includes(source.sha256));await click(byLabel('顯示來源技術資料'));assert.ok(document.body.textContent.includes(source.sha256));await click(byLabel('刪除私人來源'));assert.equal(deletes,1);
});
test('disabled source never renders its full original, even though the reader starts expanded',async()=>{
 const model=sourceModel();model.selected={...source,management:{enabled:false}};await render(React.createElement(SourceDetails,{key:'disabled-source',model,actions,onRecord:noop}));assert.equal(document.querySelector('[data-testid="source-full-text"]'),null);assert.ok(document.body.textContent.includes('這份來源已停用'));assert.equal(byLabel(`查看完整原文（${source.text.length.toLocaleString('en-HK')} 字）`).getAttribute('aria-disabled'),'true');
});
test('contextual photo/source recovery is a read callback after ready-state failure or unreadable saved result, never a new write',async()=>{
 for(const kind of ['photo','source'])for(const state of ['none','failed','saved','unknown']){
  let reads=0,writes=0;const callback=new Proxy({refresh:()=>reads++,intake:undefined},{get:(obj,key)=>key in obj?obj[key]:()=>writes++});
  const model=kind==='photo'?photoModel():{...sourceModel(),items:[],selected:null,childName:'小晴',accountName:'家長',canChoose:true,canCreate:true,deleteOpen:false,formKey:1};
  model.operation={state,phase:'create',message:state==='failed'?'請重新讀取並核對。':'',checked:false};
  await render(kind==='photo'?React.createElement(PhotosView,{key:kind+state,model,actions:callback,onCare:noop,scopeKey:'scope-1',production:true}):React.createElement(SourcesView,{key:kind+state,model,actions:callback,onPhotos:noop,onRecord:noop,production:true}));
  const label=kind==='photo'?'重新讀取照片清單':'重新讀取來源清單';
  if(['failed','saved'].includes(state)){await click(byLabel(label));assert.equal(reads,1);model.online=false;await render(kind==='photo'?React.createElement(PhotosView,{key:kind+state,model,actions:callback,onCare:noop,scopeKey:'scope-1',production:true}):React.createElement(SourcesView,{key:kind+state,model,actions:callback,onPhotos:noop,onRecord:noop,production:true}));assert.equal(byLabel(label).getAttribute('aria-disabled'),'true');}
  else assert.equal(byLabel(label),null);
  assert.equal(writes,0);
 }
});
test.after(async()=>{await act(async()=>root.unmount());assert.equal(network,0);dom.window.close();});
