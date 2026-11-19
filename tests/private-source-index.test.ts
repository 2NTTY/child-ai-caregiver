import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrivateFacts, parsePrivateReview } from '../server/private-source-reading.ts';

test('a reviewer must support each indexed observation and text quotations must occur in the original', () => {
  const draft = parsePrivateFacts(JSON.stringify({ facts: [{ type: 'quotation', text: 'blue bag' }] }), 'Pack the blue bag.');
  assert.equal(draft[0]?.text, 'blue bag');
  assert.throws(() => parsePrivateFacts(JSON.stringify({ facts: [{ type: 'quotation', text: 'red bag' }] }), 'Pack the blue bag.'));
  assert.throws(() => parsePrivateFacts(JSON.stringify({ facts: [{ type: 'visual_description', text: 'blue bag' }] }), 'Pack the blue bag.'));
  assert.equal(parsePrivateReview('{"supported":[true]}', 1), true);
  assert.equal(parsePrivateReview('{"supported":[false]}', 1), false);
  assert.throws(() => parsePrivateReview('{"supported":[true]}', 2));
});
