# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## QA：搜尋名稱與準備單鍵盤焦點（原碼驗收通過，預覽發布受阻）

2026-10-09 UTC，固定基線 master `d3f924e7fbd2bbbf47204df584270a8f2802b8be`。既有合成公開預覽 v65 的 `/tasks`「搜尋已載入事項」與 `/care`「搜尋已保存記錄」缺穩定讀屏名稱；準備單第二項用 Space 勾選時，保存期間被純文字節點替換而失焦。

- 兩個搜尋 consumer 沿既有 `accessibilityLabel` 配方補名稱；不改共用元件、樣式、比例或搜尋回調。
- 只在原已可勾選的準備單項目提交後，於仍可讀且同文件的 pending 期間保留該 checkbox 並停用。原權限／版本／unknown 守衛不變；沒有自動聚焦，使用者移走焦點後不搶回。歸檔、失權及失效來源仍不能操作。
- 安裝版 Paper／RN Web 搜尋 DOM 的 2 項定向測試、準備單 React DOM 的焦點／拒重入／unknown／移焦／撤權核查及最後前端 typecheck 通過；新測試 harness 的初次錯誤及修正保留於[結果](verification/search-preparation-a11y-2026-10-09/checks.json)。DOM runner 明確使用外置既有 jsdom，不新增產品依賴。
- 獨立 review 無阻塞；另補 11 個最小 DOM 反例，來源失效／唯讀／離線、換文件及權威等均未留下可寫控制。dot 已准精確 8 檔正常 PR 交付，產品程式及測試 freeze 不變；尚未建立 PR。
- 既有 v65 可重建源包及原 publisher 的本地 staging／合成 adapter 均不可用，預覽發布及兩點真瀏覽器回歸受阻。未以倉庫合成 fixture 替代重建或聲稱相同 v65。原碼驗收與此發布阻塞分開；未部署、未重跑全量 Server、真模型、正式家庭資料或 Android。下列首屏工作保留原狀態，本包不替其結案。

## QA：孩子首屏與切換動效（修復及覆核中）

2026-10-07 UTC，基線 master 9d1024c。使用者回報尚未載好孩子便退出首屏，只有一個孩子也播放切換幕布。讀碼確認原 FirstScreenGate 只等 hydration／插畫，沒有業務資料 readiness；首次 fallback identity → child scope 被誤當切換。

- 首屏按當前登入身份／有效世代等待孩子與當頁必要 owner 資料，不發另一套讀取、不等待無關頁面。明確失敗或離線應揭示既有錯誤／重試，不能永久遮蓋；裝飾圖片的有界 fallback 不代表業務載入完成。
- 首次無孩子 → 第一個孩子不播放切換幕布；只有前後皆有效且不同孩子才播放。真正切換仍立即隔離舊孩子內容；失權、登出及失效回呼清理優先。正常後續刷新及導航不反覆封鎖全站。
- 載入文字的三點依序輕跳，只改 transform、不改布局或 readiness；無障礙文字固定、減少動態時靜態、卸載／取消清理動畫。
- 必驗慢讀、失敗／重試、0／1／多孩子、刷新、快速切換、身份切換／世代、reduced motion與卸載。定向測試、建置、獨立覆核及正式瀏覽器驗收分開記錄；目前未聲稱部署或全部通過。


## QA：待確認發現與待辦詳情收合（已部署，保留交付快照）

2026-10-07 UTC，基線 master a75ebb6。正式合成驗收發現 Care 刷新後把未成功初讀當成沒有候選；啟動時其他 domain 的短暫 busy 守衛阻止首次讀取，解除後沒有補讀。Chat 初次及新回覆的候選發現也須共用同一 owner。

- 合併一次待讀意圖，守衛解除或既有讀取結束後補讀，不輪詢、不繞過寫入／unknown／權限守衛。孩子、身份或授權失效清除過期意圖，舊回覆不得覆蓋新 scope。
- UI 區分未讀、讀取中、失敗、失權及成功空頁；只有成功空頁可說沒有待確認。Chat 活動標記由同一持久候選資料決定，關閉視窗不清除待確認事項。
- 獨立覆核補正：一般導航與深連結維持 idempotent open，只有列互動明確傳 toggle；排隊選取保留 intent。`src/client/use-online-updates.ts` 傳遞 changed／forced／unavailable，metadata 失敗不能觸發候選每 5 秒重試，真實改變、focus／manual 及新回覆仍可更新。擴大測試的 39/40 中唯一舊 dashboard preview-provider 斷言在原 master 同樣失敗，沒有弱化斷言，原失敗保留。
- 同包最小修正待辦列再次點按收起詳情，以及安排記錄本地收合；收合不重發歷史 API，保留草稿、pending／unknown 守衛及離線可關閉操作。
- 32 項 owner／定向呈現測試及 2 項 preview 選取補驗與 frontend typecheck 通過，原 fixture 欄位失敗保留；[證據](verification/pending-discovery-2026-10-07/checks.json)。未宣稱新建置、部署、正式 UI 或全量回歸完成；後續獨立覆核及批次部署後須用持久合成候選重測。
- 其他來源工作區 404／捨棄草稿修復及 Agent context／數量 grounding 由獨立工作包處理，不在此包混改。

