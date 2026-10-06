# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W42：Codex 參考的聊天輸入框呈現

更新：2026-10-06 UTC。依使用者提供的實際截圖及 [Codex 官方參考](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)，在已驗 v48 來源另建獨立修訂；不是桌面 Codex 逐像素複製。

### 本包變動與限制

只改 composer 呈現：24 圓角、較柔和邊界與輕陰影；面板內距上／下 4、左／右 8，輸入 8／8／4；透明工具間距收緊但維持滑鼠 40／觸控 48 點按區；送出改 36 黃圓且移除常駐描邊，按住及 hover 只作用於圓形，focus 另有清楚細框。

輸入 48–168 自動高度、稳定 textarea、IME、Enter／Shift+Enter、既有 refs／handlers、附件與草稿 scope／遲到回呼保持原樣。不得因造型修改改成真正送出或新增資料處理。

### 驗證與交付

Owner 定向 11 項檢查及補齊同基線唯讀 family 型別後的 typecheck 通過；首次缺依賴失敗僅有 checks 記錄、未留原 stdout，不補造。Combined typecheck、aggregate 304/304、fresh export 37 路由均通過；v49 已於 2026-10-06 08:03 UTC 發布，[桌面／390／320 限定驗收](verification/composer-refinements-2026-10-06/browser-qa/v49-browser-report.md)通過：多行上限／捲動、Shift+Enter、focus、草稿隔離及局部 hover 正常；send 按住／釋放與 IME／真機未新增實測，不算已通過。

只保存可重用的呈現原則於 DESIGN_SYSTEM，實際檢查與未驗限制留本包；沿既有 PR 更新流程，不自動合併。v47／v48 程式、文件及證據已核實同步至 PR #89 的 `046ded1f`，本輸入框修訂另行追加，不能由公開站已更新推定 Git 完成。

### 已完成基線

v48 的 300 項測試、37 路由 export 及 [主／危險按鈕、手機導航及水滴手勢限定驗收](verification/mobile-ripple-refinements-2026-10-06/browser-qa/v48-browser-report.md)已完成；保留原 source／dist／證據，不將其視作此輸入框改動通過。

### 保留限制

正式 Agent 普通自動寫入／重要分類與確認事件、持久待確認總表、各領域正式 owner 與訂閱、成長關注鏈 archive／restore、長期報告生成與 PDF 均未因此接通。真 API／模型／家庭資料、真相機／咪高峰、APK／真機、完整 Server 歷史與跨瀏覽器／每幀無閃動均不能用合成或靜態證據替代。

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
