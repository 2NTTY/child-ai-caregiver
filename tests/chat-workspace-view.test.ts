import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AgentBudget } from '../server/agent-budget.ts';
import { directoryPageReference, directoryPagesCurrent, displayAccountMessage, type AccountDirectory } from '../server/agent-account-directory.ts';
import { ACCOUNT_DIRECTORY_ANSWER } from '../src/shared/chat-workspace-view.ts';
import type { ChatMessage } from '../src/shared/chat.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';

test('personal assistant reads workspace data on demand, paginates and composes an answer', async () => {
  const budget = new AgentBudget(), runId = randomUUID();
  const scope = { userId: 'actor', childId: randomUUID(), workspaceId: 'home', authorizationVersion: '1', dataVersion: '1' };
  const other = randomUUID(), calls: unknown[] = [];
  let allowed = true;
  const directory = { async list(userId: string, cursor?: string | null) {
    calls.push([userId, cursor ?? null]);
    return cursor ? {children:[{id:other, displayName:'第二位'}], nextCursor:null} :
      {children:[{id:scope.childId, displayName:'第一位'}], nextCursor:'opaque-server-cursor'};
  }};
  const make = (extra = {}) => createProductAgentTools({ run: {runId, scope, budget, completeText: async () => 'READ_DIRECTORY'}, authorize: async () => allowed,
    trustedUserMessage: '我帳戶底下有邊幾個小朋友', currentMessageId: randomUUID(), conversationWindow: {messages:4,complete:false},
    accountChildren: directory, knowledge:{createRun:()=>({})}, memory:{}, tasks:{}, store:{}, ...extra
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const toolCall = {scope,runId,callId:randomUUID(),signal:budget.signal};
  try {
    const surface = make(), reader = surface.tools.find(t=>t.name==='read_account_context');
    assert.ok(reader); assert.deepEqual(calls,[]);
    const read = async (params: Record<string,unknown>) => {
      const reply = await reader.execute({subject:'children',...params},toolCall); assert.equal(reply.status,'succeeded');
      return (reply.data as any).result;
    };
    const speaker = make({trustedUserMessage:'我是誰',run:{runId,scope,budget,completeText:async ()=>'READ_SPEAKER'}});
    const identity = await speaker.tools.find(t=>t.name==='read_account_context')!.execute({subject:'children'},toolCall);
    assert.equal(identity.reference,'speaker');
    let scopeChecks = 0;
    const unrelated = make({trustedUserMessage:'你係咩助手？我想填屋企語言，你先問我，唔好儲住。',run:{runId,scope,budget,
      completeText:async () => { scopeChecks++; return 'KEEP_PRIVATE'; }}});
    const unrelatedReader = unrelated.tools.find(t=>t.name==='read_account_context')!;
    assert.equal(scopeChecks, 0);
    for (const subject of ['speaker', 'children']) {
      const refused = await unrelatedReader.execute({subject},toolCall);
      assert.equal(refused.status,'rejected');
      assert.equal(refused.reference,undefined);
      assert.ok(!JSON.stringify(refused.data).includes('workspace:speaker'));
    }
    assert.equal(scopeChecks, 1);
    assert.deepEqual(calls,[]);
    const first = await read({subject:'speaker'});
    assert.equal(first.children.length,1); assert.ok(first.nextPage);
    assert.deepEqual(first.children,[{displayName:'第一位',selected:true}]);
    assert.equal(JSON.stringify(first).includes(scope.childId),false);
    const second = await read({page:first.nextPage});
    assert.equal(second.nextPage,null);
    assert.deepEqual(calls,[['actor',null],['actor','opaque-server-cursor']]);
    const present=surface.tools.find(t=>t.name==='present_answer')!;
    assert.equal(present.parameters.safeParse({kind:'operation',paragraphs:[{showView:'child_profiles'}]}).success,false);
    const text='分兩頁查到兩位：'+first.children[0].displayName+'、'+second.children[0].displayName+'。';
    assert.equal((await present.execute({kind:'private_reference',paragraphs:[{text,citationIds:[first.citationId,second.citationId]}]},toolCall)).status,'succeeded');
    assert.ok((await surface.presentation())?.text.startsWith(text)); assert.equal(surface.deliveryDraft()?.serverSubstitutedReceiptText,false);
    const window = surface.tools.find(t=>t.name==='read_conversation_window')!;
    assert.equal(((await window.execute({},toolCall)).data as any).result.messages,4);
    for(const extra of [{background:true},{visibility:'family'},{currentMessageId:undefined}]) {
      assert.equal(make(extra).tools.some(t=>t.name==='read_account_context'||t.name==='read_conversation_window'),false);
    }
    allowed=false;
    await assert.rejects(reader.execute({subject:'children'},toolCall));
  } finally { budget.close(); }
});

test('an account answer follows the original run and cannot disclose a changed roster', async () => {
  const id = randomUUID(), runId = randomUUID();
  const child = {id, displayName:'Before', createdAt:new Date().toISOString(), workspaceId:randomUUID(), accessRole:'owner' as const};
  let current = {...child};
  const directory: AccountDirectory = {async list(owner) {
    assert.equal(owner, 'owner');
    return {children:[current],nextCursor:null};
  }};
  const refs = [directoryPageReference(1, await directory.list('owner'))];
  assert.equal(await directoryPagesCurrent(directory,'owner',refs),true);
  current = {...child,displayName:'After'};
  assert.equal(await directoryPagesCurrent(directory,'owner',refs),false);
  current = {...child,id:randomUUID()};
  assert.equal(await directoryPagesCurrent(directory,'owner',refs),false);
  const message = {role:'model',agentRunId:runId,childId:id,text:ACCOUNT_DIRECTORY_ANSWER} as ChatMessage;
  const hidden = await displayAccountMessage(message,'owner',async (owner,childId,receipt) => {
    assert.deepEqual([owner,childId,receipt],['owner',id,runId]);
    return null;
  });
  assert.equal(hidden.text,'名冊已變更，請重新查詢。');
  const ordinary = {...message,role:'user' as const};
  assert.equal(await displayAccountMessage(ordinary,'owner',async()=>{throw Error('Unexpected lookup');}),ordinary);
});
