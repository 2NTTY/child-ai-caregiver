import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { GROWTH_KNOWLEDGE_NOTICES, growthActionSchema, growthTopicActionSchema } from '../../src/shared/growth.ts';

// Render the actual candidate component with the existing shallow UI harness.
// No browser, API, model or authenticated family data is involved.
const jsx=(type,props)=>({type,props});
const mocks={
  react:{useEffect(){},useRef:value=>({current:value}),useState:value=>[value,()=>{}]},
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Linking:{}},'react-native-paper':{Text:'Text'},
  'react-hook-form':{},'../../../src/shared/growth':{GROWTH_KNOWLEDGE_NOTICES,growthActionSchema,growthTopicActionSchema},
  '../growth-view-model':{growthKindLabels:{observe:'觀察'},growthStateLabels:{proposed:'建議'}},
  '../components/AppCheckbox':{},'../components/AppDialog':{AppDialog:{Title:'Title',ScrollArea:'ScrollArea',Actions:'Actions'}},
  '../components/AppScrollView':{AppScrollView:'ScrollView'},'../components/DateTimeFields':{},
  '../components/ui':{SectionCard:'Card',SectionHeader:'Header',AppButton:'Button'},
  '../components/summary/SummaryDisclosure':{SummaryDisclosure:'Disclosure'},
  '../components/growth/GrowthOperationRecovery':{GrowthOperationRecovery:'Recovery'},
  '../components/growth/growth-styles':{growthStyles:{}},
  '../preview/PreviewNavigationGuard':{usePreviewNavigation:()=>callback=>callback()},
};
const source=readFileSync(new URL('../src/production/TaskKnowledgeGrowthCandidates.tsx',import.meta.url),'utf8');
const output={},compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',compiled)(name=>{assert.ok(mocks[name],name);return mocks[name];},output);
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree)
  :Array.isArray(tree)?tree.map(text).join(' '):text(tree.props?.children);
function render(notices=[],items=[],access='ready',pageAvailable=true){
  return text(output.TaskKnowledgeGrowthCandidates({model:{access,scopeKey:'synthetic',resetCounts:{},epoch:1,
    page:pageAvailable?{items,notices,topics:[],historyHasMore:false}:null},actions:{},onTask(){}}));
}
test('unsupported region renders a compact limitation rather than a successful empty suggestion state',()=>{
  const view=render([GROWTH_KNOWLEDGE_NOTICES.region]);assert.match(view,/地區資料待確認。/u);
  assert.doesNotMatch(view,/暫時沒有建議|尚未能把已確認地域/u);
});
test('out-of-scope age renders a compact applicability limitation',()=>{
  const view=render([GROWTH_KNOWLEDGE_NOTICES.age]);assert.match(view,/目前無法提供適用建議。/u);
  assert.doesNotMatch(view,/暫時沒有建議|知識及成長規則目前只覆蓋/u);
});
test('a normal empty page keeps its existing empty-state copy',()=>{
  assert.match(render(),/暫時沒有建議。/u);assert.doesNotMatch(render(),/地區資料待確認|無法提供適用建議/u);
});
test('other notices do not create the new unsupported-basis state',()=>{
  assert.match(render(['需要有效的出生日期才可套用本批年齡規則。','Synthetic unrelated notice']),/暫時沒有建議。/u);
});
test('existing candidates remain visible instead of being replaced by an empty-state limitation',()=>{
  const view=render([GROWTH_KNOWLEDGE_NOTICES.region],[{id:'synthetic-attention',title:'Synthetic saved candidate',kind:'observe',state:'proposed',version:3,whyNow:'Synthetic basis'}]);
  assert.match(view,/Synthetic saved candidate/u);assert.doesNotMatch(view,/地區資料待確認|暫時沒有建議/u);
});
test('lost access and unread pages expose neither candidates nor limitations',()=>{
  assert.equal(render([GROWTH_KNOWLEDGE_NOTICES.region],[],'lost'),'');
  assert.equal(render([GROWTH_KNOWLEDGE_NOTICES.age],[],'ready',false),'');
});
