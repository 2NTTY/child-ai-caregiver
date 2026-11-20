# 選配工作台第 109 頁：週二安排、週五才確認完成，要從哪天找？

保留前 108 頁及既有選項；共 109 題、221 款、125 款只外連，原有 165 張離線圖不變。

- **A：完成／取消日期清單，同列看最後安排。** [Locus Studio 官方 iPhone 日誌原圖](https://www.locusgtd.com/images/help/ios/en/14-logbook.png) 示範按完成日分組及單列完成時刻；原圖沒有最後安排日期，該欄是本方案。
- **B：歷史月曆先選日期的意義，再找同一筆。** [Baserow 1.16 官方原片 11–25 秒](https://baserow-backend-production20240528124524339000000001.s3.amazonaws.com/blog_images/baserow_release_1-16.mp4#t=11,25) 示範同一張卡用開始或結束日定位，不是完成回報。兩款只外連，不重刊素材。

[育伴港原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/task-view-model.ts#L112-L130) 這個原生待辦的現版歷史按香港時間的完成／取消日，普通待辦月曆只投影未結案。最後保存的安排不是最初約定；系統確認日期也不證明交件日期。雙軌歷史月曆只是設計參考，兩種日期指同一項，不更改任務，也不重算。

## 重建與驗證

分支只備份可重建文本，不含私人預覽包或上游圖檔。使用獨立驗證 #108 HTML（SHA-256 `7854b8c2164dd6798473510a1b2fff8f06c5a7982d4c9edeeb9202161cd4b84b`），執行 `python append109.py baseline108.html spec109.json output109.html`。
- HTML 34,312,769 bytes，SHA-256 `3355a65908afeb00a1a77c16785ef1d048ac2363d937b97768f40b154f3b8b8a`。
- 單檔 ZIP 22,750,260 bytes，SHA-256 `1f82e1b7de6e231e937636c65388d07c5e5812241ecaf2c3460a34d5276e9048`。
- 專項檢查：舊頁與選項不變，兩種日期的區別、上游圖／片及版本、搜尋跳轉、比較與複製。未更新線上版、四方案或 master。
