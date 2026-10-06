# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
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
