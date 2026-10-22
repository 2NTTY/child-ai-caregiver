# Snapshot27a 修改與驗證

**最終本地源碼限定回歸136/136通過，23檔為10個產品檔＋13個測試檔。** 27a增量有界瀏覽器6組通過，關閉27階段主次RED；產品 commit 已精確讀回並發布至 Site86；PR metadata 讀回及發布後5組線上 smoke 均完成。這不是整倉全綠或全站全功能PASS。

## 五個窄範圍修改

1. **概況任務定位**：正常與相容分支保留原 taskId，導向既有 `/tasks?taskId=…`；沿用 UUID、目前孩子 scope 與延後導航 guard。
2. **概況負責人安全顯示**：主卡不直接顯示 raw assignee ID；有負責人時「見原安排」，否則「未指定」。未新增權威姓名 projection，這只是 safe fallback。
3. **關注與準備助手入口**：沿用既有 callback，關注有內容仍可近旁找助手；27a改成緊湊主要樣式，手動短名但保留完整表單標題／無障礙名稱。準備單助手動作移到清單前，歸檔及重讀次級，手動modal保留。
4. **歷史工具列**：日期篩選用可丟棄的局部 modal；搜尋與入口緊湊化。只此 modal 明確選用 local-dismiss，其他表單仍預設 guarded；不清除既有 owner 草稿或 pending／unknown 操作。
5. **設定層級與文案**：通知／模型的重讀與版本資訊退位；狀態用「上次讀取」避免把舊快照當最新。保留 key、額度、資料去向、未知操作恢復、危險操作及授權。未修改 AgentAuthorization 或 SourcesView。


## 精確檔案清單

相對已完成的26d基線共23檔；相對27只再變6檔（3產品、3測試）。不是把兩個scope相加。檔案雜湊及階段對照見[evidence-index.json](evidence-index.json)。

| 種類 | repo 相對路徑 |
|---|---|
| 產品 | `frontend/src/screens/SummaryScreen.tsx` |
| 測試 | `frontend/scripts/summary-composition.test.mjs` |
| 測試 | `frontend/scripts/shared-status-read-state.test.mjs` |
| 產品 | `frontend/src/components/growth/GrowthView.tsx` |
| 產品 | `frontend/src/components/preparations/PreparationWorkspace.tsx` |
| 測試 | `frontend/scripts/growth-empty-flow.test.mjs` |
| 測試 | `frontend/scripts/preparation-layout.test.mjs` |
| 測試 | `frontend/scripts/preparation-action-lifecycle.test.cjs` |
| 產品 | `frontend/src/production/SettingsDomains.tsx` |
| 產品 | `frontend/src/components/model-settings/ModelSettingsView.tsx` |
| 測試 | `frontend/scripts/settings-parent-controls.test.cjs` |
| 產品 | `frontend/src/screens/historyScreen.tsx` |
| 產品 | `frontend/src/components/history/history-filters.ts` |
| 產品 | `frontend/src/components/FormDialog.tsx` |
| 測試 | `frontend/scripts/history-controls.test.mjs` |
| 測試 | `frontend/scripts/history-filters.test.mts` |
| 測試 | `frontend/scripts/history-responsive-reader.test.mjs` |
| 測試 | `frontend/scripts/history-filter-dialog-dom.test.cjs` |
| 產品 | `frontend/src/components/summary/SummaryRecords.tsx` |
| 測試 | `frontend/scripts/summary-assignee-display.test.mjs` |
| 產品 | `frontend/src/components/growth/GrowthConcernManualFallback.tsx` |
| 測試 | `frontend/scripts/growth-draft-navigation.test.mjs` |
| 測試 | `frontend/scripts/form-dialog.test.mjs` |

## 候選實作位置

以下為 snapshot27a 的固定源碼連結，對應產品 commit `c18a6b67740013ea5631669fd8bf63acc2d1f5a3`；與基線行號分開。

