import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AgentBudget } from '../server/agent-budget.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { chatDeliveryPassNeedsSources } from '../server/chat-delivery-review.ts';

test('a companion restatement preserves the original while an unsupported sibling can be corrected in the same run', async () => {
  const budget = new AgentBudget();
  const scope = { userId: 'actor', workspaceId: randomUUID(), childId: randomUUID(), authorizationVersion: '1', dataVersion: '1' };
  const runId = randomUUID();
  const selected = { citationId: 'page-item', classification: 'private', version: 'task/1', contentHash: 'a'.repeat(64), excerptComplete: true,
    excerpt: JSON.stringify({title:'親子活動準備', details:'檯面上有一本藍色圖畫書和一個沙槌。'}) };
  try {
    const surface = createProductAgentTools({ run: {runId, scope, budget}, authorize: async () => true,
      currentMessageId: randomUUID(), trustedUserMessage: '呢項待辦準備咗邊兩樣嘢？', pageEvidence: {source:selected, isCurrent:async () => true},
      knowledge: {createRun: () => ({})}, memory:{}, tasks:{}, store:{} } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const present = surface.tools.find(t => t.name === 'present_answer')!;
    const call = {scope, runId, callId:randomUUID(), signal:budget.signal};
    const item = {kind:'private_reference', text:'這兩樣物件是藍色圖畫書和沙槌。', citationIds:[]};
    const wrongId = await present.execute({kind:'operation', paragraphs:[{text:item.text, citationIds:[randomUUID()]}]}, call);
    assert.partialDeepStrictEqual(wrongId, {status:'rejected', data:{code:'invalid_citation',
      selectedItemCitation:{kind:'private_reference', citationIds:[selected.citationId]}}});
    const unsupported = {kind:'clarification', text:'孩子每次都能專心一小時。', citationIds:[]};
    const bad = await present.execute({kind:'mixed', paragraphs:[item,unsupported]}, call);
    assert.partialDeepStrictEqual(bad, {status:'rejected',data:{code:'attached_claim_needs_evidence',unsupportedParagraphNumbers:[2]}});
    const hint = (wrongId.data as {selectedItemCitation:{kind:string;citationIds:string[]}}).selectedItemCitation;
    const result = await present.execute({kind:hint.kind, paragraphs:[{text:item.text,citationIds:hint.citationIds}]}, call);
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(surface.deliveryDraft()?.sources, [selected]);
    assert.deepEqual(surface.deliveryDraft()?.paragraphs[0]?.citationIds, ['page-item']);
    const implicit = await present.execute({kind:'private_reference', paragraphs:[item]}, call);
    assert.equal(implicit.status, 'succeeded');
    assert.deepEqual(surface.deliveryDraft()?.paragraphs[0]?.citationIds, ['page-item']);
  } finally { budget.close(); }
});

test('a rejected speaker can recover the already registered references without a second search', async () => {
  const budget = new AgentBudget(), runId = randomUUID(), chunkId = randomUUID();
  const scope = {userId:'parent', workspaceId:randomUUID(), childId:randomUUID(), authorizationVersion:'1', dataVersion:'1'};
  const page = {citationId:'page-item', classification:'private', version:'task/1', contentHash:'a'.repeat(64),
    excerptComplete:true, excerpt:JSON.stringify({details:'藍色圖畫書和沙槌'})};
  const chunk = {chunkId, title:'幼兒遊戲', section:'親子共讀', text:'一起看圖畫書。', classification:'official_guidance'};
  try {
    const surface = createProductAgentTools({discussion:true, run:{runId,scope,budget}, authorize:async () => true,
      pageEvidence:{source:page,isCurrent:async () => true}, seededOfficialEvidence:[{chunk,filter:{classification:'official_guidance'}}],
      knowledge:{createRun:() => ({seedEvidence() {}})}, memory:{}, tasks:{}, store:{},
    } as unknown as Parameters<typeof createProductAgentTools>[0]);
    surface.beginDiscussionTurn!('speaker');
    const speaker = surface.tools.find(t => t.name === 'share_knowledge_view')!;
    const call = {scope,runId,callId:randomUUID(),signal:budget.signal};
    const view = {kind:'caregiving',text:'可以一起看圖畫書。',citationIds:[chunkId, page.citationId]};
    const rejected = await speaker.execute(view,call);
    assert.partialDeepStrictEqual(rejected,{status:'rejected',data:{code:'invalid_citation',
      selectedItemCitation:{kind:'private_reference',citationIds:['page-item']},availableOfficialCitationIds:[{chunkId}]}});
    assert.equal(surface.nextDiscussionTool!(),'share_knowledge_view');
    assert.equal((await speaker.execute({...view,citationIds:[chunkId]},call)).status,'succeeded');
    assert.equal(surface.nextDiscussionTool!(),'ask_parent_view');
  } finally { budget.close(); }
});

test('a read-only discussion closing binds a mislabeled task restatement to its selected page for review', async () => {
  const budget = new AgentBudget(), runId = randomUUID(), chunkId = randomUUID();
  const scope = { userId:'parent', workspaceId:randomUUID(), childId:randomUUID(), authorizationVersion:'1', dataVersion:'1' };
  const page = { citationId:'page-item', classification:'private', version:'task/1', contentHash:'a'.repeat(64),
    excerptComplete:true, excerpt:JSON.stringify({title:'活動材料',details:'袋中有綠色積木和兩張卡紙。'}) };
  const chunk = { chunkId, title:'活動示例', section:'顏色', text:'家長可以和孩子一起找相同顏色的積木。', classification:'official_guidance' };
  const call = {scope, runId, callId:randomUUID(), signal:budget.signal};
  try {
    const surface = createProductAgentTools({discussion:true, run:{runId,scope,budget}, authorize:async () => true,
      pageEvidence:{source:page,isCurrent:async () => true}, seededOfficialEvidence:[{chunk,filter:{classification:'official_guidance'}}],
      knowledge:{createRun:() => ({seedEvidence() {}})}, memory:{}, tasks:{}, store:{},
    } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const speak = (name: string, args: Record<string, unknown>) => surface.tools.find(t => t.name === name)!.execute(args,call);
    const knowledge = {text:'我會一起找同色的積木。', citationIds:[chunkId]};
    const parent = {text:'如果他挑另一種顏色，我也可以跟着找嗎？', citationIds:[chunkId]};
    const closing = {text:'我會請他選顏色，再一齊找。', citationIds:[chunkId]};
    for (const [name,view] of [['share_knowledge_view',knowledge],['ask_parent_view',parent]] as const) {
      surface.beginDiscussionTurn!('speaker');
      assert.equal((await speak(name,view)).status,'succeeded');
    }
    surface.beginDiscussionTurn!('closing');
    const selected = {kind:'operation', text:'按「活動材料」的內容，袋內備有綠色積木及兩張卡紙。',
      citationIds:[page.citationId]};
    const advice = {kind:'caregiving', text:'可以和孩子一起找同色積木。', citationIds:[chunkId]};
    const present = (paragraph: typeof selected) =>
      speak('present_answer',{kind:'mixed', closingView:closing, paragraphs:[paragraph,advice]});
    assert.partialDeepStrictEqual(await present({...selected, text:'我已經刪除待辦。'}),
      {status:'rejected',data:{code:'attached_claim_needs_evidence',unsupportedParagraphNumbers:[4]}});
    assert.partialDeepStrictEqual(await present(selected),{status:'succeeded'});
    const draft = surface.deliveryDraft()!;
    assert.deepEqual(draft.discussionRoles,['knowledge','parent','methods']);
    assert.deepEqual(draft.paragraphs.slice(3),[{...selected,kind:'private_reference'},advice]);
    assert.deepEqual(draft.sources.find(source => source.citationId === page.citationId),page);
  } finally { budget.close(); }
});

test('a history quote may supply a fact but repeating the current page question cannot answer it', async () => {
  const budget = new AgentBudget(), runId = randomUUID();
  const scope = { userId: 'actor', workspaceId: randomUUID(), childId: randomUUID(), authorizationVersion: '1', dataVersion: '1' };
  const question = '我已準備借書證，呢個仲要帶啲咩？';
  const oldQuestion = { id:randomUUID(), childId:scope.childId, role:'user' as const, authorUserId:scope.userId, inReplyTo:null,
    createdAt:new Date().toISOString(), text:question };
  const page = { citationId:'page-item', classification:'private' as const, version:'task/1', contentHash:'a'.repeat(64),
    excerptComplete:true, excerpt:JSON.stringify({title:'手作班',details:'要帶借書證和藍色圍裙。'}) };
  function setup(request: string) {
    const tools = createProductAgentTools({run:{runId, scope, budget}, authorize:async () => true,
      currentMessageId:randomUUID(), trustedUserMessage:request, recentQuoteSources:[oldQuestion],
      pageEvidence:{source:page, isCurrent:async () => true}, memory:{}, tasks:{}, store:{}, knowledge:{createRun:() => ({})},
    } as unknown as Parameters<typeof createProductAgentTools>[0]);
    return {tools, present:tools.tools.find(t=>t.name==='present_answer')!};
  }
  const call = {scope, runId, callId:randomUUID(), signal:budget.signal};
  const quote = {quoteHistory:'R1'};
  try {
    const history = setup('我上次點問手作班要帶咩？請引返我句原話。');
    assert.equal((await history.present.execute({kind:'private_reference', paragraphs:[quote]},call)).status,'succeeded');
    const historical = history.tools.deliveryDraft()!;
    assert.equal(chatDeliveryPassNeedsSources(historical),false);
    assert.equal(chatDeliveryPassNeedsSources({...historical,userRequest:question}),true);
    const current = setup(question);
    assert.partialDeepStrictEqual(await current.present.execute({kind:'private_reference',paragraphs:[quote]},call),
      {status:'rejected',data:{code:'attached_claim_needs_evidence'}});
    const answer = {text:'仲要帶藍色圍裙。',citationIds:['page-item']};
    assert.equal((await current.present.execute({kind:'private_reference',paragraphs:[quote,answer]},call)).status,'succeeded');
    assert.deepEqual(current.tools.deliveryDraft()?.paragraphs.map(p=>p.text),['你當時說：「'+question+'」',answer.text]);
  } finally { budget.close(); }
});
