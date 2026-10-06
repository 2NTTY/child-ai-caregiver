# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W44：正式介面文案與讀取狀態整理

2026-10-06 UTC。基線 master `f2aa299d418c10586e99260ef36685619dbb67b2`（PR #97）；使用者要求按已接線版本全面排查並在新 PR 修正多餘字句。本包只改 `frontend/**`，不重新接線 backend、不改正式資料、不部署或自動合併。

### 範圍與已定方案

- 正常 loading／empty 每區保留一個短狀態；刪重複防禦句、常駐開發解釋與已過期能力說明
- 真實操作不能標為「模擬／合成」；保留提交前預覽、具名確認、家庭共享、外送／費用、未保存及 unknown 等實際必要訊息
- 首頁、側欄及共用狀態減少 badge／標題／正文疊加；無障礙狀態播報仍完整
- 釐清待辦首次讀取失敗與實際 fetching，首頁重試沿原 Task owner；保留部分／舊資料提示和原操作恢復，不把未讀取當零項
- 尚無正式投影的首頁助手重要提醒只作誠實、精簡呈現，本包不虛構 feed

### 目前狀態與交付門檻

已完成程式及文案修訂，交付於 [draft PR #98](https://github.com/2NTTY/child-ai-caregiver/pull/98)。新 readState 與 mutation operation 分開；首次讀取失敗可重試，舊資料保持明示，首頁讀取沿同 scope 的 Task owner。必要確認、模型外送／費用、來源／健康未知及原操作查核保留。

六個定向測試檔補驗 50/50 通過，frontend typecheck 通過；[檢查結果](verification/production-copy-2026-10-06/checks.json)。首次批次 39/50，11 個失敗來自整合前的測試 harness／preview owner 假設；保留原失敗，兩份測試對齊現有正式 provider 及 shallow mock 後補驗，沒有為配合測試改 runtime。原碼 review 無已確認阻塞。

本包未跑瀏覽器畫面、export、真 API 或全量回歸；上述定向結果不等於正式部署／畫面驗收。PR 尚未合併、網站未因本包更新。
真模型、外部通知、正式家庭資料、部署及完整回歸矩陣不在本包；若必要檢查缺環境，列出具體限制。主聊天的 INT 實作／部署狀態只以 [根 PLAN](../PLAN.md#active)及[正式入口指引](../docs/PRODUCTION_FRONTEND.md)為準。

### 已完成前端基線

FE-W43 七份文件清理已隨 [PR #90](https://github.com/2NTTY/child-ai-caregiver/pull/90) 合併；v49 呈現及證據隨 [PR #89](https://github.com/2NTTY/child-ai-caregiver/pull/89) 合併。之後 INT-W01～07 已把新前端接上正式資料並記錄部署；舊「尚未接線」限制必須按目前程式／正式文件重核，不能因保留歷史就視為現行能力。

[輸入框限定驗收](verification/composer-refinements-2026-10-06/browser-qa/v49-browser-report.md)及[手機導航／水滴驗收](verification/mobile-ripple-refinements-2026-10-06/browser-qa/v48-browser-report.md)只支持各自版本，不是本包新證據。

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
