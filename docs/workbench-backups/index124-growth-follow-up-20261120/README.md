# 選配工作台第 106 頁：成長建議不再適用，原先的跟進還在嗎？

本頁比較兩種整頁設計。前 105 頁及舊選項保留；共 106 個主題、215 款，其中 119 款只外連，原有 165 張離線圖不變。

- **A：先看舊建議為何不能照做。** [Kubernetes 官方歷史公告](https://kubernetes.io/blog/2021/11/12/are-you-ready-for-dockershim-removal/)，Sergey Kanzhelev，2021-11-12。[原文版本](https://github.com/kubernetes/website/blob/b95e65a0dd00453d6cca66c909464a30f35d1010/content/en/blog/_posts/2021/are-you-ready-for-dockershim-removal/index.md)。頁首提示可能過時，問卷已結束；原跟進議題須另開，狀態獨立。
- **B：先看原待辦現況，再翻時間線。** [Taskwondo 作者 v0.4.0 完整手機原圖](https://github.com/marcoshack/taskwondo/blob/d1ba40fee4194134a2a9dc4eddb79eeaf365d880/docs/screenshots/taskwondo-mobile-item-activities.png)，原圖上方是工單現況，下方是活動歷史；不展示建議失效或關聯分頁。含作者公開頭像，只外連，不轉載。兩款均非育伴港現有畫面。

[育伴港原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/firestore-growth.ts#L267-L305) 分開保留曾接受的歷史、查核目前適用性、讀取原待辦。建議不再適用，不代表待辦已完成或取消，更不代表通知已送。只在確認可存取且讀到原待辦才顯示可查看入口，是兩款提出的設計，並非現有 UI 承諾。

## 重建與檢查

只備份可重建文本，不含私人預覽或外部原圖。以獨立驗證的 #105 HTML（SHA-256 `6ee6a45eb9743e5cd4f2dfa887e82e5cc828304b5c5a6e3b2f68ef866a697481`）為起點，執行 `python append106.py baseline105.html spec106.json output106.html`。

- HTML：34,301,333 bytes，SHA-256 `fea4b5527319bc1b67d20f737731f854d151288b3338260e80081718c65c967f`。
- 單檔 ZIP：22,746,322 bytes，SHA-256 `f4970021e8acc9900f97b7608d5c65e25715b432a689b8821e23f811b2524402`。
- 離線定向檢查通過：保留既有資料與選項、對照、搜尋跳轉、複製來源與確切版本。未讀寫真待辦、派送通知、更新線上站或四方案。
