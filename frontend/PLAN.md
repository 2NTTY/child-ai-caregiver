# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W43：接線與需求文件清理

已隨 PR #90 合併至 `61a8faa`。主聊天現開始正式接線，活動包及驗收只在 [根 PLAN](../PLAN.md#active) 維護；本頁保留前端呈現交付，不另建 INT 進度副本。

更新：2026-10-06 UTC。範圍只限前端文件：收斂過時要求、接口回調及歷史流水，分清產品目標、已有預覽能力與正式接線缺口；不改產品程式、backend、資料庫或預覽部署。

基線：[PR #89](https://github.com/2NTTY/child-ai-caregiver/pull/89) 已於 2026-10-06 08:59 UTC 合併，master `26d36e8bf6c5f627d721ba9f26587349970ef183`，tree `cd31a9d24d03483f3d4e1cef6889593dc65bfc07`。本包七份文件已完成整理及定向覆核，依本次使用者授權走獨立分支／PR 合併；實際合併結果以本文件所在 GitHub commit／PR 為準，不把先前基線當本包合併提交。

### 整理結果與核對範圍

- 主要入口清楚，聊天專項移除已被替代的造型及接口；歷史只引用固定 Git 版本，不複製另一份歸檔
- 普通自動保存／重要確認是產品目標；既有 proposal accept 與正式能力缺口另列，不把預覽能力冒充已接通
- 文件回調、媒體能力及呈現規格對照現有程式；保留來源／scope／版本／unknown 等必要安全約束
- 已核對七份文件的基線 blob、差異、相對連結目標及可取得正文的錨點；原明確錨點保留，另保留已改名章節的相容入口。定向 source review 的三項文字歧義已修正並覆核，沒有待修阻塞
- 只變動 Markdown，不改程式、依賴、美術或凍結證據；純文件包未重跑 UI、模型、build 或全量測試。下列較早測試結果不算本包新增測試

### 接手入口及後續

Codex 先依 [HANDOFF 的閱讀入口](HANDOFF.md#reading-order)，再按功能核對正式 repository 的 API／controller。正式 Agent 普通自動寫入／重要分類與確認事件、持久待確認總表、各領域正式 owner 與訂閱、關注鏈 archive／restore、長期報告及 PDF 仍屬待接線；本文件清理不代表這些功能已完成。

### 已完成呈現基線

FE-W42 的 v49 已於 2026-10-06 08:03 UTC 發布，程式、文件及證據已包含於 PR #89。沿[輸入框限定驗收](verification/composer-refinements-2026-10-06/browser-qa/v49-browser-report.md)：304 項測試、typecheck、37 路由 export 及桌面／390／320 檢查通過；send 持續按壓／釋放、IME／真機未新增實測。v48 的[按鈕、手機導航及水滴限定驗收](verification/mobile-ripple-refinements-2026-10-06/browser-qa/v48-browser-report.md)仍只支持其原範圍。

真 API／模型／家庭資料、真相機／咪高峰、完整 Server 歷史、APK／真機與跨瀏覽器／每幀無閃動，均不能用合成或靜態證據替代。GitHub 未有 check／status／workflow runs，不稱 CI green。

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
