import { fixtureFor, scenarioIds } from './fixtures.mjs';

export function createState() {
  return {
    serial: 0, identityKey: 'demo-person-a', sessionGeneration: 1, childId: 'demo-child-a',
    scenarioId: 'normal', online: true, access: 'allowed', snapshot: null, freshness: 'empty',
    keyCheck: null, catalog: null, pendingOriginal: null, pending: null, retired: null,
    notice: '尚未讀取。所有控制只操作固定合成示例。',
  };
}

export function eligibility(state) {
  const available = state.online && state.access === 'allowed' && !state.pending;
  const settings = state.snapshot?.settings;
  const metadata = Boolean(available && !state.pendingOriginal && state.freshness === 'fresh'
    && settings?.provider === 'gemini' && settings.keyConfigured
    && state.snapshot.enabled && state.snapshot.personalAvailable);
  return {
    read: Boolean(available && !state.pendingOriginal),
    recovery: Boolean(available && state.pendingOriginal),
    check: metadata && settings.mode === 'personal', catalog: metadata,
  };
}

function retire(state) {
  return { ...state, serial: state.serial + 1, pending: null,
    retired: state.pending ?? state.retired, keyCheck: null, catalog: null };
}
function empty(state) {
  return { ...retire(state), snapshot: null, freshness: 'empty', pendingOriginal: null };
}
function currentTicket(state, ticket) {
  const live = state.pending;
  return Boolean(live && ticket && state.online && state.access === 'allowed'
    && ticket.serial === live.serial && ticket.kind === live.kind
    && ticket.identityKey === state.identityKey && ticket.sessionGeneration === state.sessionGeneration
    && ticket.scenarioId === state.scenarioId && live.serial === state.serial);
}
function sameOriginal(a, b) {
  return Boolean(a && b && a.opId === b.opId && a.expectedVersion === b.expectedVersion);
}
function failed(state, error) {
  const clear = { ...state, pending: null, keyCheck: null, catalog: null };
  if (error === '401' || error === 'session_changed') {
    return { ...empty(clear), access: 'reauth', notice: '合成身份已退休，請重設示例後再讀取。' };
  }
  if (['403', '409', 'access_denied', 'client_update_required'].includes(error)) {
    return { ...clear, snapshot: null, freshness: 'empty',
      access: error === 'client_update_required' ? 'update-required' : 'allowed',
      notice: error === 'client_update_required' ? '此合成回覆要求更新客戶端；請重設示例。'
        : '設定或存取狀態已改變，內容已撤下；請明示重新讀取。' };
  }
  return { ...clear, notice: error === '429' ? '合成 metadata 暫受限制；稍後手動再試，不會自動重試。'
    : '合成 metadata 未能確認；保留最後有效讀取，不代表模型不能使用。' };
}
function validCatalog(value) {
  return value?.scope === 'model_metadata_only' && Array.isArray(value.models)
    && value.models.length <= 20 && value.models.every(item => item.capabilities
      && ['tools', 'image', 'audio', 'textStreaming'].every(key => typeof item.capabilities[key] === 'boolean'));
}

