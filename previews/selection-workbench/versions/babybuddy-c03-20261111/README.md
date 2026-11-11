# C-03 · Baby Buddy 孩子概況 Dashboard

完整單頁原模板展示，使用固定合成資料。開啟 `dashboard.html` 查看頁面；`index.html` 提供編號與來源說明。尚未入選、未發布、未完成瀏覽器驗收，不是育伴港正式前端。

來源：babybuddy/babybuddy，commit `f02f28b7f96f8bb1b9a0212a377c327ce33e7699`，2017-10-28，package 版本 0.1.0。原模板為 `dashboard/templates/dashboard/child.html`，不是另一個只有姓名、生日、年齡及操作鈕的 `core/templates/core/child_detail.html`。

保留原模板九卡片、排序、主題、圖示及 Bootstrap 響應式欄位。原圖僅用作核對，沒有把原圖或其中的個人資料加入此包。所有姓名、活動、時間及數值來自 `fixture.json` 的全新合成示例。

下拉選單與導覽收合沿用原版腳本；跨頁導覽已停用，不會保存、刪除、創建計時器、連接帳戶或呼叫模型。原資料查詢已改成固定展示；原始應用及資料庫沒有在此執行。

Baby Buddy：BSD-2-Clause；Bootstrap/jQuery/Popper：MIT；Font Awesome 字體：OFL 1.1，樣式：MIT。完整通知位於 `licenses/`。歷史相依版本只為此來源參考，不建議直接作正式產品依賴，也不表示上游作者背書。

必要靜態檢查 6/6 通過。瀏覽器桌面／手機視覺、實際字體載入、選單／導覽收合、鍵盤焦點、讀屏及跨瀏覽器行為尚未驗證。完整改動與限制見 `manifest.json`。
