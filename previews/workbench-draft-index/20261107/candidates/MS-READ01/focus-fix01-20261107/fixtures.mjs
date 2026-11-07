// Every value here is fictional. No credentials or service calls are represented.
const labels = {
  normal: '正常讀取與 metadata', zero: '版本 0 與零用量', missing: '未提供的選填資料',
  platform: '平台模式的合成目錄', vertex: '其他接入方式（示例不提供查核）',
  unknown: '外部原操作結果未知', superseded: '原操作無收據但版本較新',
  confirmed: '配對收據與較新設定', wrongReceipt: '錯誤收據識別',
  ordinary: 'metadata 暫未能讀取', '429': 'metadata 暫受限制', '409': '設定版本衝突',
  access_denied: '存取已撤回', client_update_required: '需要更新客戶端',
  '403': '本人設定暫不可讀', '401': '需要重新登入', session_changed: '登入世代已改變',
  unsupported: 'metadata 回覆不支援', oldMetadata: 'metadata 回覆版本不符',
};
export const scenarioIds = Object.freeze(Object.keys(labels));
const original = { opId: '00000000-0000-4000-8000-000000000007', expectedVersion: 7 };

export function fixtureFor(id = 'normal') {
  const scenario = Object.hasOwn(labels, id) ? id : 'normal';
  const snapshot = {
    settings: {
      version: scenario === 'zero' ? 0 : ['superseded', 'confirmed'].includes(scenario) ? 8 : 7,
      mode: scenario === 'platform' ? 'platform' : 'personal',
      provider: scenario === 'vertex' ? 'vertex' : 'gemini',
      model: 'demo-fictional-model', keyConfigured: true, backgroundEnabled: false,
      dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null,
    },
    enabled: true, platformAvailable: true, personalAvailable: true, personalGlobalLimit: 500,
    usage: {
      platform: { day: '2026-11-01', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 },
      personal: { day: '2026-11-02', attempts: 3, inputTokens: 20, outputTokens: 8, cachedTokens: 0, unknownUsageAttempts: 1 },
    },
  };
  if (scenario !== 'missing') {
    snapshot.settings.embeddingKeyConfigured = scenario !== 'zero';
    snapshot.usage.personal.billingSource = 'personal';
  }
  const version = scenario === 'oldMetadata' ? 6 : snapshot.settings.version;
  const reason = scenario === 'unsupported' ? 'metadata_unsupported' : undefined;
  const check = { version, status: reason ? 'unavailable' : 'accessible', scope: 'model_metadata_only', ...(reason ? { reason } : {}) };
  const catalog = {
    version, provider: snapshot.settings.provider, scope: 'model_metadata_only',
    status: reason ? 'unavailable' : 'checked', ...(reason ? { reason } : {}), truncated: true,
    models: [{ id: 'demo-fictional-model', label: '虛構模型（不是產品建議）', provider: snapshot.settings.provider,
      availability: 'listed', capabilities: { tools: false, image: false, audio: false, textStreaming: false } }],
    embedding: { model: 'demo-fictional-embedding', dimensions: 1024, status: 'not_checked' },
  };
  const recoveryScenario = ['unknown', 'superseded', 'confirmed', 'wrongReceipt'].includes(scenario);
  const errors = ['ordinary', '429', '409', 'access_denied', 'client_update_required', '403', '401', 'session_changed'];
  return {
    label: labels[scenario], snapshot, check, catalog,
    metadataError: errors.includes(scenario) ? scenario : null,
    pendingOriginal: recoveryScenario ? { ...original } : null,
    receipt: scenario === 'confirmed' || scenario === 'wrongReceipt'
      ? { opId: scenario === 'confirmed' ? original.opId : '00000000-0000-4000-8000-000000000099', settings: { ...snapshot.settings, version: 7 } }
      : null,
  };
}
