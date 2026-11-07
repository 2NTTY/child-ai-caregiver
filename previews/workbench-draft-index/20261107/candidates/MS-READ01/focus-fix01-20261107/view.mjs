import { present } from './presentation.mjs';
import { fixtureFor, scenarioIds } from './fixtures.mjs';

export function mount(root, { getState, dispatch }, document) {
  const listeners = [], buttons = new Map();
  let destroyed = false;
  let localFeedback = null;
  let focusHint = null;
  const element = (tag, text, id) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (id) node.setAttribute('id', id);
    return node;
  };
  const listen = (node, type, action) => {
    node.addEventListener(type, action); listeners.push([node, type, action]);
  };
  const header = element('header');
  header.append(element('p', 'MS-READ01 · 唯讀示例', 'readonly'),
    element('h1', '已存模型配置狀態核對卡'),
    element('p', '合成示例，未連接帳戶或模型服務', 'synthetic-notice'),
    element('p', '最後讀取的 UTC 計數日用量，不是供應商帳單', 'billing-notice'));
  const controlSection = element('section'); controlSection.setAttribute('aria-labelledby', 'controls-title');
  controlSection.append(element('h2', '合成情境控制', 'controls-title'));
  const label = element('label', '選擇固定合成情境'); label.setAttribute('for', 'scenario');
  const selector = element('select', undefined, 'scenario');
  for (const id of scenarioIds) {
    const option = element('option', fixtureFor(id).label); option.value = id; selector.append(option);
  }
  controlSection.append(label, selector);
  const actions = element('div'); actions.setAttribute('class', 'controls');
  const status = element('p', '', 'status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.setAttribute('tabindex', '-1');
  const cards = element('div'); cards.setAttribute('class', 'cards');
  const details = element('details');
  const explanation = element('p'); details.append(element('summary', '這個示例能說明甚麼？'), explanation);
  controlSection.append(actions, status);
  root.replaceChildren(header, controlSection, cards, details);

  function payloadFor(ticket) {
    const f = fixtureFor(ticket.scenarioId);
    if (ticket.kind === 'read') return { snapshot: f.snapshot };
    if (ticket.kind === 'recovery') return { snapshot: f.snapshot, receipt: f.receipt };
    if (f.metadataError) return { error: f.metadataError };
    return ticket.kind === 'check' ? { check: f.check } : { catalog: f.catalog };
  }
  function activate(id) {
    if (destroyed) return;
    const state = getState(), control = present(state).controls.find(item => item.id === id);
    if (!control || control.disabled) return;
    const trigger = buttons.get(id);
    const starter = state.pending?.kind;
    const destinations = ['read', 'check', 'catalog', 'recovery'].includes(id) ? ['complete']
      : id === 'offline' ? ['reconnect']
      : id === 'reconnect' ? ['recovery', 'read']
      : id === 'complete' || id === 'cancel' ? [starter, 'recovery', 'read'] : [];
    focusHint = document.activeElement === trigger ? { trigger, destinations } : null;
    try {
      localFeedback = null;
      if (['read', 'check', 'catalog', 'recovery'].includes(id)) dispatch({ type: 'START', kind: id });
      else if (id === 'complete' || id === 'retired') {
        const ticket = id === 'complete' ? state.pending : state.retired;
        dispatch({ type: 'COMPLETE', ticket, payload: payloadFor(ticket) });
        if (id === 'retired' && getState() === state) {
          localFeedback = { state, message: '退休結果未採用，現有讀取未變。' };
          render();
        }
      } else dispatch({ type: id.toUpperCase() });
    } finally {
      focusHint = null;
    }
  }
  for (const control of present(getState()).controls) {
    const button = element('button', control.label, control.id);
    button.setAttribute('type', 'button');
    listen(button, 'click', () => activate(control.id));
    buttons.set(control.id, button); actions.append(button);
  }
  listen(selector, 'change', () => {
    if (!destroyed && scenarioIds.includes(selector.value)) {
      localFeedback = null;
      dispatch({ type: 'SCENARIO', id: selector.value });
    }
  });

  function render() {
    if (destroyed) return;
    const focused = document.activeElement, state = getState(), view = present(state);
    selector.value = state.scenarioId;
    if (localFeedback && localFeedback.state !== state) localFeedback = null;
    status.textContent = localFeedback?.message ?? view.status;
    explanation.textContent = view.details;
    for (const control of view.controls) {
      const node = buttons.get(control.id);
      node.disabled = control.disabled;
      node.textContent = control.label;
    }
    const sections = view.cards.map(card => {
      const section = element('section'); section.setAttribute('class', 'card');
      const headingId = `heading-${card.id}`;
      section.setAttribute('aria-labelledby', headingId);
      section.append(element('h2', card.title, headingId));
      const list = element('dl');
      for (const item of card.rows) list.append(element('dt', item.label), element('dd', item.value));
      section.append(list); return section;
    });
    cards.replaceChildren(...sections);
    if (focused && root.contains(focused) && focused.disabled) {
      const target = focusHint?.trigger === focused
        ? focusHint.destinations.map(id => buttons.get(id)).find(node => node && !node.disabled)
        : null;
      (target ?? status).focus();
    }
  }
  function destroy() {
    destroyed = true;
    for (const [node, type, handler] of listeners) node.removeEventListener(type, handler);
  }
  render();
  return { render, destroy };
}
