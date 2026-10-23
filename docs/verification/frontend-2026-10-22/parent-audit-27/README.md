# 育伴港家長視角全站審查與窄範圍修復

**全站審查已完成代表態覆蓋；snapshot27a 的6組增量重驗通過，已修復關注頁按鈕主次紅項。** 已發布至 Site86，發布後5組窄範圍確認通過；本包保留各階段與未驗邊界，沒有宣稱整站全功能通過。

原有 snapshot26d／Site85 交付已完成；這次新增全站審查與 snapshot27／27a 不把舊版重新標為未完成。唯一 [PR #253](https://github.com/2NTTY/child-ai-caregiver/pull/253) 與既有 [公開合成預覽](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site) 沿用；本文件只整理交付，不額外修改產品。

## 結論

- 17 個家長 route 各看過 1024／390 代表畫面，另抽查 320；不是全部功能、子狀態、裝置或無障礙完整通過。
- 主要摩擦是內容被控制及維護說明壓後、助手與手動入口不一致、手機目前位置不清楚。沿用既有設計系統，不把每頁強改成同一張卡。
- Source 原 15 項、visual 原 12 組有重疊，保留原 ID 對照，**不相加成 27 個問題，不製造整站分數**。

## 這次修改與驗證

五項為：概況保留 taskId、負責人安全替代文字、關注／準備助手入口、歷史工具列與日期 modal、通知／模型等設定層級。**snapshot27a 最終本地範圍**為10個產品檔＋13個測試檔，共23檔；建置後六組限定回歸重新通過136/136，65原始產物／72候選檔。PR #253 仍 open draft、未合併；CI 沒有可用執行結果，不能稱為綠燈。前一輪31個增量檢查重複包含其中，不另相加。`tsc` 仍有既有 Contact 兩錯，並非全綠。

概況姓名仍缺權威契約，「見原安排」只是 safe fallback。V01 只處理 history/settings 部分，**sources 未改**。其餘手機定位、較早未處理待辦、guide、family、概況日期及低優先文案仍待處理。相機 V04 已補核正常捲動可完整閱讀，保留指定外形，屬 P3 取捨而非阻斷。

## 原紅項與27a重驗

snapshot27 的關注頁，助手次級按鈕與較大的手動入口同為描邊，320 寬時較長手動標籤使操作列佔兩排，仍壓後正文，未達助手主要／手動次級的要求。snapshot27a 已把助手改為緊湊主要樣式、手動入口縮為「手動」，保留完整表單標題及無障礙名稱；320／390／1024及共用dialog6組增量重驗通過。27階段22組為19 PASS、1 RED、2未實屏；原RED保留並由27a增量關閉，其他通過項按各自未改範圍承接，兩項未實屏不抹掉。模型頁目前是合成讀取失敗態，key、endpoint、額度及保存邊界只有 source／DOM 證據，不稱實屏通過。

## 閱讀入口

- [逐頁目的 問題 影響 優先級與證據](page-audit.md)
- [原始問題 ID 與處理映射](findings-and-status.md)
- [精確修改與測試清單](changes-and-tests.md)
- [Snapshot27 有界瀏覽器結果與紅項原圖](snapshot27-browser-stage.md)
- [Snapshot27a 增量重驗與修後原圖](snapshot27a-browser-stage.md)
- [Site86 發布後窄範圍確認與線上原圖](site86-live-smoke.md)
- [可機讀證據索引與 SHA-256](evidence-index.json)
- [交付檔案完整性清單](package-manifest.json)

## 六張基線原圖

全部是 **Site85／snapshot26d，非 snapshot27 修後圖**。原生 1364×1024 桌面截圖含瀏覽器及 QA 外框；內嵌應用尺寸見表。只逐 byte 複製並用正確 `.jpg` 副檔名，不裁切、拼接、生成或轉碼。部分最底約 8 px 不完全可見，不宣稱 full-page。游標光暈不是產品陰影。

| 圖片 | CSS viewport | 證明與限制 |
|---|---|---|
| [E029 home-camera-reading-390](screenshots/baseline/029-home-camera-reading-390.jpg) | 390x600 | 相機在部分捲動位置重疊正文；補核證實正常捲動可完整閱讀，屬 V04 P3。 |
| [E062 history-controls-390](screenshots/baseline/062-history-controls-390.jpg) | 390x600 | 歷史首屏被分類及搜尋／日期控制佔用，V01／V02。 |
| [E038 growth-actions-1024](screenshots/baseline/038-growth-actions-1024.jpg) | 1024x600 | 有關注內容時近旁先是手動入口，V06／IA-03。 |
| [E011 notification-settings-390](screenshots/baseline/011-notification-settings-390.jpg) | 390x600 | 通知設定先出版本及重讀控制，V01。 |
| [E085 sources-scope-390](screenshots/baseline/085-sources-scope-390.jpg) | 390x600 | 來源的範圍／流程說明先於內容，V01／IA-14。 |
| [E065 bell-content-390](screenshots/baseline/065-bell-content-390.jpg) | 390x600 | 正向例子：讀真正保存正文，歷史與關閉入口固定可達。 |

相機補核 E110／E111／E112 的原圖雜湊在索引；六張精選不取代完整 113 張原圖紀錄。索引明確標示哪些原圖未隨本包附上。snapshot27 已另附四張候選原圖，包含主次 RED 證據，置於 `screenshots/snapshot27/`；不覆蓋 baseline，也不作27a修後圖。

## 剩餘接口與環境限制

只用合成資料；未驗正式 API、真模型、通知投遞、真照片、真家庭寫入或權限變更。新增兩項合成預約只是任務定位驗收資料，不是對外預約能力。雲端 Chrome 的 CSS viewport 不等於原生 Android／iOS；完整鍵盤順序、螢幕閱讀器及全部錯誤分支未覆蓋；上述原階段也未覆蓋自選高對比背景，後續獨立補驗見下節。Source／DOM／畫面／實際操作與正式服務能力分開裁定。

發布已由官方版本／部署讀回確認；直接HTTP取得bundle回403後停止，fixture未取得，故不聲稱遠端HTTP字節雜湊已核對。此限制與已通過的5組瀏覽器smoke分開。

## 自選背景獨立補驗

2026-10-22 23:36 UTC 的獨立補驗以1張合成高對比PNG，完成首頁、聊天、歷史、設定、概況各1024×600／390×600，共10組代表畫面；原UI保存、切頁保留、恢復預設及重載確認通過。**另保留聊天浮鈕P3取捨與Chrome code9根因未明，不是全站或瀏覽器穩定性PASS。** 此階段沒有修改產品或Site86，不追認先前未涵蓋項。

新增Web picker本地契約測試為**1 test／4段觀察通過**；交付相對import的可移植性覆跑不另加案例，也不併入原136項。詳見[背景補驗報告與7張原圖](background-followup/report.md)及[索引](background-followup/evidence-index.json)。其餘原圖／DOM／AX只封存hash與本地原件，並非全部公開附上。
