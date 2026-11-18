# 工作台第 18 版：孩子照顧概況

本提交僅增加一份自行撰寫的來源與驗收索引。**不能只靠這個 GitHub 備份還原完整預覽。** 獨立分支承接既有倉庫基底；此提交未加入執行載體、圖片、字型、示例記錄、預覽 HTML 或私人存取資訊。完整比較檔與這一版的還原增量另在私人備份保存。

## 比較哪兩頁？

兩款是在同一 Baby Buddy 生態由不同作者實作的照顧概況，不是兩套獨立後端。此處比較資訊安排，不比較孩子資料、臨床數值或育伴港的存取規則。

| 方案 | 精確來源 | 版面及範圍 |
|---|---|---|
| A：Baby Buddy 的孩子 Dashboard（C-03） | [原版孩子 Dashboard 模板](https://github.com/babybuddy/babybuddy/blob/f02f28b7f96f8bb1b9a0212a377c327ce33e7699/dashboard/templates/dashboard/child.html)，`babybuddy/babybuddy@f02f28b7f96f8bb1b9a0212a377c327ce33e7699`，v0.1.0 | 九張照顧卡分組呈現餵食、睡眠、計時、趴臥與換片；不是顯示姓名、生日或操作按鈕的 Child Detail。原模板使用固定合成資料，未採用資料來源未明的舊原圖。 |
| B：Baby Buddy Dashboard add-on 的預設 Overview | [原版 Overview](https://github.com/mbentancour/baby-buddy-dashboard/blob/5e78a332a2857eea9be6fa956858f2b4da49ca36/baby-buddy-dashboard/frontend/src/tabs/OverviewTab.jsx) · [原版入口](https://github.com/mbentancour/baby-buddy-dashboard/blob/5e78a332a2857eea9be6fa956858f2b4da49ca36/baby-buddy-dashboard/frontend/src/App.jsx)，`mbentancour/baby-buddy-dashboard@5e78a332a2857eea9be6fa956858f2b4da49ca36`，add-on 1.0.9／frontend 1.0.0 | 四個摘要、四個近期照顧區與三張七日圖。保留原本摺疊的清單；不是 Growth，也沒有進入新增、計時或刷新。 |

兩者皆是**原版介面搭配合成資料的實際擷取，不是作者原圖**，亦未運行上游正式服務。A 的根授權為 BSD-2-Clause，B 為 MIT；字型、圖示及其他相依有各自通知。這份文字索引不代表已取得所有素材公開分發權。

## 四張擷取的指紋（不含圖片）

| 來源 | 加高視窗（CSS px） | PNG SHA-256 |
|---|---:|---|
| A 桌面 | 1140 × 930 | `0ee147c2d570c2e5c5be3afdcba6555e81abfaa73a04969d196b90e2244db214` |
| A 窄窗 | 390 × 2165 | `8f9d0f5578ba9ad5058360fa2ca3f7f0d265911dd05507eef748bf582c45d8d4` |
| B 桌面 | 1140 × 1110 | `5cee9e85353d2f53c09750e05d493bdea5e240eaa4020518b32b7290809773b2` |
| B 窄窗 | 390 × 2226 | `bd8cc7a18596f4cbfd14a75ef6fd668984778f619272c92d64cc92e5bad108c0` |

每張圖都來自一次完整擷取，只去掉測試視窗外的空白，沒有拼接或補畫。A 的九卡均在視窗邊界內、位於固定導覽下方；B 的預設四個摘要、四個區塊與三張已穩定的圖表均已核對，末行可見。加高窄窗的浮動計時器未蓋住末行文字或圖表，不代表所有捲動位置皆無遮擋。

## 已檢查與未檢查

- 兩套輸入的 24 與 43 個檔案已對獨立保留清單核對長度與 SHA-256；在各自隔離的本機靜態載體擷取。入口禁止連接及表單送出，未做逐請求網路審計。
- 新增第十個比較入口；第 17 版原九組、25 個原入口及一個歷史家庭單案保留。驗證桌面及 390px 窄窗的並看、單看、畫面切換、原尺寸及返回目錄；沒有逐頁重新驗收其他舊入口。
- 窄窗是 Chromium 的受控視窗，不是實機或 Safari。未驗完整無障礙、真帳戶、後端操作、醫療準確性，也不表示已選用或實作產品功能。
