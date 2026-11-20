# 育伴港選配工作台｜第 101 題：交接只選本週，跨週文件會交出哪一部分？

在育伴港，跨期文件預設略過；老師可明確加入整份目前可讀的版本，其他記錄的日期不變。這是[交接畫面的既有邏輯](https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/account/HandoverControls.tsx#L238-L269)，不是新功能。本次不建立或傳送交接包。

- **101A 先看要交的項目，再標明整份**：[Brolly 官方整串匯出畫面](https://support.brolly.io/articles/archive/archive-messages#exporting-a-conversation)；[按日期整批匯出](https://support.brolly.io/articles/exports/new-export-wizard)是另一個入口。兩篇官方文件標示 2026-10-12 更新，未列產品 build。保留原站連結，不轉載截圖。
- **101B 同一頁列清全份與區間**：[Kdenlive 完整原版對話框](https://github.com/KDE/documentation-docs-kdenlive-org/blob/02fcac89ab0cbc1b9771a40e4b61d461e2b9282c/images/getting_started/kdenlive_renderer.webp)，470 × 475，Git blob `f0a8b49b6de8cbd3ef9fbba73184c091841d92d1`。Kdenlive 26.08 手冊快照，畫面本身未標軟件 build；KDE / Kdenlive 文件貢獻者，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，原圖未改。借用清楚的範圍選項，不等於育伴港能依日期裁切文件。

完整 HTML：101 題、205 款（115 款只連原站）、159 張離線原圖。32,665,189 bytes，SHA-256 `cd24d15a37c978d903a5d4dbdf8fb373e187f107c73f773f27047fe75ac3ed6c`。離線檢查通過：前 100 題和頁面程式保留；新題跳轉、搜尋、對比、選擇及複製來源；另核舊搜尋。01 沒有可轉載原圖，未宣稱兩款均可離線看。未做實機瀏覽器驗證，沒有 PR、合併或網站發布。

私下保存完整 HTML；這條分支僅保存來源與可重建增量，不上傳原圖或完整包。重建需要 Python 3 + Pillow、[第 100 題原版完整 HTML](https://github.com/2NTTY/child-ai-caregiver/blob/6f7a0d2d74e34c2e4325c58b4c09c874044873f5/docs/workbench-backups/index118-child-deletion-scope-20261120/README.md) 及上方 Kdenlive WebP 原檔。把 WebP 命名為 `b-kden3.webp`，與 `spec101.json` 同資料夾，執行：

```sh
python append101.py baseline100.html spec101.json workbench101.html
```

程式核對原檔及重建結果指紋，不覆寫現有檔案。
