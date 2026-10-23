# 修改、審核與測試

本文件凍結 snapshot29 交付證據；45 檔來源／測試已凍結，整合 20 scripts／159 項通過；bundle／靜態包裝已確認，已收有界 browser 結果，未驗場景另列。

## 修改清單

| 區域 | 主要來源 | 本批改動及保留界線 |
|---|---|---|
| 歷史待辦 | `TaskHistoryView.tsx`、`TaskListRow.tsx` | 移除歷史格網，採單欄緊湊閱讀列；詳情選取、歷史錨點及鎖定保持。 |
| 已保存核對卡 | `CareSavedRecordsView.tsx` | 事件正文優先，種類退為 metadata；無障礙名稱按 Unicode 字元最多 100 字，正文不因名稱截斷。 |
| Care 讀取／焦點 | `CareReadCoordinator.ts`、`CareProfileDomains.tsx`、`careScreen.tsx`、`CareRecordDetail.tsx`、`CareReviewHistoryView.tsx`、`AgentRunView.tsx`、`useQuietReadFocus.ts` | 同範圍空 snapshot／數量／頁面保留；純背景讀取保留焦點但仍拒絕動作；首次失敗不能冒認為空；寫入確認後必須回首頁重讀，不能沿用舊 cursor。 |
| 記憶／待辦 | `task-knowledge-read-window.ts`、`task-knowledge-memory.ts`、`task-knowledge-tasks.ts` | 重新讀取已載入 ID 邊界，完成後原子替換；保留歷史範圍，不以頁數粗略截斷。 |
| 私人備註／聊天 | `AgentAuthorizationOwner.ts`、`AgentAuthorization.tsx`、`chatScreen.tsx` | 備註按已掃描 cursor 邊界重讀，允許已掃過但零匹配頁；刪除窗使用凍結版本；聊天已載空內容不退回首次載入。備註 stale 重試保搜尋焦點，公告為「正在重新核對資料。」 |
| 設定 | `SettingsDomains.tsx`、`useProductionModelSettings.ts`、`useProductionNotificationPreferences.ts`、`ModelSettingsView.tsx` | 相同依據重讀不丟棄已開確認／草稿；依據改變、真寫入及 unknown 狀態仍守原確認與重試界線。 |
| 來源 | `usePhotoInputSources.ts`、`shared-input-view-model.ts`、`SourcesView.tsx` | 同範圍新鮮 GET 不製造假的 stale 畫面；寫入仍鎖定，不把舊可見資料當授權。 |
| 概況 | `task-knowledge-summary.ts`、`TaskKnowledgeSummaryContent.tsx`、`SummaryView.tsx` | 已讀空 snapshot 維持閱讀狀態；自動刷新只用已套用期間，未套用草稿不生效。 |
| 共用 Tabs／導航 | `ui.tsx`、`app-navigation.ts` | 同級 badge 變化後重測實際 x／width，避免底線沿用舊位置；管理排序核對 → 記憶 → 檔案 → 全部功能。 |
| 已採納呈現 | `frontend/DESIGN_SYSTEM.md` | 記錄本批頁型與閱讀呈現，不當作測試通過證據。 |

完整 45 檔及定稿 SHA-256 以 [source scope](receipts/source-scope-final45.json) 為準；表內是閱讀分組，不另計檔案或測試數。

## 獨立來源審核

獨立來源審核及部分定點重播已提供 Allow 結論；未另附完整審核逐步日誌。這不是 GitHub 平台 required review，也不是 CI 綠燈。

- Care 首次審核指出「寫後仍用舊 cursor」及「已確認空 history 不保留」兩項 blocking；修正後覆核 Allow，獨立 2/2 及真 Paper 1/1 定點重播通過。
- 記憶／待辦／備註範圍審核：備註原按頁數截斷不足，修正為已掃描 cursor 邊界；原失敗由獨立真 owner 重播關閉。
- 設定／概況審核 Allow；設定限定重播 13/13，有原始本地 log／來源 hash。不能擴稱全設定 browser 通過。
- Tabs／導航審核 Allow；獨立 more 4、count 6 及 hash／差異核對。這些不加進最終整合案例數。
- 備註最後文案及 stale focus 微調已作來源覆核，沒有將 failed 空清單與首次失敗強行等同。

## 測試階段（不混算）

