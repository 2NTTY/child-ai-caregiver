// Self-written synthetic harness, not an application writer or recovery owner.
import { createRecoveryAuthority } from './authority.mjs';
import { mountRecovery } from './view.mjs';
const syntheticError = () => ({ name: 'TypeError', message: 'Synthetic render fixture', stack: 'TypeError: synthetic\n at preview (synthetic.bundle:18:4)\n at frame (synthetic.bundle:42:9)' });
export function mountLab(document) {
  let live = true;
  const requests = [], removers = [];
  const owner = createRecoveryAuthority({
    retry(token) {
      return new Promise((resolve, reject) => { requests.push({ ...token, resolve, reject, settled: false }); });
    },
    home() {},
  });
  owner.present('chat', syntheticError());
  const view = mountRecovery(document, document.querySelector('#recovery-host'), owner);
  const current = () => requests.find(r => !r.settled && r.generation === owner.snapshot().generation && owner.snapshot().phase === 'pending');
  const stale = () => requests.find(r => !r.settled && r !== current());
  function sync() {
    if (!live) return;
    const s = owner.snapshot();
    document.querySelector('#scope-label').textContent = s.scope === 'chat' ? '聊天頁面 / LOCAL' : '全域頁面 / LOCAL';
    document.querySelector('#receipt').textContent = `合成故障世代 ${s.generation} · retry callback ${s.attempts} 次 · home callback ${s.homeCalls} 次 · ${s.phase}`;
    for (const key of ['resolve', 'reject']) document.querySelector(`[data-lab="${key}"]`).disabled = !current();
    document.querySelector('[data-lab="late"]').disabled = !stale();
  }
  function bind(n, fn) { const onClick = () => { if (live) fn(); }; n.addEventListener('click', onClick); removers.push(() => n.removeEventListener('click', onClick)); }
  for (const b of document.querySelectorAll('[data-choose-layout]')) bind(b, () => {
    for (const n of document.querySelectorAll('[data-choose-layout]')) n.setAttribute('aria-pressed', String(n === b));
    view.setLayout(b.dataset.chooseLayout);
  });
  for (const b of document.querySelectorAll('[data-lab]')) bind(b, () => {
    const action = b.dataset.lab;
    if (['new-chat', 'new-root', 'loading'].includes(action)) {
      owner.present(action === 'new-chat' ? 'chat' : 'root', action === 'loading' ? null : syntheticError());
      document.querySelector('#lab-status').textContent = '已換成新的合成場景。舊 callback 若仍在等待，可測試晚到；沒有假稱取消舊工作。';
    } else {
      const r = action === 'late' ? stale() : current();
      if (!r) return;
      r.settled = true;
      if (action === 'reject') r.reject(new Error('Synthetic callback rejection'));
      else r.resolve();
      document.querySelector('#lab-status').textContent = action === 'late' ? '舊合成 callback 已結束；退休世代的結果不應改變目前候選畫面。' : action === 'reject' ? '已拒絕當前合成 callback。這不是服務或網絡錯誤診斷。' : '已完成當前合成 callback。這不代表產品或資料已恢復。';
      sync();
    }
  });
  const unsubscribe = owner.subscribe(sync); sync();
  return { owner, view, dispose() { if (!live) return; live = false; removers.forEach(fn => fn()); unsubscribe(); view.dispose(); owner.retire(); } };
}
