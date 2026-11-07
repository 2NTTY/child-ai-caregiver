import { createState, reduce } from './model.mjs';
import { mount } from './view.mjs';

let state = createState();
const root = document.getElementById('app');
const view = mount(root, {
  getState: () => state,
  dispatch: event => {
    state = reduce(state, event);
    view.render();
  },
}, document);
