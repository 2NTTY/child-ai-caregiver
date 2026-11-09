import test from 'node:test';
import assert from 'node:assert/strict';
let globalReads = 0;
for (const key of ['window', 'document', 'localStorage']) Object.defineProperty(globalThis, key, {
  configurable: true, get() { globalReads++; throw new Error('unexpected global access'); },
});
const storage = await import('../src/preview/task-header-actions-hf01/recipe-storage.ts');
for (const key of ['window', 'document', 'localStorage']) delete (globalThis as Record<string, unknown>)[key];
const { RECIPE_KEY, makeHeaderSelection, serializeHeaderRecipe } = await import('../src/preview/task-header-actions-hf01/selection.ts');
const choice = { current: makeHeaderSelection('fourth'), undo: [null], revision: 7 };
const json = serializeHeaderRecipe(choice).json;
function port(initial: string | null = null) {
  let value = initial;
  const reads: string[] = [], writes: [string,string][] = [];
  return { reads, writes, get value() { return value; }, replace(next: string | null) { value = next; },
    getItem(key: string) { reads.push(key); return value; },
    setItem(key: string, next: string) { writes.push([key,next]); value = next; },
  };
}
const inspect = storage.inspectHeaderRecipe;
const save = storage.saveHeaderRecipe;

test('import does not inspect globals or open storage', () => {
  assert.equal(globalReads, 0);
  assert.equal(storage.unreadHeaderRecipe().status, 'unread');
});
test('empty new namespace is inspected without an initial H write', () => {
  const p=port(); const result=inspect(p);
  assert.equal(result.status,'empty'); assert.equal(result.writable,true);
  assert.deepEqual(p.reads,[RECIPE_KEY]); assert.deepEqual(p.writes,[]);
});
test('valid existing recipe is a detached candidate and cannot be overwritten by choose', () => {
  const p=port(json); const result=inspect(p);
  assert.equal(result.status,'candidate'); assert.equal(result.candidate.choice.current.variantId,'fourth');
  const attempted=save(p, {current:null,undo:[],revision:0}, result);
  assert.equal(attempted.status,'unsaved'); assert.equal(attempted.candidate,result.candidate);
  assert.equal(p.value,json); assert.deepEqual(p.writes,[]);
});
test('malformed and obsolete lineage are quarantined without deleting or overwriting', () => {
  const obsolete=JSON.parse(json); obsolete.choice.current.sourceFingerprint.files[0].sha256='0'.repeat(64);
  for (const [raw,reason] of [['{bad','invalid'],[JSON.stringify(obsolete),'unavailable']] as const) {
    const p=port(raw); const receipt=inspect(p);
    assert.equal(receipt.status,'quarantined'); assert.equal(receipt.reason,reason);
    const result=save(p,choice,receipt);
    assert.equal(result.status,'quarantined'); assert.equal(p.value,raw); assert.deepEqual(p.writes,[]);
    assert.equal(receipt.candidate,null);
  }
});
test('unread and unavailable ports never write or falsely claim refresh recovery', () => {
  const p=port(); const unread=storage.unreadHeaderRecipe();
  assert.equal(save(p,choice,unread).status,'unsaved'); assert.deepEqual(p.reads,[]); assert.deepEqual(p.writes,[]);
  assert.equal(inspect(null).status,'unsaved');
  assert.equal(inspect({getItem(){throw new Error('blocked')},setItem(){assert.fail('write')}}).status,'unsaved');
});
test('saving after empty inspection writes exactly metadata in the new namespace', () => {
  const p=port(); const receipt=inspect(p); const result=save(p,choice,receipt);
  assert.equal(result.status,'saved'); assert.equal(p.writes.length,1); assert.equal(p.writes[0][0],RECIPE_KEY);
  const record=JSON.parse(p.writes[0][1]);
  assert.deepEqual(Object.keys(record).sort(),['choice','namespace','schemaVersion']);
  assert.deepEqual(Object.keys(record.choice).sort(),['current','revision','undo']);
  assert.equal(record.choice.current.variantId,'fourth'); assert.equal(record.choice.revision,7);
  assert.deepEqual(choice.undo,[null]);
});
test('explicitly accepted exact candidate can save fresh live revision, never stored authority', () => {
  const p=port(json); const receipt=inspect(p);
  const restored={...receipt.candidate.choice,revision:1};
  const result=save(p,restored,receipt,receipt.candidate);
  assert.equal(result.status,'saved'); assert.equal(JSON.parse(p.value!).choice.revision,1);
  assert.deepEqual(Object.keys(JSON.parse(p.value!).choice).sort(),['current','revision','undo']);
});
test('a different candidate object cannot authorize overwriting the existing recipe', () => {
  const p=port(json); const receipt=inspect(p);
  const result=save(p,choice,receipt,structuredClone(receipt.candidate));
  assert.equal(result.status,'unsaved'); assert.deepEqual(p.writes,[]);
});
test('write failure retains memory and exact baseline for an explicit save retry', () => {
  const p=port(); const receipt=inspect(p); let fail=true;
  const failing={getItem:p.getItem,setItem(key:string,value:string){if(fail)throw new Error('quota'); p.setItem(key,value)}};
  const result=save(failing,choice,receipt);
  assert.equal(result.status,'unsaved'); assert.equal(result.reason,'write-failed'); assert.equal(result.writable,true);
  assert.equal(choice.revision,7); assert.equal(choice.current.variantId,'fourth'); assert.deepEqual(choice.undo,[null]);
  fail=false; assert.equal(save(failing,choice,result).status,'saved'); assert.equal(p.writes.length,1);
});
test('changed or deleted storage quarantines the conflict instead of overwriting it', () => {
  for (const changed of ['{"another":"author"}',null]) {
    const p=port(json); const receipt=inspect(p); p.replace(changed);
    const result=save(p,choice,receipt,receipt.candidate);
    assert.equal(result.status,'quarantined'); assert.equal(result.reason,'changed');
    assert.equal(p.value,changed); assert.deepEqual(p.writes,[]);
  }
});
test('read failure before save leaves memory unsaved and does not invoke setItem', () => {
  const p=port(); const receipt=inspect(p);
  const result=save({getItem(){throw new Error('denied')},setItem(){assert.fail('must not write')}},choice,receipt);
  assert.equal(result.status,'unsaved'); assert.equal(result.reason,'read-failed'); assert.equal(choice.revision,7);
});
test('invalid choice cannot transmit unexpected model data through the storage port', () => {
  const p=port(); const result=save(p,{...choice,model:{family:'synthetic'}},inspect(p));
  assert.equal(result.status,'unsaved'); assert.equal(result.reason,'invalid-memory'); assert.deepEqual(p.writes,[]);
});
