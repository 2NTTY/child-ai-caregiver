// Original DOM projection. Does not prove RN/OS/AT announcement behavior.
import { channels } from './fixture-owner.mjs';
export function mountLive(document, host, owner) {
  let nodes = {}, revisions = {}, generation = null, mounted = null;
  function render(state) {
    if (generation !== state.generation || mounted !== state.mounted) {
      host.replaceChildren(); nodes = {}; revisions = {};
      generation = state.generation; mounted = state.mounted;
      if (mounted) for (const channel of channels) {
        const node = document.createElement('span');
        node.className = 'visually-hidden'; node.dataset.live = channel;
        node.setAttribute('aria-live', 'polite'); host.append(node); nodes[channel] = node;
      }
    }
    if (!mounted) return;
    for (const channel of channels) {
      const accepted = state.accepted[channel], node = nodes[channel];
      if (revisions[channel] === accepted.revision) continue;
      revisions[channel] = accepted.revision;
      const priority = accepted.urgent ? 'assertive' : 'polite';
      if (node.getAttribute('aria-live') !== priority) node.setAttribute('aria-live', priority);
      if (accepted.urgent) { if (node.getAttribute('role') !== 'alert') node.setAttribute('role', 'alert'); }
      else node.removeAttribute('role');
      const text = accepted.message ? `狀態：${accepted.message}` : '';
      if (node.textContent !== text) node.textContent = text;
    }
  }
  render(owner.snapshot());
  const unsubscribe = owner.subscribe(render);
  return { dispose() { unsubscribe(); host.replaceChildren(); } };
}
