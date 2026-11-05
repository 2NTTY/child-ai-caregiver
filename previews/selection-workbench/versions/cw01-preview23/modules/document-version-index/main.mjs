import {createHost} from './model.mjs';
import {mount} from './view.mjs';
mount(document.getElementById('app'),createHost());
