# 選配工作台第 139 頁：待辦月曆沒有標記，就代表那天沒有待辦嗎？

- **A｜先看整月。** [GNOME Calendar 月份原圖](https://static.gnome.org/catalog/app-screenshot/org.gnome.Calendar/image-1_orig.png)和[官方圖集](https://apps.gnome.org/en-GB/Calendar/)。比較提案在月格旁保留「時間待核對」。[Todoist 的 No date 側欄](https://www.todoist.com/help/todoist/features/use-the-calendar-layout-in-todoist-lPHRQTu0o)只供局部結構參考，不搬拖曳改期。
- **B｜先核對不能排入日期格的待辦。** [Things Someday 原圖](https://culturedcode.com/frozen/2025/10/dates-someday.jpg)及[官方指南](https://culturedcode.com/things/support/articles/4001304/)參考把清單獨立成頁、保留 Upcoming 入口。不把待核對說成擱置或延期。

月格空白只表示已載入資料無可排入該天的待辦，不能當成伺服器所有資料都沒有。無法排入日期格的事項另行核對，不自動補今天。切換日期只篩選；清除日期仍保留搜尋及原範圍。不新增無日期待辦、不改期、不寫資料。均為合成例。原圖只外連；版本、權利界線及項目程式來源見 `spec139.json`。

## 重建

- 前 138 題及原執行碼不變；139 題，281 款，其中 185 款只外連，保留 165 張既有圖。
- 以 SHA-256 為 `424126a50fef12f33447137f010bb998551fb84a02a6ab2eacf1669d4726f7c0` 的 #138 HTML 執行 `python append139.py baseline138.html spec139.json output139.html`。
- HTML 34,482,763 bytes，SHA-256 `e2d079ab30c4dd895ae76db05b047aec1b18db3b5d04460b07b7c6b24f9f0ac0`。
- ZIP 22,802,530 bytes，SHA-256 `90f229ca281280487faaf3d8be94661581bae7091d91d348550ad78e247da31c`；可用 `zip-proof.py` 核對及還原。
- 僅獨立備份，沒有更新網站、原項目或主分支。
