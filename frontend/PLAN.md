# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## QA：報告用途鍵盤選擇（局部原碼通過，候選瀏覽器待驗）

2026-10-10 UTC，固定 master `69bc0693951490d3b5a2b30b6abda99b745a4785`；開工及交付前重核 master 未變、open PR 為空。本包只修既有導出視窗的用途 radio，不改版型、合成 adapter、PDF 契約或 Server。

- **既有預覽現況：**先前未能取得 v65 可重建來源，原因未明；本輪已經官方來源流程恢復。沿原公開範圍的 [Sites v66](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/qa-viewport) 已於 2026-10-10T08:11:10Z 發布，來源 `151b13770374969ff6696de6dacbf5dd55e724d6`，包含 #173 搜尋／準備單及 #177 導出回饋修正；這不是 GCP 或 #181 後端部署。
- **v66 已驗界線：**dot 雲端 Chromium 以原合成 fixture 實測 1440／1024／390／320 CSS px，四尺寸皆看過導出失敗同窗回饋及關閉／重試操作。搜尋名稱、準備單保存中焦點／導航守衛、導出 Enter／Escape／重開／重試及錯誤結束後切孩子按各自指定尺寸完成定向檢查，並非每項跑遍四尺寸；只有端點 1440／320 核量外層沒有橫向溢出。PDF POST 仍由原合成 adapter 即時拒絕，沒有實際下載或 pending late-response 瀏覽器證據。來源恢復及本輪局部驗收不改寫原失敗、未驗或暫緩事項。
- **新候選：**v66 發現未選用途按 Space 仍為 unchecked，同項按 Enter 可選；v65 原碼已有同一缺口。真 GrowthArchive／RN Web DOM 在 master 原碼先重現相同紅例，再局部補 Space／Spacebar、方向鍵環繞與焦點、單一 Tab 入口。已選項及長按 Space 不清除有效導出意圖／回饋；換用途仍失效原意圖並拒晚到回饋。只選用途不請求 PDF，原 pointer／Enter 及 scope／child／authority／snapshot 守衛保留。
- **原碼證據：**定稿 10 項真 React／RN Web DOM（4 新增＋6 既有）、23 項既有 archive／dialog 定向檢查及 frontend typecheck 通過；6 份作者 network audit 為零外聯。首次候選新測試把既有 `care_handoff` 誤寫成 `handoff` 的 3 通過／1 失敗原結果保留，只按原契約更正測試值，沒有放寬斷言。原2份程式／測試已 freeze，獨立程式 review Allow；[固定證據](verification/export-radio-keyboard-2026-10-10/checks.json)分開作者／reviewer 結果及 v66／新候選版本，不把 jsdom 當真瀏覽器。
- **下一步及未驗：**文件附錄及 dot 最終裁決待完成；本候選尚未建立 PR、發布或部署。須在獲准的既有預覽按候選重驗實際鍵盤／四尺寸；目前沒有候選 browser、build、全倉、真 PDF bytes／下載／版面、pending 關閉／切孩子／撤權後晚到 race、讀屏實機或 Android 證據。本包沒有真模型、真家庭資料、GCP／資源／權限操作，不解鎖其他包。

以下報告回饋、同批跟進呈現及搜尋／準備單三節保留各包當時的交付快照；其中「尚未 PR／來源受阻／未瀏覽器驗收」不是目前狀態。#173／#174／#177 已合併；#173／#177 的獨立預覽發布及定向 browser 結果以本節為準，不據此推定 #174 或其他後端已部署。

## QA：報告導出視窗回饋（原碼驗收通過，預覽發布受阻）

2026-10-09 UTC，固定 master `c48b2eb41ee5f19c914ab6bee07b39d9cdd939a7`。既有合成公開預覽 v65 三次導出嘗試均未取得 PDF；可確定的 P2 缺陷是失敗只出現在背景頁底，導出視窗仍開着而沒有錯誤，焦點回到整頁。合成 transport 未支援下載，不把此結果判作正式 PDF endpoint 故障。

