# 完整頁參考對比 03

私有、未發布、未入選的新獨立索引，入口`index.html`。完整保留compare02的22張原圖、18組及C-03原生單案；本版只取回並加入已有CD01完整頁，現在共19組、2個不同用途的原生單案。沒有新增同功能頁雙案，沒有更改舊版、原候選、圖片、既有選擇或v109。

## CD01-01：既有Child Detail原樣取回

- 精確公開備份：`dot/workbench-babybuddy-child-detail-cd01-20261112`，commit`dfc1434b1e1aae2ea0cac814e1cc6329fccffca6`，tree`a6c4f6556c436a0d681e1ab8be0d773101920a56`。
- 固定上游Baby Buddy0.1.0：`f02f28b7f96f8bb1b9a0212a377c327ce33e7699`，模板`core/templates/core/child_detail.html`，不是C-03 Dashboard。
- 工作台單案編號CD01-01；原manifest的CD-01(draft)命名保持不變，沒有重做或重編原頁。
- 原完整24檔／1,476,128 bytes位於`candidates/CD01/`；入口`child-detail.html`，`index.html`是同bytes原副本。HTML SHA256：`11c4357acaef427c590ccc63c2a33682b7ed1ef01a8a7f8f390759b4af7c59a0`。
- 此次GitHub只讀，頁面／fixture／notices／原腳本／CSS均不改；取回檔案與公開Git blob、原23-entry checksum及既有browser24-file freeze全部匹配。未重新渲染、編譯或啟動原app。

原頁只有姓名、出生日期、年齡、原圖示動作與Reports五項；不是新健康檔案或可操作育伴港功能。First Last／同日出生規則來自固定上游測試；日期、caregiver、空timers及展示權限是明示合成fixture。沒有真家庭資料、照片、C-03歷史截圖或新資料來源。

Baby Buddy BSD-2-Clause、vendor MIT、Font Awesome字體OFL／style MIT／文件CC BY3分類及完整notices保留。歷史vendor只供來源參考，不是生產安全或全面權利認證。原Django/libsass適配與像素非等價限制保留。

## QA與執行界線

原作者期browser未驗／未發布metadata保持不變。其後既有有界桌面報告涵蓋1180×757完整頁、可見glyph、Reports pointer/Enter/Escape及部分停用入口普通點擊。來源靜態獨審記錄是後製結果摘要，不是當時另存的原始review artifact。

Edit／Delete鍵盤未驗、Edit locator曾逾時；source-native Timer actions錯誤標籤及無名稱圖示已知問題保留。完整font trace、手機／collapse／其他選單／完整焦點／讀屏／跨瀏覽器未驗。CSP／無href路由不是測量零外送或共用來源隔離證明。

本compare03沒有browser、renderer、原app、tsc/export或build。新入口／返回、相同宿主的執行與隔離仍待有界驗收。原compare02證據只屬它原本的範圍，不自動涵蓋此版。

索引仍使用compare02完全相同的嚴格CSP與外部CSS，無script/form/iframe；原22圖、窄屏堆疊及不裁切規則不變。C-03／CD01正常同分頁連結各開自己的原文件、原CSP與原本地腳本，不能稱整包無腳本。看完用瀏覽器返回，不新增回返功能或改原頁。

## 範圍

只有原135展示檔加CD01原24檔共159檔；原index/catalog/README作最小說明增量，其餘132檔逐byte保留。CD01 backup review圖片、renderer、tests、raw紀錄或來源研究不進展示載荷。LG02與其他私有候選不帶入，H02/PC02/H03與CL01既有界線不變。

這是私有本地來源參考，不擴公開資料範圍，不等於採納或發布。沒有GitHub寫入、PR、merge、force或Site更新。`catalog.json`列精確備份路徑與hash；只有`public/`是展示集合，外層私有核對證據不應公開。