- `frontend/src/screens/SummaryScreen.tsx`：[72](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/screens/SummaryScreen.tsx#L72)、[84-85](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/screens/SummaryScreen.tsx#L84-L85)
- `frontend/src/components/growth/GrowthView.tsx`：[90-102](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/growth/GrowthView.tsx#L90-L102)
- `frontend/src/components/preparations/PreparationWorkspace.tsx`：[123-130](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/preparations/PreparationWorkspace.tsx#L123-L130)、[218-243](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/preparations/PreparationWorkspace.tsx#L218-L243)
- `frontend/src/production/SettingsDomains.tsx`：[129-173](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/production/SettingsDomains.tsx#L129-L173)
- `frontend/src/components/model-settings/ModelSettingsView.tsx`：[115-174](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/model-settings/ModelSettingsView.tsx#L115-L174)
- `frontend/src/screens/historyScreen.tsx`：[65-79](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/screens/historyScreen.tsx#L65-L79)、[113-155](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/screens/historyScreen.tsx#L113-L155)
- `frontend/src/components/history/history-filters.ts`：[15-21](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/history/history-filters.ts#L15-L21)、[41-61](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/history/history-filters.ts#L41-L61)
- `frontend/src/components/FormDialog.tsx`：[11-20](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/FormDialog.tsx#L11-L20)、[43-48](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/FormDialog.tsx#L43-L48)、[75-90](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/FormDialog.tsx#L75-L90)
- `frontend/src/components/summary/SummaryRecords.tsx`：[40-48](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/summary/SummaryRecords.tsx#L40-L48)
- `frontend/src/components/growth/GrowthConcernManualFallback.tsx`：[23-27](https://github.com/2NTTY/child-ai-caregiver/blob/c18a6b67740013ea5631669fd8bf63acc2d1f5a3/frontend/src/components/growth/GrowthConcernManualFallback.tsx#L23-L27)

## 最終六組限定回歸

建置後在最終27a源碼重新執行，沒有只繼承27的測試數字。

| 群組 | 通過 |
|---|---:|
| summary | 19/19 |
| task-navigation | 5/5 |
| history | 43/43 |
| assistant-actions | 15/15 |
| settings | 10/10 |
| return-focus-and-guards | 44/44 |

**合計136/136，0失敗、0跳過。** 先前31個增量檢查已重複包含在六組內，不相加成167；也不與27階段136重複加數。部分測試用真React／RHF／Zod／RN Web DOM，無關資料owner、router或樣式port合成；不是正式後端或原生手機驗收。

**型別檢查不是全綠**：`tsc --noEmit` exit 2，只剩既有 `frontend/src/components/contact/ContactConsentCard.tsx:33` TS2322及`:99` TS2345，沒有新增診斷。

## 建置與固定身分

- 551輸入、65原始產物、72候選檔；Web建置及靜態驗證通過。
- Bundle `_expo/static/js/web/index-b25abcd6abf772c2344980e5241248a5.js`；SHA-256 `abf3e8dc7d012a87db73ac5732721cc10429c68454144b2fbfff8c3aba4dbcf2`。
- 候選72檔清單SHA-256 `4c820b9e30d27cac907449c19234341710faa3e14c5c4d04a8b1a7ad559d77d0`。
- Fixture SHA-256 `461064eb151bff716b67a93ecc8b9305fdc2c0c05bdbf42eaa599fc2af00ef6d`，與27相同，只新增child1兩項合法appointment／scheduled v1合成安排供定位驗收，**不是代家長預約功能**。
- Fixture產品parser／transport8/8通過，該檢查原生網路呼叫0；不把瀏覽器靜態資產HTTP也說成0。
- 六個既有安全／尺寸檢查檔保持不變，沒有真資料、真模型、key或正式寫入。

## 分階段瀏覽器證據

- [27原階段](snapshot27-browser-stage.md)：22組＝19 PASS、1主次RED、2未實屏；44張原圖保留。
- [27a增量](snapshot27a-browser-stage.md)：6組PASS，關閉主次RED；9張原圖與27分開。原27其餘項按精確未改範圍承接，不標成27a重跑。
- 兩個限制仍在：其他工作區retained dirty／pending／unknown只有source／DOM；模型成功表單、key／endpoint／費用及write-unknown未實屏。模型實際只驗合成讀取503後的未確認／重試，不假成功。
- 部分modal／月曆頂邊有合成預覽提示疊層，不能據正文可用宣稱正式產品全標題無遮擋。

## 發布狀態

27a 產品 commit `c18a6b67740013ea5631669fd8bf63acc2d1f5a3` 已 normal push 及精確讀回，23 個 blob 相符。Site86 於 2026-10-22 18:07:49 UTC 發布成功，公開範圍及 revision 2 不變。Site source commit `a1c6b91e487786ac2a0338dab041774e6e885623` 屬另一個倉庫，不能與產品 commit 混用。PR #253 的 head、body 及比較讀回相符，仍 open draft、未合併。PR 累計14 commits／307 changed files，不等於本輪23檔範圍。CI workflow runs／check runs／statuses 都為0、combined state 為 pending，不能稱為 CI 通過。發布後[5組窄範圍線上 smoke](site86-live-smoke.md)通過；不是全站重跑。

補充限制：直接HTTP取得公開bundle回403後停止，fixture未取得；遠端response-body字節SHA**未驗**。官方封裝72檔精確核對、native部署讀回與瀏覽器實載／操作通過是分層證據，不混作同一項。
