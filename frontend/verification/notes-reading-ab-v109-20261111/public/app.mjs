import {createState, transition} from './notes-state.mjs';
import {renderNotes} from './notes-view.mjs';

export function mount(root, document) {
  let state = createState(), disposed = false, activeHeading = null;
  const controls = document.createElement('div');
  controls.setAttribute('class', 'variant-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '閱讀版式');
  const workspace = document.createElement('div');
  workspace.setAttribute('class', 'reading-workspace');
  const description = document.createElement('p');
  description.setAttribute('class', 'layout-description');
  const listeners = [];
  const buttons = new Map();
  for (const [variant, label] of [['A', 'A · 索引與全文'], ['B', 'B · 連續閱讀']]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.setAttribute('id', `variant-${variant}`);
    button.setAttribute('type', 'button');
    button.setAttribute('data-variant', variant);
    const changeLayout = () => {
      if (disposed) return;
      const next = transition(state, {type: 'LAYOUT', value: variant});
      if (next !== state) {state = next; render();}
    };
    button.addEventListener('click', changeLayout);
    listeners.push([button, changeLayout]);
    buttons.set(variant, button);
    controls.append(button);
  }
  function read(id) {
    if (disposed || state.layout !== 'A') return;
    const next = transition(state, {type: 'READ', id});
    if (next === state && id !== state.activeId) return;
    if (next !== state) {state = next; render();}
    activeHeading.focus();
  }
  function render() {
    for (const [variant, button] of buttons) button.setAttribute('aria-pressed', String(state.layout === variant));
    description.textContent = state.layout === 'A' ? '先選一則，再專心讀完整內容。' : '把三則備註放在一起，依序連續閱讀。';
    const rendered = renderNotes(document, state, read);
    activeHeading = rendered.activeHeading;
    workspace.replaceChildren(rendered.element);
  }
  root.replaceChildren(controls, description, workspace);
  render();
  return {
    getState: () => state,
    destroy() {
      if (disposed) return;
      disposed = true;
      for (const [button, handler] of listeners) button.removeEventListener('click', handler);
      root.replaceChildren();
      activeHeading = null;
    },
  };
}
if (typeof document !== 'undefined') {
  const root = document.getElementById('reading-demo');
  if (root) mount(root, document);
}
