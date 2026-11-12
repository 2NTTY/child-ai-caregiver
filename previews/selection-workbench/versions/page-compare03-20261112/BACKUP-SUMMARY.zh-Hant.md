# 完整頁參考對比 03 · 精確來源備份與有界驗收補充

本獨立分支只保存 `page-compare03-20261112` 的 159 個原展示檔，加本補充、manifest 與 checksum。這是 GitHub 來源備份，不是 PR、合併、公開託管網站或設計採納。GitHub 檔案頁不是可使用的線上預覽；本地觀看需要適當靜態服務。

## 精確版本與新增範圍

- compare03 原封存 SHA256：`13f0e2514a78570b991620ee077a93405206cd1ae11910614b4f34c34f6cc7c3`。
- 159 個原展示檔／6,960,193 bytes；22 張原圖、19 組、2 個不同用途的原生完整頁單案。
- compare02 原有 132 檔完全不變，只有 index／catalog／README 三檔作最小說明增量，新增 CD01 的 24 個原展示檔，無刪除、無新圖。compare02 精確來源備份：`2a80cee9494a307eb8bb84cd9753b1671941e775`。
- 所有既有編號、單案、同類但非功能等效的參考組與未收錄界線保留；沒有新增同功能頁雙案，沒有混合、拼配、恢復控件或重做候選。

## CD01-01：原樣取回的 Child Detail 單案

來源備份 `dfc1434b1e1aae2ea0cac814e1cc6329fccffca6`，原版本 `babybuddy-child-detail-cd01-20261112`。固定上游 Baby Buddy 0.1.0：`f02f28b7f96f8bb1b9a0212a377c327ce33e7699`，原模板 `core/templates/core/child_detail.html`。工作台編號 CD01-01 對應原 manifest 的 CD-01 草稿識別，原 manifest 不改。

入口 `candidates/CD01/child-detail.html`；原 `index.html` 為相同 bytes 副本。HTML SHA256：`11c4357acaef427c590ccc63c2a33682b7ed1ef01a8a7f8f390759b4af7c59a0`。完整 24 檔／1,476,128 bytes 與原公開 Git blob、原 checksum 及既有 browser freeze 全部相符，未重新渲染或執行原 app。

原頁展示姓名、出生日期、年齡、導覽、四個動作圖示與 Reports 五項。它不是 C-03 九卡 Dashboard、照顧時間線或新增健康檔案功能。First Last／first-last／同日出生規則來自同版 `ChildTestCase.test_child_create`；固定 2017-10-28 UTC 午夜、caregiver、空 timers 及展示權限是已揭露合成適配，不是真家庭資料、帳戶或權限。沒有照片或個資來源未確定的 C-03 歷史截圖。

Baby Buddy BSD-2-Clause 全文、七份本地 notices、Bootstrap／jQuery／Popper MIT、Font Awesome 字體 OFL／style MIT／原文件 CC BY 3.0 分類與全文保留。歷史依賴只供來源參考，未做全面供應鏈漏洞或權利認證，不推薦作生產依賴。既有 Django／LibSass 渲染與原歷史工具鏈不同，不宣稱歷史原畫面像素一致。

原來源靜態獨審檔是後製結果摘要，不是當時獨立封存的原始 reviewer artifact。本次恢復綁定原檔及有界 QA，不把後製摘要冒充重新完整審查；compare03 的獨立唯讀複核及 14/14 聚焦靜態檢查另已完成。

## 2026-11-12 後續 CD01 限定桌面驗收

後續 QA 版本 SHA256：`ae223e6466cf2854114f29bb59943a128736ae32f9640a729e236b6dd085b393`。私有 QA 原始內容不隨本來源備份公開。QA 使用上述同一精確 compare03；全部 159 展示檔及原候選保持不變。

1180×757 桌面視窗，僅以下新增路徑 PASS：
1. CD01 目錄定位、編號、來源／用途／授權／合成資料與限制說明，以及同分頁原生入口。
2. 完整短頁顯示 First Last、Born Oct. 28, 2017、Age 0 minutes、原導覽及圖示，未見此尺寸的橫向或垂直裁切；字型 loaded／FontAwesome check 為 true，並非完整字型網路追蹤。
3. 一次普通 Reports 點擊顯示五項原標籤：Diaper Change Types、Diaper Lifetimes、Sleep Pattern、Sleep Totals、Timeline；一次 Escape 關閉並保留選單焦點，沒有啟動報表目的地。
4. 一次普通 Home 點擊後保持 Child Detail 原 URL 與合成內容；一次瀏覽器 Back 回原索引入口，入口獲焦且來源說明保持展開。

沒有 fullPage 捕捉或重跑全站。compare02 未變部分及 fix01 共用頁面僅沿用原有範圍的證據，不擴張成 compare03 全面驗收。Edit／Delete 鍵盤、其餘路由、輔助點擊／新分頁、手機／收合、其他選單、完整焦點順序／讀屏／對比與跨瀏覽器未驗。原 `Timer actions` 錯誤群組標籤與無名稱圖示控制保留，不能宣稱完整無障礙通過。

## 執行與資料界線

索引保留原嚴格 CSP 與外部 CSS，原檔無 script／form／iframe。CD01 與 C-03 各開自己的完整原文件、原 CSP 及四支本地 jQuery／Popper／Bootstrap／readonly 腳本，不是整包無腳本、iframe 隔離或新 sandbox。

CD01 原 32 個跨頁路由 anchors 均無 href、帶 aria-disabled；既有 adapter 包含 click／Enter／Space 攔截，本次 browser 只驗證單次 Home 普通 click，不能升格成全部互動已驗。沒有真正編輯／刪除、模型／後端、上傳或外部服務操作。

預覽 DOM 另出現 runtime inline script。觀察到文字存在不證明執行、WebSocket 成功或 CSP enforcement；未收集 HTTP headers、network／WS trace、完整 server logs 或乾淨 profile 證據。同源不是隔離，也沒有測量零外送。有限 console 抽樣的擴充 metadata 錯誤不證明沒有其他錯誤。

## 原封存狀態與未收錄

159 個原展示檔逐 byte 保留，包括原作者期未發布／未 browser／GitHub 只讀／待驗 metadata。本補充只更新上述後續限定驗收與本分支來源備份的事實；不能把原封存時狀態當作目前最新結論，亦不能把來源備份誤認成網站發布授權或全產品通過。

LG02 完全排除。其他僅私有候選沒有載荷或不可用本地入口；H02／PC02 權利 hold、H03 缺原圖不變。CL01 普通 viewport 月切通過，但 fullPage 後立即幾何異常根因未定，無延後樣本，不定性為已確認產品缺陷或完整視覺通過。

`BACKUP-MANIFEST.json` 列全部 159 個原展示檔的 SHA256、Git blob 與 bytes；`BACKUP-CHECKSUMS.txt` 核對本來源備份除 checksum 自身外的 161 檔。沒有私有 browser 截圖／raw 觀察、工作區或 Library 識別碼、session／憑證、真實家庭資料、原研究封存、renderer、測試工具或快取。本次新備份不改原候選、舊分支、主分支、既有選擇或公開預覽站。
