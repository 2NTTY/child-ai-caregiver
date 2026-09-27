# FE-W01 預覽驗證記錄

日期：2026-09-26。分支：`codex/fe-w01-web-home`。使用本機 Microsoft Edge 154.0.4258.37、Playwright Core 1.63.0、Expo 57.0.24、React Native Paper 5.15.3。以下均屬合成資料的獨立 Web 預覽。

| 檢查 | 結果 |
|---|---|
| `npm run typecheck` | 通過 |
| `npm run build:web` | 通過，產生 Expo Router 靜態 Web 輸出 |
| `npm run verify:web` | 通過；1586／1440／1024／390／320 CSS px 均無頁面橫向溢出，可見操作沒有被橫向裁切，沒有瀏覽器頁面例外 |
| 鍵盤及互動 | 桌面基本聊天入口、合成情境切換、原操作查核可用 Enter；孩子切換改變可見記錄，本地篩選可顯示無結果 |
| 必要狀態 | 待確認、處理中、已保存、失敗、結果未知、離線、讀取中、尚無孩子均在合成情境中可分辨 |

| 畫面 | 圖檔 |
|---|---|
| 與參考圖同尺寸的桌面首頁 | [1586×992](screenshots/home-1586.png) |
| 標準桌面與中等寬度 | [1440](screenshots/home-1440.png)、[1024](screenshots/home-1024.png) |
| 手機瀏覽器頂部與向下捲動 | [390 頂部](screenshots/home-390.png)、[390 下方](screenshots/home-390-lower.png)、[320 頂部](screenshots/home-320.png)、[320 下方](screenshots/home-320-lower.png) |
| 結果未知狀態 | [390 結果未知](screenshots/home-390-unknown.png) |

未驗證：真 Server/API 接線、授權／帳號隔離、正式瀏覽器整合、其他瀏覽器引擎、Android App／真機及使用者視覺確認。這些不由合成畫面推定通過。
