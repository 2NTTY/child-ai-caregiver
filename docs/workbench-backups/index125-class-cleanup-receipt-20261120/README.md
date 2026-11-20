# 選配工作台第 107 頁：班級已解散，資料清理完成了嗎？

前 106 頁及既有選項保留；共 107 題、217 款、121 款外連，原有 165 張離線圖不變。

- **A：班級總覽保留待清理收據。** [GitLab 18.2 作者管理頁原圖](https://gitlab.com/-/project/278964/uploads/3af0d88c58167ea868233049e8052497/after-admin-groups.png) 顯示「待刪除／刪除中」的群組仍可在清單識別；原圖是混合列表，清理收據獨立分區是本方案。
- **B：單次收據拆開關閉和清理。** [CalPrivacy 2026-08-07 官方簡報第 4 頁右側](https://cppa.ca.gov/meetings/materials/20260806_07_08.pdf#page=4) 是一筆刪除請求的示範，先顯示已提交，再介紹後續處理及原單查核；不展示班級關閉或清理完成。兩款只外連上游，未重刊原圖。

[育伴港原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/firestore-sharing.ts#L669-L684) 將已關閉及資料清理狀態分開。查核同一筆收據不重送解散；只在原操作者有效範圍內，不承諾永久或跨裝置清理歷史。無法核實提交結果時不報成功。這是設計對照，未操作正式班級或更新線上版。

## 重建與驗證

純文字備份，不含私人 ZIP 或上游圖檔。使用獨立驗證的 #106 HTML（SHA-256 `fea4b5527319bc1b67d20f737731f854d151288b3338260e80081718c65c967f`），執行 `python append107.py baseline106.html spec107.json output107.html`。
- HTML：34,304,679 bytes，SHA-256 `b2dfea34d35970a4768ed97a6587e37faf4c13042377bd1b6db09d101b6bd506`。
- 單檔 ZIP：22,747,480 bytes，SHA-256 `2073448caf4628992c5ff915bf357fe1e8abab3ca138eb3997e7f7cecebba7ad`。
- 離線專項檢查通過：既有資料及選項完整；兩種結果、原單查核、來源及版本、搜尋跳轉、比較及複製所選來源。
