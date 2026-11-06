// NEW SYNTHETIC ADAPTER. This does not instantiate ProductionProvider or ChatController.
import { createAssistantDraftOwner, homeAgentScope } from './source-derived.mjs';

export function createQuickFixture() {
  const draft = createAssistantDraftOwner();
  const listeners = new Set(), metadata = new Map();
  let context = { scope: 'synthetic-child-A', path: '/', private: true };
  let generation = 0, serial = 0, active = null, disposed = false;
  let text = '', operation = null, notice = '選擇入口，先看目的地。所有結果僅在本頁模擬。';
  const receipts = [];
  const scope = () => context.private ? homeAgentScope({ scopeKey: context.scope }) : null;
  draft.retainScope(scope());
  const available = () => !disposed && !!scope() && context.path === '/';
  const emit = () => { if (!disposed) [...listeners].forEach(listener => listener()); };
  const say = value => { notice = value; emit(); };
  const retire = () => { active = null; generation++; };
  const snapshot = () => ({
    text, attachments: draft.getSnapshot().attachments.map(({ id, kind, fileName, mimeType, bytes }) => ({ id, kind, fileName, mimeType, bytes })),
    phase: operation?.phase ?? 'idle', operation: operation ? { ...operation } : null,
    receipts: receipts.map(item => ({ ...item })),
    ledger: [...metadata.values()].map(({ id, status, transfers, disposals }) => ({ id, status, transfers, disposals })),
    context: { ...context }, generation, notice, disposed, available: available(),
  });
  const release = item => {
    const entry = metadata.get(item);
    if (!entry || entry.status === 'released') return;
    entry.status = 'released'; entry.disposals++;
  };
  const dirty = () => !!text || draft.getSnapshot().attachments.length > 0;
  return {
    snapshot,
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => listeners.delete(listener); },
    loadText() {
      if (!available() || operation || text) return false;
      text = '合成示例：想和助手討論今天的午睡安排。';
      say('示例文字留在同一草稿中；快捷入口不會送出。'); return true;
    },
    markOperation(phase) {
      if (!available() || operation || !['pending', 'unknown'].includes(phase)) return false;
      retire();
      text ||= '合成示例：想和助手討論今天的午睡安排。';
      operation = { id: 'synthetic-original-001', phase, text };
      say(phase === 'pending' ? '載入合成處理中情境；原操作不能在這裡替換。' : '載入合成結果未定情境；需回原處理頁核對同一操作。'); return true;
    },
    setContext(next) {
      if (disposed) return false;
      if (operation || dirty()) { say('目前草稿或原操作仍保留；這裡不切換範圍。'); return false; }
      if (!['synthetic-child-A', 'synthetic-child-B'].includes(next.scope) || !['/', '/care'].includes(next.path) || typeof next.private !== 'boolean') return false;
      retire(); context = { ...next }; draft.retainScope(scope());
      say(available() ? '目前為合成私人首頁，可選擇入口。' : '目前不是可接納輸入的私人首頁；舊入口已退役。'); return true;
    },
    begin(kind) {
      if (!available() || !['text', 'photo', 'care'].includes(kind)) return null;
      retire();
      active = Object.freeze({ kind, generation, scope: scope(), path: context.path });
      return active;
    },
    makeMetadata() {
      if (disposed) return null;
      const id = `synthetic-metadata-${++serial}`;
      const item = Object.freeze({ id, kind: 'photo', fileName: '合成示例照片.jpg', mimeType: 'image/jpeg', bytes: 2048, dispose: () => release(item) });
      metadata.set(item, { id, status: 'local', transfers: 0, disposals: 0 });
      return item;
    },
    complete(ticket, item) {
      const entry = item && metadata.get(item);
      if (item && (!entry || entry.status !== 'local')) return false;
      if (!ticket || ticket !== active || ticket.generation !== generation || ticket.scope !== scope() || ticket.path !== context.path || !available()) {
        if (entry) { release(item); say('較早的合成附件已釋放；目前草稿沒有變更。'); }
        return false;
      }
      active = null; // Consume BEFORE notifying subscribers or transferring ownership.
      if (ticket.kind === 'photo') {
        if (!entry || operation || draft.getSnapshot().attachments.length) {
          if (entry) release(item);
          say('保留原草稿與附件；新中繼資料未接納，已釋放。可繼續選擇其他入口。'); return false;
        }
        entry.status = 'transferred'; entry.transfers++;
        if (!draft.add(scope(), item)) { release(item); say('未接納合成附件；沒有送出。'); return false; }
      } else if (entry) {
        release(item); say('這個入口不接收附件；合成中繼資料已釋放。'); return false;
      }
      receipts.push({ id: `synthetic-intent-${receipts.length + 1}`, kind: ticket.kind, destination: ticket.kind === 'care' ? '/care' : '/chat', synthetic: true });
      say(ticket.kind === 'photo' ? '已接納合成中繼資料，目的地意圖為對話。尚未導航、上傳或保存。' : '已記下合成目的地意圖；原草稿保留。尚未導航、送出或寫入記錄。');
      return true;
    },
    retire,
    reset() {
      if (disposed) return false;
      if (operation) { say('原操作仍在處理或結果未定，不能重置；換介面也會保留。'); return false; }
      retire(); draft.clearAttachments(scope());
      for (const [item, entry] of metadata) if (entry.status === 'local') release(item);
      text = ''; receipts.length = 0; say('已清除本頁普通合成草稿；沒有刪除任何正式資料。'); return true;
    },
    dispose() {
      if (disposed) return;
      retire(); disposed = true;
      draft.dispose();
      for (const [item, entry] of metadata) if (entry.status === 'local') release(item);
      listeners.clear(); text = '';
    },
  };
}
