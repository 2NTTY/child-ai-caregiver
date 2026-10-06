# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W39：前端舊實作清理與驗收入口收斂

更新：2026-10-06 UTC。基線為已合併 PR #88 的 master `6477fe65964adea0cde48c784c0598b2cb47d5bf`；其 tree 與已驗修訂相同。本包只修改 `frontend/**`，使用獨立分支／PR，不自動合併。

### 範圍與裁決

- 逐項核對前端目前用途及引用；保留「家長跟 Agent 說，然後查看」的主要流程，手動輸入作補救
- 已替代且沒有 consumer 的 8 個舊元件／helper 移出 runtime，連同必要舊測試、browser flow 原文保存於 [_archive/fe-w38-replaced-ui](_archive/fe-w38-replaced-ui/README.md)，附原路徑、雜湊及替代入口
- 清除 86 個證實無引用的 style keys（首批 6 個及後續 80 個），以及舊假 checklist state、單照片 handoff、Growth 無作用 props；不改 canonical owner、事件、版本或來源權限
- 7 個已過時 browser 選項明確回報待遷移。預設舊 aggregate／未知選項在啟動瀏覽器前失敗；25 個其他 runner 保留入口，但「可執行」不等於在新修訂通過
- 保留 legacy-preparation、unknown 原操作恢復、scope／authority guards、a11y 隱藏文字、動態樣式、平台 adapter，以及尚有公開／測試用途的 helpers。安全求助相關候選不隨清理移除
- DESIGN_SYSTEM 的舊元件連結已更新到現行 HomeFocus／HomeActionSummary／RightRailContent；根文件不由本域改動

### 驗證與交付關口

1. 63 檔清理 patch 的 preimages 已對照合併基線，zero-fuzz 套用至獨立工作區；新舊 source／snapshot 及原失敗證據保持可追溯
2. 暫存階段 typecheck、67 項必要純測試、逐 symbol／AST 等價及本地連結檢查通過；最終整合 [typecheck、278 項 aggregate 及 37 路由 fresh export](verification/cleanup-v2-final-2026-10-06T0622Z/checks.json)均通過，不把前一 PR 的結果當本包通過
3. v46 已於 2026-10-06 06:33 UTC 公開發布；[桌面／320px 限定 smoke](verification/cleanup-v2-final-2026-10-06T0622Z/browser-smoke/verification-summary.md)通過，覆蓋 Home／Care／Growth／Memory、關注恢復、孩子切換及未送出草稿保留；真 API／持久化／原生與逐幀無閃動仍未驗
4. [Draft PR #89](https://github.com/2NTTY/child-ai-caregiver/pull/89) 已建立，首個 head 為 `4fc6fff6`，本次 smoke 證據另行追加。可讀 exact-head checks／statuses／workflow 均無項目，不稱 CI 全綠；本包沒有自動合併授權。使用者新提出的其他按鈕閃動問題另作診斷，不以此 cleanup smoke 當其驗收

### 已合併的前包

PR #88 已於 2026-10-06 06:19 UTC 合併。其 [274 項測試／typecheck／37 路由建置](verification/reconstructed-revision-2026-10-06T0533Z/checks.json)及[限定 browser 檢查](verification/reconstructed-revision-2026-10-06T0533Z/browser-qa/verification-summary.md)均保留原範圍，公開 v45 屬該修訂。首頁圖為使用者補交的新資產，不冒稱舊 Git 原件逐位元一致。

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
