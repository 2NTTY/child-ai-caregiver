import { eligibility } from './model.mjs';
const shown = value => value === undefined || value === null ? '未提供' : String(value);
const configured = value => value === undefined ? '未提供' : value ? '已配置' : '未配置';
const row = (label, value) => ({ label, value: shown(value) });

export function present(state) {
  const allowed = eligibility(state), snapshot = state.snapshot, settings = snapshot?.settings;
  const cards = [{ id: 'basis', title: '本人設定的讀取依據', rows: [
    row('合成本人', state.identityKey), row('登入世代', state.sessionGeneration), row('合成孩子', state.childId),
    row('已讀版本', settings ? settings.version : '尚未讀取'),
    row('新鮮度', state.freshness === 'fresh' ? '最後有效讀取' : state.freshness === 'stale' ? '已過期，只是最後讀取' : '尚未讀取'),
  ] }];
  if (settings) {
    cards.push({ id: 'settings', title: '已保存配置（合成快照，不可編輯）', rows: [
      row('模式', settings.mode), row('服務', settings.provider), row('假模型 ID', settings.model),
      row('聊天密鑰狀態', configured(settings.keyConfigured)),
      row('獨立向量密鑰狀態', configured(settings.embeddingKeyConfigured)),
      row('背景使用', settings.backgroundEnabled ? '開啟' : '關閉'),
      row('已保存的個人每日上限', settings.dailyLimit),
      row('已保存的每輪生成上限', settings.maxModelCalls),
      row('已保存的每輪查詢向量上限', settings.maxQueryEmbeddings),
      row('更新時間', settings.updatedAt),
    ] });
    for (const bucket of ['platform', 'personal']) {
      const usage = snapshot.usage[bucket];
      cards.push({ id: bucket, title: bucket === 'platform' ? '平台用量 bucket' : '個人用量 bucket', rows: [
        row('UTC 計數日', usage.day), row('回覆中的 billingSource', usage.billingSource),
        row('呼叫嘗試', usage.attempts), row('輸入 tokens', usage.inputTokens), row('輸出 tokens', usage.outputTokens),
        row('快取 tokens', usage.cachedTokens), row('用量未確認的嘗試', usage.unknownUsageAttempts),
      ] });
    }
    cards.push({ id: 'limits', title: '上限資訊，不是餘額或帳單', rows: [
      row('全站個人安全上限', snapshot.personalGlobalLimit),
      row('實際生效上限', snapshot.effective ? '以下為合成回覆明示值' : '未提供，不能以個人設定代替'),
      ...(snapshot.effective ? Object.entries(snapshot.effective).map(([key, value]) => row(key, Array.isArray(value) ? value.join('、') || '無' : value)) : []),
      row('互動上下文上限', snapshot.agentInputCharacters),
    ] });
  }
  const metadataRows = [row('查核範圍', '未驗證生成、向量、帳單或剩餘配額')];
  if (settings && settings.provider !== 'gemini') {
    metadataRows.push(row('此示例的控制', '本示例不提供此接入方式的查核，不判定供應商能力'));
  }
  metadataRows.push(row('模型資料', state.keyCheck
    ? state.keyCheck.status === 'accessible' ? '合成 metadata 可讀取' : '模型資料未能確認'
    : '尚未核對目前版本'));
  if (state.keyCheck?.reason) metadataRows.push(row('合成原因', state.keyCheck.reason));
  const catalog = state.catalog;
  metadataRows.push(row('合成目錄', catalog ? catalog.status : '尚未提供'));
  if (catalog?.reason) metadataRows.push(row('目錄合成原因', catalog.reason));
  if (catalog?.truncated) metadataRows.push(row('有界目錄', '只包含部分結果，未列出不代表不存在'));
  const match = catalog?.models.find(item => item.provider === settings?.provider && item.id === settings?.model);
  if (match) {
    for (const [key, value] of Object.entries(match.capabilities)) {
      metadataRows.push(row(`能力提示 ${key}`, value ? '正向 metadata 提示，非實際驗證' : '未確認，不代表禁止'));
    }
  } else metadataRows.push(row('能力提示', '沒有目前模型的能力提示'));
  cards.push({ id: 'metadata', title: '合成手動 metadata 結果', rows: metadataRows });
  if (state.pendingOriginal) cards.push({ id: 'original', title: '外部原操作合成場景', rows: [
    row('原識別', state.pendingOriginal.opId), row('原預期版本', state.pendingOriginal.expectedVersion),
    row('範圍', '只讀合成收據及目前設定，沒有建立或重播寫入'),
  ] });
  const controls = [
    { id: 'read', label: '讀取合成設定', disabled: !allowed.read },
    { id: 'check', label: '呈現合成模型資料結果', disabled: !allowed.check },
    { id: 'catalog', label: '合成已存目錄結果', disabled: !allowed.catalog },
    { id: 'recovery', label: '讀取合成原收據及設定', disabled: !allowed.recovery },
    { id: 'complete', label: '送達本次合成結果', disabled: !state.pending },
    { id: 'cancel', label: '取消合成等待', disabled: !state.pending },
    { id: 'retired', label: '送達已退休合成結果', disabled: !state.retired },
    { id: 'offline', label: '模擬離線', disabled: !state.online },
    { id: 'reconnect', label: '模擬恢復連線', disabled: state.online },
    { id: 'identity', label: '切換合成本人', disabled: false },
    { id: 'session', label: '更新合成登入世代', disabled: false },
    { id: 'child', label: '只切換合成孩子', disabled: false },
    { id: 'reset', label: '重設示例並退休回覆', disabled: false },
  ];
  return { status: state.notice, cards, controls,
    details: '這是明示手動結果的 simulation seam：正式 refresh 會附帶可選 catalog，這裏刻意分開，不代表原 hook 的同等執行。metadata 只是資料提示。false 能力值不是禁止；用量按各自最後讀取 UTC 日呈現，不推算供應商餘額。所有原操作只是外部操作的固定合成輸入，沒有保存、刪除或模型試用。' };
}