### 已部署成果與未驗界線

PR #99～#104 已按各包證據合併；正式 Web 為 b7dec9d、API 為 a75ebb6（2026-10-07 06:06 UTC 觀察）。孩子刷新選擇、成長頁讀取、完成時間篩選、準備單刷新／歸檔及 PDF coverage 已用合成資料重測。Agent 普通記錄寫入及私人重要候選明確確認已讀回；最終回覆驗證、輸入容量及模型自行補數量仍有獨立缺口，不能稱全站驗收完畢。

下列 FE-W45 為歷史交付範圍；當時「未部署」不代表目前部署狀態。

## FE-W45：正式聊天頁閱讀版型

2026-10-06 UTC。基線 master `e3060e2afa723de59ef45d867ae81f6b284ad3b1`（[PR #98](https://github.com/2NTTY/child-ai-caregiver/pull/98) 已合併）。使用者要求參照 ChatGPT 軟件的對話介面，移走主區多餘說明及四塊管理卡；不重新設計 backend 或新增聊天契約。

### 既定範圍

- 對照 [ChatGPT 官方產品介面](https://chatgpt.com/overview/)：單一限寬訊息欄、右側使用者泡泡、左側助手正文、穩定底部輸入框；空狀態採本案簡潔置中提示，並非宣稱官方空白頁逐像素還原
- 工具列移出聊天時間線；移除常駐讀取數量／最後讀取時間／正常重讀／重複空白說明。只有真分頁可用時提供較早對話入口，不新增假歷史／新對話操作
- 待確認及背景運行放按需活動詳情；原決定／unknown 不因關閉面板消失。逐則回覆可打開原 run，必要待確認保持可發現
- 自動記錄授權及私人備註移到助手設定，仍由原 owner、共享確認及原請求處理；沒有自動授權或第二套儲存
- 保留離線、保存不確定、失敗重試／停止、引用、照片及模型使用同意。Google 處理及合成資料試用要求收短而不隱去必要含義

### 狀態與驗收

修改限定 `frontend/**`，呈現已完成：聊天時間線外的輕量工具、空頁置中提示、正常訊息上方起排、穩定 composer、按需活動及助手設定。左側「助手」只供讀屏，不恢復使用者已刪的常駐標題。原 run／pending owner、照片、來源及送出守衛不變。

8/8 定向 shallow 測試、frontend typecheck 及一次 production Web export（35 路由、同源 `/api`）通過，見[結果與限制](verification/clean-chat-layout-2026-10-06/checks.json)。source review 無已確認阻塞。hash 核對首次因執行目錄錯誤找不到檔案，回 repository root 後同一 manifest 通過；保留記錄，沒有因此改程式或斷言。

沒有瀏覽器／真 API／模型／原生驗收或正式部署。彈窗捲動及焦點返回、窄屏鍵盤／IME、真聊天歷史位置仍待正式使用檢查；shallow 與建置通過不代表這些已驗。此包以獨立 draft PR 交付，不自動合併；實際 GitHub 交付狀態以該修訂 PR 為準。

正式網站最後公開讀取仍為 `053658b` 對應 bundle；PR #98 已合併但未證明部署。本包網站部署及使用者要求的真實保存／讀回驗收仍需正式部署存取與專用驗收登入，不能由舊預覽替代；不在前端文件記錄帳號密碼。真模型／通知、正式家庭資料、永久刪除不由此呈現包自行擴大。

### 前一包

FE-W44 文案及待辦 readState／重試修訂已隨 PR #98 合併。50 項定向補驗與 typecheck 通過，首次 stale harness 失敗保留，見[固定結果](verification/production-copy-2026-10-06/checks.json)；沒有因此完成 browser／正式部署／全量回歸。本包不得重新標它為未合併。

<a id="evidence"></a>
### 可追溯的舊證據

以下檔案已取回，只支持檔案內記錄的版本和範圍，並非本次新整合驗收：

- [v40 合成畫面摘要](verification/next-release-2026-10-05T16-06Z-single-worker-recovery/browser-v40/verification-summary.md)
- [關注確認／撤銷／恢復的定向測試](verification/growth-confirm-restore-2026-10-05T18-59Z/checks.json)
- [時間線標記的定向檢查](verification/growth-timeline-2026-10-05T19-00Z/source-and-checks.json)
- [Owner／外殼生命週期檢查](verification/scope-shell-stability-2026-10-05T19-38Z/checks.json)：含原失敗及修訂後局部補驗；明示沒有新 browser／export 證據

未取回的最終 v44 QA／manifest 不能補寫成既有證據。來源 hash 不同的歷史結果保留其原限制；文件內的舊下一步及舊「當前」不構成新授權。

<a id="fe-w32-design-review"></a>
### 較早設計核查入口

FE-W32 的既有引用保留於此；較早發現見 [DESIGN_REVIEW](DESIGN_REVIEW.md)。當前呈現規則依 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，本次整合與驗收狀態依[當前包](#active)，歷史核查不等同此修訂通過。

