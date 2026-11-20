# 選配工作台第 127 頁：想撤回週六的站內跟進，之前的觀察和已分派待辦還在嗎？

- **A｜在原記錄撤回。** [Todoist 官方工作區](https://www.todoist.com/inspiration/todoist-new-task-view)把提醒和任務本身分開。育伴港方案在原頁指出哪一次站內跟進可撤回，保留觀察、關注及已分派待辦。
- **B｜另開確認頁。** [AWS 官方確認視窗原圖](https://docs.aws.amazon.com/images/codepipeline/latest/userguide/images/stop-execution.png)把停止操作及影響列在同處；這裡借用的是先看影響再確認，而不是借用 AWS 的執行語義。育伴港沒有這個獨立頁面。

這是整頁展示，不會撤回已派發的跟進、倒轉舊記錄或發送通知。只有同一孩子、同一次跟進、已確認仍「等待／排隊」且具權限的結果才可顯示成功；狀態不明不能當完成。spec127.json 記下確切來源、版本和產品程式碼位置。外部原圖只外連。

## 重建與檢查

- 前 126 頁不變。127 題、257 款，其中 161 款只外連；165 張既有圖保留。
- 已驗證 #126 HTML SHA-256 `96a1f729883776ee8ae4514ddbd2dc290ef44671131a79198369893b5730a271`，以 `python append127.py baseline126.html spec127.json output127.html` 重建。
- HTML 34,404,154 bytes，SHA-256 `d5fac2a2025ae8eb5c03d10ae685db008644374be8dd25c5eeb60e65267ba148`；ZIP 22,779,679 bytes，SHA-256 `90de84d8c3b234166cc9dd5674fda06387d9f91dc064ce602a5bb3fdf6d04d98`。
- 離線驗證，不代表現網權限驗收；不更新網站、主分支或四方案。
