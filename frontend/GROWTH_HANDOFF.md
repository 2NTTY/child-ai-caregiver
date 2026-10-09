# 成長與關注前端交接

本文件保留關注鏈及報告的前端投影、既定需求與正式接線缺口；當前驗證與下一步只見 [PLAN](PLAN.md#active)。

<a id="living-growth-archive"></a>
## 持續關注與常態成長報告

`/growth` 預設持續關注，`?tab=archive` 讀成長檔案。家長跟 Agent 對話後查看整理成果，手動輸入只是補救；關注處理一件事的持續經過，報告長期呈現孩子的成長。現有來源保留這兩個分頁，不把關注藏成報告底部的一張提醒卡。

[GrowthView](src/components/growth/GrowthView.tsx)、[GrowthHistoryView](src/components/growth/GrowthHistoryView.tsx) 與 [GrowthWorkspace](src/workspaces/GrowthWorkspace.tsx) 共用一個領域 owner。preview provider 在 dashboard 掛一次；正式 host 已用 TaskKnowledgeDomains／useFamilyDocuments 注入相同 scope 的 model／actions，讀頁及操作不另建可寫資料庫。合成 provider 僅供隔離預覽，不能覆蓋正式資料。

### 關注鏈、結束及恢復

- [GrowthConcern](src/growth-view-model.ts) 保留 childId、穩定 id／version、status、attentionIds、events、historyComplete；事件分 Agent 提案、原始觀察、待核對記錄及已確認行動。只按 canonical ID／版本組合 timeline，不靠標題猜關係
- 選一條關注後閱讀其經過；歷史未完整時明示範圍。缺正式 concern 投影為 unavailable，不能以 MemoryTopic、單筆量測或文字推斷成長問題
- [結束確認](src/components/growth/GrowthArchiveConcernButton.tsx) 顯示關注名稱與後果，開啟、取消及 dismiss 均不寫入。確認綁 scope／child／id／version／status／authorityVersion，一次消耗；版本或權限變更使舊確認失效
- `archiveConcern(id, expectedVersion, authorityVersion)` 結束整條關注，保留事件、原始記錄及待核對狀態，不完成／取消已連結任務、不刪資料。合成 owner 增加 confirmed_action 事件並保存 statusBeforeArchive
- [撤銷](src/components/growth/GrowthConcernChangeNotice.tsx) 只對匹配成功操作與現行版本提供；它與歷史的「恢復」都呼叫同一 `restoreConcern`。恢復原 proposed／following 狀態並追加事件，不把待核對升成已確認；缺 statusBeforeArchive 時停用，不猜原狀態
- `/history?category=growth` 已呈現同源已結束關注。常態列只保留名稱、結束日期及閱讀入口；獨立恢復按鈕不觸發開詳情，恢復後從 closed 清單移出，完整經過仍保留。搜尋僅針對已取得關注；日期取 archivedAt，未知日期不冒配日期
- archive／restore 的正式 endpoint、權威歷史、原狀態投影及持久化尚未接通。模擬時間不是 Server 收據；歷史頁的操作復原仍共享 [GrowthOperationRecovery](src/components/growth/GrowthOperationRecovery.tsx)

時間線呈現依 [GrowthConcernTimeline](src/components/growth/GrowthConcernTimeline.tsx)；原記錄導向 `/care?record=…` 必須校驗同孩子授權及實際 id，找不到不能選別筆。Task callback 現時只到 `/tasks`，不可宣稱精確定位或兩個 domain 已正式同步。Home ongoing 仍為 MemoryTopic。

### Web 報告與導出選擇

產品需求：打開成長檔案即可閱讀由 Agent 持續整理的標準報告；特殊內容或用途由家長在聊天交代給 Agent。PDF 是選定期間／版本的導出產物，不取代可持續更新的網頁正文。特殊報告同樣遵守來源、權限及版本限制；正式 create／refresh 已接同一 FamilyDocument；Agent 或手動備援發起，讀頁本身不生成。

[GrowthArchive](src/components/growth/GrowthArchive.tsx) 是持續可讀的標準 Web 報告。章節由正式分類投影安排孩子概況、身體與生活、能力與興趣、持續關注、近期變化與支持；舊未分類條目放中性「已記錄的情況」，不從文字猜分類。來源確認記錄、Agent 整理及尚待核對的標示分開，不把報告當發展評估或已確認的新事實。

- `GrowthArchiveProjection` 必須匹配 scopeKey／childId／authorityVersion。periods 只以 snapshotId／snapshotVersion 指向實際取得的 snapshot／history；少量片段標部分涵蓋，不造全年／季度完整性
- `GrowthArchiveSnapshot` 保存版本、年齡／期間、生成時間、sourceBasisVersion、coverageNote、內容及來源／更正引用。來源更正、刪除或撤權應使相關敘事失效；歷史也不得繞過現行權限
- 未生成、生成中、可讀、有新資料待整理、資料不足、失敗及來源失效分開。只有仍有權讀的舊版可保留閱讀；既有 Server worker 分批整理並由 changes 刷新 owner，前端不另開生成計時器。手動備援可接續一批，原操作結果未知時先查收據
- 導出視窗保留家庭成長、就診溝通、照護交接、入園認識四種用途，已取得期間，以及「原始記錄與依據」「本版更新說明」選項。這是意圖選擇，不是產物
- [growthReportExportRequest](src/components/growth/growth-archive-view.ts) 綁 scope／child／authority、snapshot ID／version、period／用途及選項。正式 owner 已注入同版 PDF callback；只有 Server 回傳實際 PDF 才交瀏覽器下載，不能把選項可操作稱為已生成／收到
- `GrowthReportExportHandler(request, isCurrent)` 回傳本次 `ready`／`error` 訊息；`ready` 只表示交給瀏覽器下載，沒有回傳結果不作成功。視窗管理意圖生命週期，owner 同時核原身份／孩子／權威／快照及 `isCurrent()`，失效意圖不得下載或發佈晚到訊息；撤權仍清除 owner。導出 pending 只在視窗內呈現，避免取消後污染共享 notice；視窗內同一 live region 呈現該次結果，關閉／換選項及 scope 清理，不解析其他 owner 的 notice 作導出狀態。

P2-A05 以 reportMode=fixed／living 區分固定期間與日常延展；report.phase 的 building／complete／needs_update 投影至既有 generating／ready／needs_update。進度保存於 Server，跨頁共用 owner；完整季度／年度分類及 coverage 只採 reportCoverage，不把舊 partial 快照升格。正常頁面沒有模型呼叫，一處注入同版能力供 Web／PDF 使用；生成／下載前重新驗權限與來源，不靜默換版本、不自動外發。較廣的已採納導出需求包括按用途重用有效內容及必要補寫、選擇授權照片／量測／詳細記錄／關注歷史／可匯出對話、排除個別項目；這些較廣選項目前未實作。排除敏感來源時亦移除洩露其內容的衍生敘事，不能只藏連結。年度版不只是串接季度，沒有真產物不得回報成功。

原始時間與加入時間分開；未知事件時間不拿 createdAt 代替。單筆量測不畫趨勢、不同單位不直接比較，不生成假里程碑、能力達標率或診斷。原始 Profile／Care／Photos／Tasks／對話仍由各自 owner 掌管，衍生報告只引用來源及版本，不反寫成事實；現有日／週 Summary 及到診準備不是長期成長報告。

## 既有 Growth API 邊界

下列沿較早已核對的 master `ce87370b6375b25e45f016f2218d924b44f06f3c`：`src/client/growth-api.ts`、`src/shared/growth.ts`、`docs/API.md` 的 Growth 契約。這是歷史靜態依據，整合前重核實際正式版本；本次沒有改 backend 或證明真服務行為。

- `createGrowthApi` 的 getPage／decideAttention／updateTopic 對應 refresh／decide／updateTopic，沿登入 cookie、x-expected-user-id、AbortSignal 及原 refresh。`GrowthDecision`／`GrowthTopicDecision` 是前端投影，不是新 wire schema；archive／restore 不能硬套既有 attention 關閉
- owner／caregiver 可管理、viewer 唯讀；真正權限、canManage、storage epoch 及 authorityVersion 由 Server 決定。sourceAvailable=false 不必然是網站下架；舊建議不得當現行內容接受／暫緩，仍保留追溯與真 task 狀態
- 接受 attention 預設只知悉；新任務須另核內容、種類、目前合資格負責人、日期／時間／IANA zone及家庭共享。標題 160、內容 2,000 字、不靜默截短；已有同階段待處理／待覆核任務先到 Tasks 核對，不重建
- API 可連指定版本的既有任務，較早正式 Panel 只露知悉／新建；不能靠標題猜選取。暫緩需將來時刻，到期由 Server 處理；關閉備註上限 1,000 字，舊終態不自行復活
- 既有四 topic 的停用／重啟與近況確認契約保留，現行關注頁不再以階段表單作主畫面。重啟只恢復未來評估，不復活舊關閉項或取消任務。近況不預填否定；只傳明確選項，共享同意獨立，expectedFacts 凍結原主題全部 refs／版本；衝突回原 Memory owner

## Unknown、草稿及隔離

Growth 操作沒有 opId 收據；較早契約以原版本、相同 actor／完整 body 查回最後成功結果。unknown 凍結原對象、body、expectedVersion／authorityVersion、fact refs 及顯示名稱，停止新變更；先 GET，找到原對象後重新明確同意查回原請求。不能換版本重送、按相似文字推測成功，或因找不到就解除鎖定。

明確 4xx 先停止重試，GET 後重新核對，不用本次拒絕推定較早 unknown 的結果。第一次修改捕捉原基準，重讀不覆蓋草稿；基準變更停止提交。二次明確放棄只清未送出草稿，不清 unknown 原請求。讀取失敗／dirty／pending／busy／read-only 均保留相應守衛。

401／403／404／session_changed、身份／Server／孩子或權限變更清理舊私人內容及回調；正式 transport 必須 abort／拒絕遲到結果。一般離線保留同 scope 草稿、禁提交、沒有 outbox；重新上線由原 controller 核對。fixture 角色、合成回應或本地事件都不是授權或 Server 收據。

## 證據使用

[舊定向確認／恢復檢查](verification/growth-confirm-restore-2026-10-05T18-59Z/checks.json)、[時間線標記檢查](verification/growth-timeline-2026-10-05T19-00Z/source-and-checks.json)及[外殼生命週期檢查](verification/scope-shell-stability-2026-10-05T19-38Z/checks.json)已取回；均限定其原版本、harness 或局部 semantic 範圍，不代表新修訂 browser／export／真 API／持久化／原生通過。未取回的最終 v44 QA 不補造，實際新結果只在 PLAN 記錄。
