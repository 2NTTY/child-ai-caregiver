import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './host.mjs';
import {loadRealDocument} from './real-lifecycle.mjs';
import * as oldChoices from '../history/public-v105/dist/experiments/workbench-compare/design-choices.mjs';
const oldRoot=new URL('../history/public-v105/dist/experiments/workbench-compare/',import.meta.url);

// Break caught: Chat-specific explanatory copy spills into other existing readiness routes.
test('non-Chat readiness routes retain their existing waiting pick-note text',async()=>{
 for(const route of ['tasks','care','settings','growth']){
  const current=host(),old=host({appRoot:oldRoot,choiceModule:oldChoices});
  for(const h of [current,old]){h.ids.route.value=route;h.setAnswer(true);await h.click('apply');h.screen('left',{page:route});await loadRealDocument(h,'left');}
  assert.equal(current.ids['left-pick-note'].textContent,old.ids['left-pick-note'].textContent,route);
  assert.equal(current.frame('left').inert,old.frame('left').inert,route);
 }
});
