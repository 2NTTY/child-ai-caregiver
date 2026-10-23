# 育伴港：頁面版式與重新讀取穩定性

**snapshot29 的代表瀏覽器檢查通過，原 count／底線紅項已在限定場景重驗；不是全站全功能通過。** 20 個去重 scripts、159 項通過，export／靜態包裝通過；完整型別檢查因 V8 heap 耗盡未完成。部分自然 focus 場景留待 snapshot30；本包凍結 snapshot29 的結果與限制。

本批沿用同一 [draft PR #253](https://github.com/2NTTY/child-ai-caregiver/pull/253) 與[既有合成預覽](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site)。本包凍結時，最後取得的遠端基線為 `2fdb8aa31a59fe4b01be8b7470da91740a793bae`，線上仍為 Site86／snapshot27a；snapshot29 已有凍結 bundle 與有界 browser 證據，尚無本版公開發布結果。

## 這批要改善甚麼

- 歷史待辦改為單欄閱讀列；已保存核對記錄先呈現具體事件正文。
- 同一身份／孩子範圍重新讀取時，保留已有內容、數量、已讀頁面和閱讀焦點；不是放寬寫入或確認權限。
- 記憶／待辦按已載入 ID 範圍原子更新；私人備註按已掃描 cursor 範圍重讀，確認窗保持原版本。
- 設定的檢視依據、草稿和刪除確認；來源的新鮮讀取；概況已套用期間與空 snapshot，分別保留各 owner 的安全界線。
- 分頁底線按實際位置重新量測；桌面「管理」次序調整為核對 → 記憶 → 檔案 → 全部功能。

## 目前證據分層

snapshot29 最終來源／測試範圍為 **28 個產品檔＋16 個測試檔＋1 份設計文件＝45 檔，553 個 build inputs**。初次 43 檔後，只修正兩份既有測試：Care shallow harness 展開新卡片元件、empty-history 明確區分首次載入與已確認空 snapshot；產品 inputs 未變。兩次原失敗保留。最終 **20 個 unique scripts／159 項通過**，各 script 只按定稿計一次。

完整 typecheck 384／512 MiB 程序 heap 均明確報 V8 heap out-of-memory（exit 134），沒有完成型別診斷。shared UI／navigation 的 scoped 檢查通過（845 source files、零 diagnostics）；Care scoped 檢查同因 heap 耗盡停止，其餘五組未跑。這些不構成完整 typecheck 綠燈；snapshot28 的 137／SIGKILL 仍是不同的未知原因失敗。唯一 export 已 exit 0（153.595 秒），65 原始產物／36 HTML／72 包裝檔；553 inputs 及 45 檔 scope 前後一致。靜態 validator 通過；Care count／empty／saved／detail、Tabs、歷史單欄與鍵盤／回焦、合成模型設定審閱窗有界 browser 通過。Memory／tasks loaded-more、summary 未套用期間及通知表單不在29已驗列表，留待30。29尚未公開發布。

作者定向測試、獨立來源審核及整合測試各自記錄，**不把作者案例相加成整合通過數，也不以來源審核代替 GitHub required review／CI**。snapshot28 的 typecheck 137／SIGKILL 與 export 130 中止保留，不能改寫為成功。

Bundle SHA-256：`6f3e3bc65a6201f666d8bf96c0d5933ac64133b724ef579874adfcaaa257c8e5`。完整產物 identity 見 [export 收據](receipts/export-identity.json)。

完整瀏覽器結果見 [browser checks](receipts/browser-checks.json)；只附 **8 張紅／綠代表原圖**，52 張新版原圖另以[原件索引](original-images-index.json)保留 hash，不全數附上。

## 閱讀入口

- [修改範圍與安全界線](changes-and-tests.md)
- [18-route source／browser 覆蓋矩陣](route-coverage.md)
- [舊版紅證與新版瀏覽器階段](browser-evidence.md)
- [原圖索引及 SHA-256](evidence-index.json)
- [最終 45 檔來源凍結清單](receipts/source-scope-final45.json)及[整合檢查收據](receipts/checks.json)

[前一輪家長視角審查](../../frontend-2026-10-22/parent-audit-27/README.md)及背景補驗保留原版本與結果，不改寫為本批通過。

## 仍然不是甚麼

這是合成前端驗收，不是真家庭資料、真模型、正式 API／通知、GCP 服務或 Android OTA 驗收。CSS viewport 不代表 Android／iOS 真機；本輪沒有全面螢幕閱讀器或全頁全狀態通過的結論。全站 focus 修補指跨域覆蓋範圍，不是每個 route 全功能都已瀏覽器驗收。

## 與後續範圍分開

全站 metadata／icons 的一致性補齊已另列後續工作，正獨立實作與審核，尚未納入本候選，**不屬 snapshot29 的 45 檔或 159 項結果**。後續如有修改，需用自己的版本與驗收證據，不能回填本包。Contact 既有 schema 契約問題亦未納入本候選，不能稱已隨本批修復。
