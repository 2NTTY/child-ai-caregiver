# 選配工作台第 136 頁：家人剛改過這筆照顧記錄，之前勾選的永久刪除還算嗎？

- **A｜先核對會刪掉甚麼。** [英國司法部整頁原圖](https://design-patterns.service.justice.gov.uk/assets/images/submission-1783074553746/confirm-action-screen.png)把對象摘要放在確認之前。原圖是移出個人清單，不是永久刪除。
- **B｜先看家人改了甚麼。** [Confluence 7.16 整頁原圖](https://confluence.atlassian.com/conf716/files/1108682039/1108682040/1/1643591797563/CompareChanges.png)用兩個版本標籤及差異正文引導核對。只借比較版面，不借還原或刪單一版本。

舊勾選作廢。可以保留這筆記錄，或採用最新版再核對。採用版本不等於確認刪除；離線或無編輯權不能送出。刪除只涉及本筆及全部更正歷史，孩子、其他記錄和私人聊天保留。結果未知先查原操作；工作台不執行真實刪除。

## 重建與檢查

- 第 135 頁及以前不變；共 136 題、275 款，其中 179 款只外連，保留 165 張既有圖。
- 以 SHA-256 `c37068348fd8b798d4676ca7655984ed1a432ee06d508e4cc9ecfb9f537f438d` 的 #135 HTML 執行 `python append136.py baseline135.html spec136.json output136.html`。
- HTML 34,467,081 bytes，SHA-256 `095a65857b935befb799a7cfeefd7e96dea36c067e832112216640cdd31e11bb`；ZIP 22,799,089 bytes，SHA-256 `4fa0f3b9502f5891e552f496d147640cacb182d45e5560e3fb701cbac1b30247`。
- 從還原的第 135 頁重建後與草稿逐位元組一致，離線檢查通過；未更新網站、主分支或四方案。
