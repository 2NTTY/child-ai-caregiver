import {createFixture} from './fixture.mjs';
import {mountProgress} from './view.mjs';
import {bindLifecycle} from './lifecycle.mjs';
const fixture=createFixture();
const view=mountProgress(document,fixture);
bindLifecycle(window,fixture,view);
