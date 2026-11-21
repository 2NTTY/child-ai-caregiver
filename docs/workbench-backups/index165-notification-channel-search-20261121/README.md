# 選配工作台第 147 頁：搜尋「實際事項」找到一則提醒，為甚麼卡片沒有這幾個字？

- **A｜打開消息，逐個渠道看。** 現況：列表預覽第一個渠道，詳情逐個展示已保存的內容。參考 [Qt Linguist 6.11 完整視窗](https://doc.qt.io/qt-6.11/images/linguist-linguist_2.webp) 的分區。
- **B｜卡片直接標出命中的渠道。** 未實作：卡片顯示命中渠道及原句，打開後定位該欄。參考 [DocFetcher Pro 完整搜尋視窗](https://docfetcherpro.com/images/screenshot_033_main_window_numbered.png) 的命中標亮。

搜尋涵蓋一則已載入消息的所有渠道。例子假設瀏覽器通知排第一，Telegram 排在後面；實際未必有多個渠道。已保存的內容不是送達證明。沒有傳送通知。兩張官方原圖只外連；來源、版本及原碼位置見 `spec147.json`。

## 重建

- 147 題、297 款，其中 201 款只外連。保留 165 張舊圖及既有執行碼。
- 基準 HTML SHA-256 `53aecaebcaa78dead49682dafffc19689118d7b6fd7ea585bb1fed971d4e985d`；執行 `python append147.py baseline146.html spec147.json output147.html`。
- HTML 34,519,372 bytes，SHA-256 `28aded1aeb85933d6b14e83101ac0d2d188f2070235c78cffe17c08b1fd802d6`。
- ZIP 22,811,973 bytes，SHA-256 `484f0da5729a0a8f859af37c0b0a428e95e72a69771d9ca3ea335b172a561d3c`；`zip-proof.py` 可核對及還原。
- 僅獨立備份；線上工作台、產品與主分支均未更新。
