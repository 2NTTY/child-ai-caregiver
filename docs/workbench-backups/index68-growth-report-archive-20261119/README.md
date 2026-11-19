# 第 54 題：成長檔案：按期間翻閱報告與舊版

## 育伴港基準

既有已讀原始碼基準 `36434a235458646f8398229628e67f8ca5316bac`：[SummaryScreen 路由與分頁](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/screens/SummaryScreen.tsx#L24-L90)、[GrowthArchive：指定期間、選擇版本及回到目前版](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/components/growth/GrowthArchive.tsx#L165-L265)。範圍是 `/summary?tab=archive` 的報告翻閱，不是成長曲線、醫療判斷、PDF 匯出或記錄更正。未操作育伴港正式站。

## 來源與取捨

1. **報告-01｜Finalsite：先選年份，再找期間**。[官方說明](https://schooladmin.zendesk.com/hc/en-us/articles/18093496298637-Billing-Statements)（2026-09-08 更新）的「Monthly Statements」段落有一條[公開 GIF](https://cdn-std.droplr.net/files/acc_1254591/XIUW1P)；這不是旁邊另一張結單示例或摘要按鈕。官方文件明載所選月份可屬本年或過去年份。核對 2766×1214、107 幀的原動圖：第 53 號索引的整幀可看到右側選年、左側月份，像素與既有檢視用整幀相同。原 GIF SHA-256 `dd2a2928685bf392a46ed263f72c7883b38ed0d35efa0d3f1ed60f8342355580`。參考的是選單，不複製原畫面的示例資料或帳務操作。
2. **報告-02｜WordPress：正文旁翻看不同版本**。[Revisions 官方指南](https://wordpress.org/documentation/article/revisions/#revisions-screen)中新版畫面說明配有[原圖](https://wordpress.org/documentation/files/2019/02/view-revisions-1024x486.jpg)，不是 Classic Revisions 的左右文字比較圖。圖為 1024×486，中央正文、上方時間滑桿、右側是附日期與時間的版本清單。指南說明新畫面從 7.0 起提供；更新紀錄指 2026-09-28 為 7.1 更新圖片與影片。圖中沒有組建號，網址的「2019/02」不可當作圖片版號或拍攝日期。圖片 SHA-256 `631084de24d27ae5e51759aaae8f9246c94b73371688925247c992370fceb349`。只借鏡閱讀舊版，不導入還原或內容差異工具。

兩款都在使用者點擊後才開啟來源：一條主圖／動圖，一條官方文件。沒有下載、重製或內嵌到交付物，沒有取得或傳送真實家庭資料。字圖及商標仍屬各權利人。

## 驗證結果

- 私人單檔 HTML：30,895,875 bytes，SHA-256 `5b429d40e70c60deded40c32d1c246f7c4b4171e0ca59586030c82c60cb76633`。
- 54 題、111 款（77 離線，34 外鏈），53 個原主題的資料位元組及原有 146 張圖的雜湊均保留；未新增內嵌媒體。
- 原檔 #53 雜湊 `4e26833029e0fd72cf354ddd0c53d672d20932c9a3521b3f86cccd8bb7373415`。靜態驗證與 33 項實際 HTML 的離線閱讀器邏輯測試均通過。這不是完整互動瀏覽器驗收，亦不證明任何育伴港新功能已發布。
