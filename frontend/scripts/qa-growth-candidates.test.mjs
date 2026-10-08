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
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || tree.props?.visible === false) return [];
  return [tree, ...nodes(tree.props?.children)];
}
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree)
  :Array.isArray(tree)?tree.map(text).join(' '):tree.props?.visible === false ? '' : text(tree.props?.children);
function render({notices=[],items=[],topics=[],access='editable',pageAvailable=true,historyHasMore=false,busy=false}={}) {
  const model={access,scopeKey:'synthetic',resetCounts:{},epoch:1,busy,
    page:pageAvailable?{items,notices,topics,historyHasMore}:null};
  const before=structuredClone(model);
  const tree=output.TaskKnowledgeGrowthCandidates({model,actions:{},onTask(){}});
  assert.deepEqual(model,before);
  return {tree,text:text(tree)};
}
test('successful empty suggestions have no extra card or misleading region and age prompts',()=>{
  for (const notices of [[],[GROWTH_KNOWLEDGE_NOTICES.region],[GROWTH_KNOWLEDGE_NOTICES.age],['Synthetic unrelated notice']]) {
    const view=render({notices});
    assert.equal(nodes(view.tree).some(node=>node.type==='Card'),false);
    assert.equal(nodes(view.tree).some(node=>node.type==='Disclosure'),false);
    assert.doesNotMatch(view.text,/成長建議|暫時沒有建議|地區資料待確認|目前無法提供適用建議/u);
  }
});
test('available topic settings keep applicability information in the secondary disclosure',()=>{
  for (const [notice,expected] of [[GROWTH_KNOWLEDGE_NOTICES.region,'目前未能將已確認地區用於建議篩選；原有資料已保留。'],[GROWTH_KNOWLEDGE_NOTICES.age,'目前的建議只適用於 0–10 歲。']]) {
    const view=render({notices:[notice],topics:[{id:'synthetic-topic'}]});
    const disclosure=nodes(view.tree).find(node=>node.type==='Disclosure');
    assert.equal(disclosure.props.label,'建議設定');
    assert.ok(text(disclosure).includes(expected));
    assert.equal(nodes(disclosure).filter(node=>node.type?.name==='TopicForm').length,1);
    assert.equal(nodes(view.tree).some(node=>node.type==='Card'),false);
  }
});
test('actual pending suggestions retain their card, source-review action and busy guard',()=>{
  const item={id:'synthetic-attention',title:'Synthetic saved candidate',kind:'observe',state:'proposed',version:3,whyNow:'Synthetic basis'};
  for (const busy of [false,true]) {
    const view=render({notices:[GROWTH_KNOWLEDGE_NOTICES.region],items:[item],busy});
    assert.match(view.text,/Synthetic saved candidate/u);
    assert.match(view.text,/Synthetic basis/u);
    assert.equal(nodes(view.tree).filter(node=>node.type==='Card').length,1);
    const button=nodes(view.tree).find(node=>node.type==='Button'&&node.props.label==='查看來源與核對候選');
    assert.equal(button.props.disabled,busy);
    assert.equal(typeof button.props.onPress,'function');
    assert.doesNotMatch(view.text,/地區資料待確認|暫時沒有建議/u);
  }
});
test('a partially loaded empty candidate window retains the explicit history limitation',()=>{
  const view=render({historyHasMore:true});
  assert.equal(nodes(view.tree).filter(node=>node.type==='Card').length,1);
  assert.match(view.text,/仍有較早建議未載入。/u);
  assert.doesNotMatch(view.text,/暫時沒有建議/u);
});
test('lost access and unread pages expose neither candidates nor settings',()=>{
  for (const options of [{access:'lost'},{pageAvailable:false}]) {
    const view=render({...options,notices:[GROWTH_KNOWLEDGE_NOTICES.region],topics:[{id:'synthetic-topic'}]});
    assert.equal(view.tree,null);
    assert.equal(view.text,'');
  }
});
