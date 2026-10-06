# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W41：手機選中提示、水滴拍照鈕及深色按鈕回饋

更新：2026-10-06 UTC。本包沿已發布 v47 的凍結來源，獨立整合，不回寫 v47 檢查證據；只處理 frontend。

### 範圍與來源

- 手機底部入口補持續淺青選中面及短頂線，Records 提供 selected／aria-current，保留路由判斷、長按上拉及離頁守衛
- 左下拍照鈕改為 72×72 原生 SVG 黏附曲線，實際命中區維持 56×56；裝飾不接收 pointer，不遮擋導航／安全區，不改拍照、長按、拖曳選單及草稿流程
- AppButton primary／danger 的白色 ripple 已在 v47 實測確認，現局部使用黑色 12% darkActionRipple；白字、底色、busy／disabled、尺寸及其他角色不變
- 不修改套件時鐘 ripple、內容／孩子安全遮幕，也不以本次修正宣稱所有平台逐幀無閃動

### 驗證與交付

Mobile 9-file 與 ripple 3-file patch 無重疊，以 zero-fuzz 套入新來源；combined typecheck、aggregate 300/300 首輪通過。Fresh export 37 路由通過，v48 已於 2026-10-06 07:25 UTC 發布；[限定按壓及手機導航／水滴手勢畫面驗收](verification/mobile-ripple-refinements-2026-10-06/browser-qa/v48-browser-report.md)通過：主／危險按鈕黑色 state layer、390／320 持續選中、56px hitbox／72px 裝飾穿透及安全手勢均已觀察，沒有拍攝或傳送；任何原生、真資料／模型、圖片外發都未包含於本包。

必要畫面範圍為深色主／危險按鈕的按住與放開、手機導航持續選中、SVG 實際邊界／hit target、方向手勢及取消；只用合成資料，不送照片或訊息。Git 使用明確後續 commit，不自動合併 PR #89。

### 已完成基線

清理 PR #89 與 v46 的 278 項測試、建置及 smoke 已交付。v47 的 292 項測試、37 路由 export 及 [11 控件／44 按住樣本與歷史／準備頁檢查](verification/ui-refinements-2026-10-06/browser-qa/v47-browser-report.md)完成；v47 的 primary／danger 白色 ripple 是本包要修的已知殘留，不能把舊版說成全部已修。

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
