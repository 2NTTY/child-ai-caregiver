# 工作台第 19 版：外觀偏好的兩種放法

此提交只保存自行撰寫的來源索引、指紋與驗收摘要。**不能單靠這個 GitHub 分支還原完整預覽。** 沒有加入圖片、第三方原碼、字型、應用程式、預覽 HTML、資產壓縮包、帳戶資料或私人備份存取連結。獨立比較檔和第 19 版增量另有私人備份，整個歷史工作台仍須先還原既有基底。

## 比較的是資訊放在哪裡，不是兩套等價功能

- **A：shadcn/ui 外觀專頁。** [固定表單](https://github.com/shadcn-ui/ui/blob/4ccff13f9c68cd12bca289faa8d513b3f748ea37/apps/www/app/examples/forms/appearance/appearance-form.tsx)，`shadcn-ui/ui@4ccff13f9c68cd12bca289faa8d513b3f748ea37`，原路徑 `/examples/forms/appearance`。由設定側欄進入專頁，集中選擇字型及主題，畫面至最後提交按鈕結束。兩張圖都是同一桌面版面；深色外殼裡標示選中的仍是 Light。沒有可驗的獨立手機重排，也不表示作者示例能儲存偏好。
- **B：Tribu 設定總覽。** [作者 PR #477](https://github.com/itsDNNS/tribu/pull/477) 指定的版本是 `itsDNNS/tribu@d10c0aff47ccda3b7060aaaef85461b75efd97de`；[固定設定視圖](https://github.com/itsDNNS/tribu/blob/d10c0aff47ccda3b7060aaaef85461b75efd97de/frontend/components/settings/index.js)，原路徑 `/#settings`。四組設定包括外觀、密度、徽章及其他管理入口；桌面淺色、手機模擬深色，都見至最後支援入口。作者說明使用隔離後端與合成家庭；同版另一個德文模擬測試並非這兩張英文原圖的擷取紀錄。
- **育伴港對照點。** [固定版設定畫面](https://github.com/2NTTY/child-ai-caregiver/blob/39f914dafc516d89904bfe99f38d112972480753/frontend/src/screens/settingsScreen.tsx#L93-L100)，`/settings?section=preferences` 只含動畫與操作、應用背景；通知另頁。此比較沒有建立這些功能，也不等同原站互動或權限測試。

## 上游原始圖的指紋（未上傳圖片）

以下是原 PNG 的像素尺寸，不是此次工作台測試的 CSS 視窗寬。四張原圖代表兩款設計。授權記錄：A、B 專案各有 MIT 正文；私人資料包另保留對應 Lucide 0.214.0 與 1.44.0 的兩份 notices。此說明不是所有素材公開再分發授權。

| 方案與作者倉庫內路徑 | 像素 | bytes | SHA-256 |
|---|---:|---:|---|
| A `apps/www/public/examples/forms-light.png` | 1280 × 791 | 29,685 | `15450ff7b8d5904d6c801acc6d7f2e33e267dcdc8ea2e101f9a18ffc65b3b3cd` |
| A `apps/www/public/examples/forms-dark.png` | 1280 × 791 | 32,876 | `0d14e9efd21c2901dd2b54922b543988448b33486c5dc80a9e350a347a209165` |
| B `docs/assets/settings-1440-light.png` | 1440 × 1147 | 207,682 | `c9220b86e1eacc1681bc16b6f3ac0bd659895285dff0b9b2dc48a662d328a2ea` |
| B `docs/assets/settings-390-dark.png` | 1024 × 5562 | 473,600 | `76ff937fdc17591a97bcb8c8a59d5a8f73cae61302f4ae135e0a51cce64470cd` |

B 手機圖檔名有 390，但原檔並非 390 像素寬；來源為 Chromium 手機模擬，沒有從圖片推斷 DPR 或真機狀態。

## 已驗收與保留範圍

- 本輪對 24 份同版證據重算 Git blob、長度與 SHA-256；比較頁的四張內嵌圖與來源 bytes 相同。
- 第 11 組比較已加至私人目錄。原有十組、25 個舊入口和一個歷史單案的連結保留；沒有逐頁重新驗收過去全部頁面。
- Chromium 已測目錄往返、桌面並排、單看、同頁深色附圖、來源與授權開合、手機參考及原尺寸切換。在 390 CSS px 框內，可用正文寬 375 px；將 B 還原到 1024 px 原尺寸時，橫向捲動只在圖片容器內。A 維持「無獨立手機原圖」提示。
- 未操作來源站、提交表單或改變設定；未驗真機、Safari 或完整無障礙。私人單頁 SHA-256：`dcd795978baf37ff60c58dd52556933c953c67d571f4867d62b732c19a1ca067`；私人增量包 SHA-256：`a799b5e5ef9b65c29023a6b57013b2631782e6111053b3873035cc3119a41c77`。這兩個指紋只供核對，不是預覽或下載連結。