export function reduce(state, event) {
  switch (event.type) {
    case 'RESET':
    case 'SCENARIO': {
      const scenarioId = event.type === 'RESET' ? 'normal' : event.id;
      if (!scenarioIds.includes(scenarioId)) return state;
      return { ...empty(state), scenarioId, online: true, access: 'allowed',
        pendingOriginal: fixtureFor(scenarioId).pendingOriginal,
        notice: '已更換合成情境；舊回覆已退休，請明示讀取。' };
    }
    case 'IDENTITY':
      return { ...empty(state), identityKey: state.identityKey === 'demo-person-a' ? 'demo-person-b' : 'demo-person-a',
        access: 'allowed', notice: '已切換合成本人；舊資料與原操作已清除。' };
    case 'SESSION':
      return { ...empty(state), sessionGeneration: state.sessionGeneration + 1, access: 'allowed',
        notice: '合成登入世代已更新；舊回覆不得恢復資料。' };
    case 'CHILD':
      return { ...state, childId: state.childId === 'demo-child-a' ? 'demo-child-b' : 'demo-child-a',
        notice: '只切換合成孩子；本人模型設定沿用。' };
    case 'OFFLINE':
      return { ...retire(state), online: false, freshness: state.snapshot ? 'stale' : 'empty',
        notice: '合成離線；保留的內容只是最後讀取，恢復後須明示重讀。' };
    case 'RECONNECT':
      return { ...state, online: true, notice: '合成連線恢復；不會自動讀取或重播原操作。' };
    case 'CANCEL':
      if (!state.pending) return state;
      return { ...retire(state), freshness: ['read', 'recovery'].includes(state.pending.kind)
        ? state.snapshot ? 'stale' : 'empty' : state.freshness, notice: '已取消合成等待；晚到結果不會套用。' };
    case 'START': {
      if (!eligibility(state)[event.kind]) return state;
      const serial = state.serial + 1;
      const metadata = event.kind === 'check' || event.kind === 'catalog';
      return { ...state, serial, keyCheck: null, catalog: null,
        pending: { serial, kind: event.kind, identityKey: state.identityKey,
          sessionGeneration: state.sessionGeneration, scenarioId: state.scenarioId,
          ...(metadata ? { expectedVersion: state.snapshot.settings.version, provider: state.snapshot.settings.provider } : {}),
          ...(event.kind === 'recovery' ? { original: { ...state.pendingOriginal } } : {}) },
        notice: '等待明示送達合成結果；沒有發出服務請求。' };
    }
    case 'COMPLETE': {
      if (!currentTicket(state, event.ticket)) return state;
      const ticket = state.pending, payload = event.payload;
      if (ticket.kind === 'recovery' && !sameOriginal(ticket.original, state.pendingOriginal)) return state;
      if (payload?.error) return failed(state, payload.error);
      if (ticket.kind === 'read' || ticket.kind === 'recovery') {
        if (!payload?.snapshot || !Number.isInteger(payload.snapshot.settings?.version)
          || payload.snapshot.settings.version < 0) return failed(state, '409');
        if (ticket.kind === 'recovery') {
          if (payload.receipt && payload.receipt.opId !== ticket.original.opId) {
            return { ...state, pending: null, notice: '合成收據識別不匹配；原操作仍未知。' };
          }
          const confirmed = Boolean(payload.receipt);
          const superseded = !confirmed && payload.snapshot.settings.version > ticket.original.expectedVersion;
          return { ...state, pending: null, snapshot: payload.snapshot, freshness: 'fresh',
            pendingOriginal: confirmed || superseded ? null : state.pendingOriginal,
            notice: confirmed ? '合成原操作已確認；已讀取目前設定，沒有重送。'
              : superseded ? '已讀取較新版本，不能據此確認原操作。' : '合成原操作結果仍未知；保留原識別，不重播。' };
        }
        return { ...state, pending: null, snapshot: payload.snapshot, freshness: 'fresh',
          notice: '已讀取合成設定及版本；未連接帳戶。' };
      }
      const settings = state.snapshot?.settings;
      const value = ticket.kind === 'check' ? payload?.check : payload?.catalog;
      if (state.freshness !== 'fresh' || !settings || settings.version !== ticket.expectedVersion
        || settings.provider !== ticket.provider || value?.version !== ticket.expectedVersion
        || value?.scope !== 'model_metadata_only'
        || ticket.kind === 'catalog' && (value.provider !== ticket.provider || !validCatalog(value))) {
        return { ...state, pending: null, keyCheck: null, catalog: null, notice: '合成 metadata 不匹配目前版本或服務；未套用。' };
      }
      return { ...state, pending: null,
        ...(ticket.kind === 'check' ? { keyCheck: value } : { catalog: { ...value, models: value.models.filter(item => item.provider === ticket.provider) } }),
        notice: '已呈現合成 metadata；未驗證生成、向量、帳單或剩餘配額。' };
    }
    default: return state;
  }
}
