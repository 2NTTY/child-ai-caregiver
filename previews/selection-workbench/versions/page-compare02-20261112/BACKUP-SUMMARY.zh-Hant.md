# 完整頁參考對比 02 · 精確來源備份與有界驗收補充

這個獨立分支只備份 page-compare02-20261112 的135個精確展示檔，加本補充、manifest和checksum；不是PR、合併或網站發布，也不更改既有選擇。開啟 `index.html` 需要適當的靜態服務；GitHub檔案頁是來源檢視，不是可使用的線上預覽。

## 版本與範圍

22張未修改原圖、18組、1個原生完整頁入口。原fix01的21原圖、5組同類非功能等效對照及6個不同用途／裝置單案保留；僅新增兩個不同用途的單案，沒有新增同功能頁雙案。

- SD01-01：OCR Consensus詳情審閱原始JPG，1440×900，來源`godtroop-github/ocr_consensus@4d834d3ef34072db89f84cb8f3d0fd4ec72a2a69`；候選`SD01-rebuild02-20261112`；來源備份`bf7e129d9474ed2dc76fe8179bf1e6160f485d28`。原圖SHA256 `b446524daec2b6f8cdb738625c2c90bcf396e3eb4f2272cd075c85270045da08`。一般OCR業務參考，不是育兒功能、可執行UI或完整長頁。capture build/time未知，虛構資料是發布者聲明而非獨立重建生成鏈。完整MIT與SOURCE-AND-RIGHTS逐byte保留，非全面權利認證。
- C-03-01：Baby Buddy0.1.0合成Dashboard九卡，來源`f02f28b7f96f8bb1b9a0212a377c327ce33e7699`、模板`dashboard/templates/dashboard/child.html`；候選`babybuddy-c03-20261111`；來源備份`59a16b8edf6c9d5d257b01885a6dd9860d73fd90`。完整24檔的獨立入口`candidates/C-03/dashboard.html`。不同於照顧列表及Child Detail；不混頁、不做圖片重建、不含個資來源未確定的歷史截圖。BSD-2-Clause、MIT vendors、Font Awesome字體OFL／style MIT／文件CC BY分類及全文保留。歷史依賴只供來源參考，不推薦作生產依賴。

## 2026-11-12 後續新增項有界桌面驗收

對上述精確compare02版本，以1180×757桌面視窗檢查，以下通過：
1. SD01-01目錄定位、編號／完整來源與限制文字；原JPG完整顯示及原尺寸入口；瀏覽器Back回到索引，圖片連結有焦點。原圖比例、上方演示標示與下方五項方法結果保留。
2. C-03-01來源／用途區分、同分頁原生Dashboard入口，九張卡片與下方內容可見，FontAwesome載入；一次普通Home停用連結點擊後留在原頁；一次Back回索引且原生入口有焦點。

這不是整個compare02全面重驗。既有fix01的原圖與共用CSS證據只沿用其原範圍，不擴張為手機或完整無障礙通過。新增測試沒有fullPage捕捉，沒有重跑選單／收合矩陣。片段導航焦點仍BODY；螢幕閱讀器、窄屏、完整鍵盤、跨瀏覽器未驗。

## 執行與隔離邊界

索引仍採原嚴格CSP，無來源script/form/iframe，外部style.css不改。C-03是獨立原文件，執行原有四個本地script（jQuery/Popper/Bootstrap/readonly），使用自己的原CSP；不是整包無腳本，也不是iframe隔離。

驗收使用共享來源，不是新的隔離context。原readonly只攔普通click；此次只驗Home一次普通點擊，未驗auxclick／context-menu／新分頁或全部27條停用路由；API Browser保留target=_blank且目標是本地fragment。未提供storage隔離、零網路外送或所有帳戶行為已封鎖的保證。

預覽DOM另出現一段inline live-reload文字，提到WebSocket；本輪只記錄存在，沒有證明其執行、成功連線、response-header CSP或確切注入來源。無網路／WS trace；不能由CSP、DOM或未點外連推論零外送。console有限抽樣的擴充metadata錯誤不能證明沒有其他日誌。

沒有使用真實家庭資料、真正模型、帳戶、上傳或外部服務操作。沒有發明育伴港功能或選定方案。

## 保留與未收錄

所有135個原展示檔保持byte-identical，包括原index/catalog/README及C-03作者期pending欄位。它們的「未驗browser／未備份／未上傳」是原封存時狀態，本補充只更新上述確切後續驗收與此分支備份狀態；不能把原檔當成本次新結論或把有界PASS擴張。

CD01尚未本地完整物化；其他私有候選只留狀態，沒有載荷或不可用本地入口。LG02完全排除；H02/PC02權利hold、H03缺原圖保留。S04/TL01有界桌面PASS不代表此版包含。CL01普通月份切換通過，但fullPage後立即幾何異常根因未定，未宣稱確認產品缺陷或完整視覺驗收。

`BACKUP-MANIFEST.json`列135個不變展示檔的SHA256、Git blob及byte數；`BACKUP-CHECKSUMS.txt`核本備份除該清單自身外所有137個檔案。沒有私有browser截圖／raw DOM／操作紀錄、工具輸出、工作區或Library識別碼、登入資料、credentials、研究封存或依賴快取。完整私有驗收證據另存，不上傳到此公開來源備份。
