import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrivateDraft, parsePrivateFacts, parsePrivateReview, parsePrivateVerdict } from '../server/private-source-reading.ts';
import { parsePersonalPage } from '../server/personal-source-fetch.ts';

test('a reviewer must support each indexed observation and text quotations must occur in the original', () => {
  const draft = parsePrivateFacts(JSON.stringify({ facts: [{ type: 'quotation', text: 'blue bag' }] }), 'Pack the blue bag.');
  assert.equal(draft[0]?.text, 'blue bag');
  assert.throws(() => parsePrivateFacts(JSON.stringify({ facts: [{ type: 'quotation', text: 'red bag' }] }), 'Pack the blue bag.'));
  assert.throws(() => parsePrivateFacts(JSON.stringify({ facts: [{ type: 'visual_description', text: 'blue bag' }] }), 'Pack the blue bag.'));
  assert.equal(parsePrivateReview('{"supported":[true]}', 1), true);
  assert.equal(parsePrivateReview('{"supported":[false]}', 1), false);
  assert.throws(() => parsePrivateReview('{"supported":[true]}', 2));
});

test('an optional topic needs a literal quotation and a separate affirmative review', () => {
  const text = 'Put the coins in two envelopes.', facts = [{type:'quotation',text}];
  const parse = (topic:unknown) => parsePrivateDraft(JSON.stringify({facts,topic}),text);
  assert.deepEqual(parse(null),{facts,topic:undefined});
  assert.equal(parse({label:'金錢管理',evidence:'Save money'}).topic,undefined);
  const topic = {label:'金錢管理',evidence:'coins in two envelopes'};
  assert.deepEqual(parse(topic).topic,topic);
  assert.equal(parsePrivateDraft(JSON.stringify({facts:[{type:'visual_description',text}],topic}),null).topic,undefined);
  assert.deepEqual(parsePrivateVerdict('{"supported":[true]}',1),{factsSupported:true,topicSupported:false});
  assert.deepEqual(parsePrivateVerdict('{"supported":[true],"topicSupported":"true"}',1),{factsSupported:true,topicSupported:false});
  assert.throws(()=>parsePrivateVerdict('{"supported":[],"topicSupported":true}',1));
});

test('registered HTML drops standalone publisher labels and keeps linked words in sentences', () => {
  const url = 'https://publisher.example.org/page', anchor = '<a rel="category" href="/coins">coins</a>';
  const html = '<article><h1>Envelopes</h1><p>Count the '+anchor+'.</p><ul><li>Keep '+anchor+'</li></ul>'+
    '<div>Sort the '+anchor+'.</div><p>'+anchor+'</p></article>';
  const text = parsePersonalPage(html,url,true).text;
  assert.match(text,/Count the coins\./u); assert.match(text,/Keep coins/u); assert.match(text,/Sort the coins\./u);
  assert.equal(text.match(/coins/gu)?.length,3);
  assert.equal(parsePersonalPage(html,url).text.match(/coins/gu)?.length,4);
});