| 階段 | 實際結果 | 判讀 |
|---|---|---|
| 作者 Care 返修定向 | 原兩項新增回歸 0/2 → 2/2；同檔 18/18 | 定向結果，不是全整合結果。 |
| 作者 Notes 最後 UX 定點 | 新增 1/1；其餘 owner／Chat hash 不變 | 沒有重新執行作者全套。 |
| Snapshot28 早期檢查 | 5 scripts 49/49；完整 tsc exit 137；三根 scoped SIGKILL；task／care 小範圍各零 diagnostics | 完整 typecheck 未完成，原因未知，不推定 OOM 或產品根因。 |
| Snapshot28 export | exit 130 中止，沒有可交付產物 | 原候選因範圍調整停止；不能用 partial export 驗收。 |
| Snapshot29 初次整合批 | Care conversation 15/16；稍後 history empty 5/6；各首失敗停批 | 兩份 test-only 修正已各重驗 16/16、6/6；原失敗不覆蓋，產品 inputs 不變。 |
| Snapshot29 最終整合 | **20 unique scripts／159 項通過、0 fail／skip** | 按各 script 定稿去重；作者／review／先前失敗及重播不另加。 |
| Snapshot29 完整 typecheck | heap 384／512 各 exit 134，明確 V8 heap out-of-memory | 未完成，不是零 diagnostics；不能稱全綠。 |
| Snapshot29 scoped typecheck | shared UI／navigation：845 sources、零 diagnostics；Care：heap384 OOM | 第二組失敗停批，其餘五組未跑；僅首組通過。 |
| Snapshot29 export | exit 0，153.595 秒；65 raw／72 packaged，validator PASS | 553 inputs／45 scope 前後一致；[identity](receipts/export-identity.json)。不是 browser 或正式部署通過。 |
| Snapshot29 browser | Care／Tabs／歷史／合成模型審閱代表檢查通過 | [分項證據](receipts/browser-checks.json)；memory／tasks／summary自然focus與通知表單未在29驗，不能稱全站通過。 |

## 仍待／未驗

- 備註 failed 空清單目前不能區分「曾成功載入空 snapshot」與「首次失敗」；本批沒有新增 owner 欄位解決此界線。
- scope、身份、家庭／孩子隔離、權限、原 operationId、unknown 及 first-error 保持既有守門，沒有新增 API 契約或權限能力。
- 模型設定若使用可讀的合成 fixture，只能證明前端檢視、確認窗及取消路徑；不代表 key、供應商、模型或正式保存接線完成。
- 本批不含真模型、真資料、訊息發送、正式部署或 OTA；draft PR／Site 發布狀態只按各自最新收據記錄。

## 本候選未包含的新增範圍

全站 metadata／icons 一致性補齊另作後續工作，不改 snapshot29 凍結 inputs；獨立實作及來源審核不等於本候選已整合或真瀏覽器驗收。Contact schema 契約問題的獨立修補亦未進 snapshot29。

## 去重整合 scripts

每列只採用該 script 的最終已核對 bytes；完整收據及原 log SHA-256 見 [checks](receipts/checks.json)。

| Script | 通過／案例 |
|---|---|
| `care-agent-pending-composition.test.mjs` | 10/10 |
| `care-conversation-review.test.mjs` | 16/16 |
| `care-focus-refresh.test.cjs` | 18/18 |
| `care-history-return-focus.test.cjs` | 10/10 |
| `care-saved-record-card-presentation.test.mjs` | 5/5 |
| `chat-entry-empty-state.test.mjs` | 5/5 |
| `history-card-presentation.test.mjs` | 6/6 |
| `history-empty-cards.test.mjs` | 6/6 |
| `more-navigation.test.mjs` | 4/4 |
| `notes-chat-focus-refresh.test.cjs` | 3/3 |
| `private-notes-refresh.test.mts` | 8/8 |
| `quiet-summary-view.test.mjs` | 2/2 |
| `settings-parent-controls.test.cjs` | 9/9 |
| `settings-review-refresh.test.cjs` | 4/4 |
| `summary-empty-cards.test.mjs` | 3/3 |
| `summary-sources-focus-refresh.test.cjs` | 13/13 |
| `tab-count-badge.test.mjs` | 6/6 |
| `tab-indicator-layout.test.cjs` | 6/6 |
| `task-memory-focus-refresh.test.cjs` | 9/9 |
| `task-read-copy.test.mjs` | 16/16 |