- 導出視窗在操作列上方呈現該次 pending／失敗／瀏覽器下載交接結果，失敗用 assertive live region。只於原下載控制仍持有焦點時，在禁用前移到同窗回饋區；結果返回不搶回已移走的焦點，關閉仍可操作。
- 回呼綁定本次導出意圖及原 scope／child／authority／精確 snapshot。關閉、換用途／選項／版本、切孩子、切頁籤及卸載令舊意圖失效；owner 在下載及錯誤／409 重讀回應前再核對，不只把舊訊息藏起來。保留原 single-flight／撤權守衛；實際下載交接及失敗都清理 object URL，沒有 PDF 不回報成功。導出 pending 只由視窗持有，不污染共享文件 notice，避免取消後頁底永久顯示「正在準備」。
- 真 GrowthArchive／AppDialog／Paper Button／RN Web Modal 的 6 項 React DOM 檢查、真 owner＋真 client API 的 15 項合成 HTTP 定向檢查、4 項既有導出／期間選擇檢查，以及 frontend typecheck 通過。[證據及限制](verification/export-dialog-feedback-2026-10-09/checks.json)保留修前元件紅、取消後晚回應紅、DOM harness 載入錯誤與舊測試缺 online 的修正；不以測試數量代表全量驗收。
- 獨立 review 補驗真 React hook／runtime／client API → modal 的 2 條合成路徑。覆核另以紅證確認取消後共享 notice 殘留 pending，最後只移除 owner 起始 pending notice；修後 2 項 owner 及同 2 項真 React 整合補驗通過，舊 15／6／4 項與 typecheck 沒有因這行刪除而全數重跑，兩段證據不混記。獨立程式／測試／文件覆核均無剩餘阻塞，dot 最終原碼驗收 Allow 精確 11 檔正常 PR 交付；程式已再次 freeze，尚未建立分支／PR、未發布／部署。既有 v65 可重建來源被拒且原 staging 不可用，沒有另路下載、改 fixture 或重建替代預覽。修後真瀏覽器、四尺寸／讀屏實機、實際 PDF bytes／版面／敏感來源遮蔽及跨孩子檔案隔離仍未驗；既有首屏、原紅及暫緩工作保持原狀。

## QA：取消工作與同批跟進事件（原碼驗收通過，預覽發布受阻）

2026-10-10 HKT，固定 master `6ef63e8a70db014a68a79baee7fab85fa2d836c8`。兩項工作合併同一背景事件時，取消的工作可能仍帶同批 completed；現行資料沒有逐成員 outcome／取消時間，不能猜先後或改寫真正已完成的歷史。

- `PersistentWorkCards` 對 cancelled 工作優先寫「此工作已取消，不再接續」，原結果為 cancelled 時列明「此工作關聯接續」，其餘列明「同批跟進事件」，避免把仍排隊同批內的失效 link 說成整批取消。只有文字呈現，不改台帳／DTO、日期、owner、控制或樣式。
- 取消先於另一工作完成、以及原事件先完成才取消，加上取消成員／仍排隊同批的投影，共三項真元件 React 靜態 render 反例通過；native controls 用替身，只證文字及輸入不變，並非真瀏覽器／responsive 驗收。frontend／Server typecheck 與根包4項核心／受影響檢查通過；review 後最後字串分支只重驗三個 render，未重跑核心，見[固定證據](../artifacts/verification/CHAT_FOLLOWUP_RECOVERY_20261010.json)。
- 原 API per-work 斷言紅保留，未把本 UI 修正說成 API 精確 outcome 已提供。獨立 review 無剩餘阻塞、dot 最終原碼驗收通過，准予精確11檔正常 PR 交付，尚未建立 PR；既有預覽可重建來源受阻，不繞路重建或發布，真瀏覽器補驗待來源恢復。#173 已合併，下列搜尋／準備單段保留當時的交付快照與發布阻塞。

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

