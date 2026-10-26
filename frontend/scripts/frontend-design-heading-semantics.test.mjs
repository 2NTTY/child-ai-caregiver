import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),React=require('react'),rn=require('react-native-web'),{renderToStaticMarkup}=require('react-dom/server');
function load(relative,width=1440,extra='') {
 const theme={colors:{},spacing:{xs:4,sm:8,md:12,lg:16,xl:24,xxl:32},radius:{},typeScale:{},readingType:{},workspaceType:{},mobileLayout:{breakpoint:650},mobileType:{},mobileIcons:{}};
 const Text=rn.Text,Empty=()=>null;
 const imports={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{...rn,useWindowDimensions:()=>({width,height:900})},
  'react-native-paper':{Text,Dialog:{Title:props=>React.createElement(Text,{accessibilityRole:'header',...props})}}};
 const module={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8')+extra,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(name=>imports[name]??(name.endsWith('/theme')?theme:new Proxy({},{get:()=>Empty})),module,module.exports);return module.exports;
}
// Real RN Web Text emits semantic h1/h2/h3; Paper appearance and layout are not under test.
test('shared section headers produce h2 by default and explicit h3 in both responsive compositions',()=>{
 for(const width of [320,1440])for(const level of [undefined,3]) {
  const {SectionHeader}=load('../src/components/ui.tsx',width);
  const html=renderToStaticMarkup(React.createElement(SectionHeader,{title:'記錄分類',level}));
  assert.match(html,new RegExp(`<h${level??2}\\b`));assert.doesNotMatch(html,/<h1\b/);
 }
});
test('journal page and section primitives render a single h1 followed by h2 and nested h3',()=>{
 const {JournalHeading,JournalSection}=load('../src/components/journal/JournalLayout.tsx');
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(JournalHeading,{title:'照顧手冊'}),React.createElement(JournalSection,{title:'近期記錄'},React.createElement(JournalSection,{title:'原文',level:3},React.createElement(rn.Text,null,'內容')))));
 assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.equal((html.match(/<h2\b/g)||[]).length,1);assert.equal((html.match(/<h3\b/g)||[]).length,1);
});
test('dialog title wrapper supplies an explicit secondary heading level',()=>{
 const {Title}=load('../src/components/AppDialog.tsx',1440,'\nexport {Title};');
 const html=renderToStaticMarkup(React.createElement(Title,null,'核對資料'));assert.match(html,/<h2\b/);assert.doesNotMatch(html,/<h1\b/);
});

const reviewed = [
  "frontend/src/components/ui.tsx",
  "frontend/src/components/FormErrorSummary.tsx",
  "frontend/src/components/notifications/ChannelCards.tsx",
  "frontend/src/components/account/AccountCallbackGate.tsx",
  "frontend/src/components/history/PersonalHistoryViews.tsx",
  "frontend/src/components/history/HistoryMessageDetail.tsx",
  "frontend/src/components/shared-inputs/SourcesView.tsx",
  "frontend/src/components/care/CareReviewHistoryView.tsx",
  "frontend/src/components/OperationNotice.tsx",
  "frontend/src/components/care/CareCaptureDetail.tsx",
  "frontend/src/components/care/CareRecordDetail.tsx",
  "frontend/src/components/agent/AgentRunView.tsx",
  "frontend/src/components/chat/AnswerSources.tsx",
  "frontend/src/screens/chatScreen.tsx",
  "frontend/src/production/AgentConversation.tsx",
  "frontend/src/components/RouteFeedback.tsx",
  "frontend/src/components/growth/GrowthView.tsx",
  "frontend/src/components/preparations/PreparationWorkspace.tsx",
  "frontend/src/screens/guideScreen.tsx",
  "frontend/src/screens/historyScreen.tsx",
  "frontend/src/components/growth/GrowthHistoryView.tsx",
  "frontend/src/components/HomeAgentImportant.tsx",
  "frontend/src/components/HomeOngoing.tsx",
  "frontend/src/components/HomeOverviewItems.tsx",
  "frontend/src/components/memory/MemoryReferenceView.tsx",
  "frontend/src/components/history/PersistentWorkCards.tsx",
  "frontend/src/components/profile/ProfileView.tsx",
  "frontend/src/components/child-overview/ChildOverviewConcerns.tsx",
  "frontend/src/components/child-overview/ChildOverviewContent.tsx",
  "frontend/src/components/growth/GrowthArchive.tsx",
  "frontend/src/components/summary/PreparationSheet.tsx",
  "frontend/src/components/tasks/TasksView.tsx",
  "frontend/src/components/tasks/TasksCalendar.tsx"
];
test('each directly authored heading in the reviewed mounted components has an explicit semantic level',()=>{
 for(const file of reviewed) {
  const source=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  function visit(node) {
   if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
    const attrs=node.attributes.properties.filter(ts.isJsxAttribute),role=attrs.find(a=>a.name.getText(tree)==='accessibilityRole');
    if(role?.initializer&&ts.isStringLiteral(role.initializer)&&role.initializer.text==='header')assert.ok(attrs.some(a=>a.name.getText(tree)==='aria-level'),file+': '+tree.getLineAndCharacterOfPosition(node.getStart()).line);
   }
   ts.forEachChild(node,visit);
  }
  visit(tree);
 }
});

test('the actual Expo HTML document declares Traditional Chinese before hydration without restricting zoom',()=>{
 const {default:RootDocument}=load('../app/+html.tsx');
 const html=renderToStaticMarkup(React.createElement(RootDocument,null,React.createElement('div',{id:'root'},'孩子的照顧手冊')));
 assert.match(html,/<html lang="zh-Hant">/);assert.match(html,/<meta charSet="utf-8"\/>/);assert.match(html,/name="viewport" content="width=device-width, initial-scale=1"/);
 assert.doesNotMatch(html,/maximum-scale|user-scalable=no/);assert.match(html,/<body><div id="root">孩子的照顧手冊<\/div><\/body>/);
 const source=readFileSync(new URL('../app/+html.tsx',import.meta.url),'utf8');assert.match(source,/import \{ ScrollViewStyleReset \} from "expo-router\/html"/);assert.match(source,/<ScrollViewStyleReset \/>/);
});
