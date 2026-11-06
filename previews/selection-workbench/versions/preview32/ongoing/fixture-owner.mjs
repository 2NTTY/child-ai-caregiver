import { projectOngoing, selectHomeOverview } from './source-projection.mjs';

// A deliberately new, synthetic read owner. It never calls the product, a model, or a writer.
export function demoConcerns(scope = 'A') {
  const childId = `synthetic-child-${scope}`;
  const names = scope === 'A' ? ['一起收拾玩具', '睡前故事的小選擇', '在公園輪流遊戲', '午餐後的安靜片刻'] : ['新故事的分享時間', '把積木放回盒子'];
  return names.map((title, index) => ({ id: `demo-${scope}-${index + 1}`, childId, title,
    reason: ['這是一段合成示例：一起觀察孩子選擇甚麼、怎樣表達，不從單次表現推定能力或風險。', '先保留孩子自己的說法，再到成長頁核對已有的關注經過。閱讀這段不代表完成任何跟進。', '示例只呈現已讀到的原因；沒有填入照片、家庭對話或健康評估。', '這筆留在已載入窗口中，首頁閱讀位置只展示前三筆。'][index],
    status: index === 1 ? 'proposed' : 'following', version: 1, archivedAt: null,
    attentionIds: [], events: [], historyComplete: false,
    followUp: index === 1 ? { id: `demo-followup-${scope}`, at: '2026-11-06T08:00:00Z', state: 'unknown', runId: null } : null,
  }));
}
export function createOngoingFixture(ports = {}) {
  let scope = 'A', generation = 1, intentEpoch = 1, serial = 0, active = true, online = true;
  let pending = null, receipts = [];
  const listeners = new Set(), records = new Map();
  const getRecord = () => {
    if (!records.has(scope)) records.set(scope, { load: 'ready', access: 'read_only', concerns: { state: 'ready', items: demoConcerns(scope) }, operation: null });
    return records.get(scope);
  };
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const scopeKey = () => `synthetic-account/child-${scope}`;
  const scopeCurrent = token => active && token.scope === scope && token.generation === generation;
  const retirePending = () => {
    if (pending) getRecord().load = pending.priorLoad;
    pending = null; generation++; intentEpoch++;
  };
  function snapshot() {
    const record = getRecord(), childId = `synthetic-child-${scope}`, key = scopeKey();
    const growth = active ? { scopeKey: key, model: { scopeKey: key, access: record.access, load: record.load, online,
      page: { concerns: record.concerns } } } : null;
    const section = projectOngoing({scopeKey:key, selectedChildId:childId}, growth);
    const selected = selectHomeOverview({ selectedChildId:childId, children:[{id:childId}], overview:{childId, ongoing:section} });
    return structuredClone({scope, generation, intentEpoch, active, online, childName:`示例孩子 ${scope}`,
      section:selected.ongoing, operation:record.operation, pending, receipts});
  }
  const owner = {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    read(outcome = 'success') {
      if (!active || !online || pending) return null;
      if (!['success','failure','empty','unavailable','error'].includes(outcome)) throw new Error('Unsupported synthetic outcome');
      const record = getRecord();
      const token = { id:++serial, scope, generation, outcome, priorLoad:record.load };
      pending = token; record.load = 'loading'; emit();
      // A host callback may synchronously change scope. No old-state work follows it.
      if (scopeCurrent(token) && pending?.id === token.id) ports.onRead?.(Object.freeze({...token}));
      return Object.freeze({...token});
    },
    settle(token) {
      if (!token || !scopeCurrent(token) || pending?.id !== token.id) return false;
      const record = getRecord(), outcome = pending.outcome;
      pending = null;
      if (outcome === 'failure') record.load = 'error';
      else {
        record.load = 'ready'; record.access = 'read_only';
        record.concerns = { state:outcome === 'unavailable' ? 'unavailable' : outcome === 'error' ? 'error' : 'ready',
          items:outcome === 'empty' || outcome === 'unavailable' || outcome === 'error' ? [] : demoConcerns(scope) };
      }
      emit(); return true;
    },
    switchScope(next) {
      if (!['A','B'].includes(next) || next === scope) return;
      retirePending(); scope = next; receipts=[]; getRecord(); emit();
    },
    setOnline(value) { online=!!value; emit(); },
    setUnknown() {
      const record=getRecord(); if (!record.operation) record.operation={status:'unknown',originalId:`synthetic-original-${scope}`};
      emit();
    },
    invalidateIntents() { intentEpoch++; },
    captureNavigation() {
      const token={scope,generation}, epoch=++intentEpoch; let used=false;
      return () => {
        if (used || !scopeCurrent(token) || epoch !== intentEpoch) return false;
        used=true; ports.onNavigate?.({destination:'growth'});
        if (!scopeCurrent(token) || epoch !== intentEpoch) return false;
        receipts.push({destination:'growth',synthetic:true}); emit(); return true;
      };
    },
    retire() { if (!active) return; retirePending(); active=false; emit(); },
    activate() { if (active) return; generation++; intentEpoch++; active=true; emit(); },
  };
  return owner;
}
