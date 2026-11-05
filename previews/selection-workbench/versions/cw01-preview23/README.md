# 育伴港選配工作台 · preview23

建置截至 2026-11-05 17:56 UTC。獨立合成前端，只加入已覆核的 CD01-fix01 文字草稿；不是正式產品驗收。舊卡片與清冊保留各自建置時說明，後續驗收以精確版本的日期補充另記，不回寫本截點。

## 本次選配

- 25 個候選、24 個有候選模組；88 邊界、16 組和285個去重角色來源路徑不變。A 訊號艙／B 稿件台有不同 DOM 與操作資訊順序，只在 composer 計一次，不是25套全站。PC01／AP01未納入。
- 245 個公開檔：保留 preview22 全部240路徑，僅改五個 metadata／說明檔，235個舊檔逐bytes不變；新增5個 exact CD01-fix01 runtime，共36,879 bytes。lab.js、既有候選、五版、選擇及 undo 不變。
- 搜尋 CD01 或開啟 composer-draft/index.html；B 可直入 composer-draft/index.html?direction=B。五檔保持原相對資產與品牌 ../index.html 契約，在 root 或完整 nested mount 都回到所屬工作台。
- 只留本頁記憶體，刷新清空。文字草稿、原操作保存與回覆是三個獨立階段；回呼 void／resolve 不充當保存收據。unknown 先查原ID與原文，明確解鎖才沿原ID重試；上一則收據不屬本稿。scope、身份、撤權與晚結果沿原界線。
- 正式 ChatController／ProductionProvider 未接，沒有新正式 owner、服務、模型、儲存或真家庭資料。ChatTimeline、CI／MR、voice／照片／檔案不是本候選；CM-F01未修。

## 來源與適用界線

104 個 exact URL：沿原100個逐項去重，新增4個，復用0個。CD01採用的4個家族為 Discourse論壇、assistant-ui成熟GitHub文件、公開frontend-design Skill節錄及NN/g。家族／渠道／URL／方向不是同一分母。

沿原封包已讀文字，這次沒有重新抓取。論壇只讀問題與可見回覆，沒有看圖片或連結修復；assistant-ui只讀thread/composer組裝片段與相鄰概覽，未安裝或執行；Skill只讀公開摘要與可見節錄，Show more未開，不稱讀完全檔；NN/g只讀摘要與指定段落，未看影片。各URL保留實讀深度、適用理由和不採用範圍。未做獨立授權頁查閱，不把方法參考當素材授權；沒有複製第三方程式、美術、字型、標誌或Skill文字。

保留既有 SL01 的100URL基線：其七URL／五家族中 Carbon 文件、GitHub及license同一家族；Paperless官方頁原403未讀正文，論壇不替代官方頁；外部main未pin commit。

## 已驗與未驗

CD01-fix01已獨立覆核及有界原生檢查，沒有該範圍產品blocker。真離頁／Back／Forward觀察可編輯、保留草稿及原操作，並不證明 BFCache 命中：persisted事件未證實。窄B編輯區在下方，介紹仍說「右側」，這個非阻擋文案NIT保留原bytes。修復的是pagehide persisted不無條件destroy與舊focus意圖退役模型，不是新增跨刷新保存。

原CD證據分層保留：38項候選模型／靜態、13項來源正控＋1項guard負控；fix01有其7生命期＋7延續模型，獨立覆核與原生亦各有有界範圍。本次不重播、不把不同層或重跑相加，不把負控算功能PASS。

preview23 gallery入口／返回／新卡片／來源與footer幾何／真Back與Forward於建置時均 NOT_RUN。preview22原生於此截點 PENDING；其獨立source review已過，不替代native。之後的dated companion不能讓本快照自動升級。

沿用限制：preview21原長session code9報告仍 INCOMPLETE；短窗完成缺少的footer樣本且未重現，但原因未知，不能排除長session原因。same-document hash Back 的anchor至BODY焦點限制未解。SL01指定七個原焦點失敗路徑已定向原生重驗，非全lease／width／競態；初始未選詳讀區空白仍保留。SL正文取得／提取完成不等於人工核實可信，分頁只切已載資料；其編輯、確認、上傳、分享、刪除和正式owner仍未接。既有AI01等限制不升級。

原生IME／軟鍵盤、AT／讀屏、真手機／觸控、完整縮放／reduced-motion矩陣、BFCache命中、完整React／ProductionOwner與服務均未驗；不是完整WCAG結論。正式72／正式48 NOT_RUN，semantic88 PENDING。

## 固定來源與 HTTP

全域清冊仍固定 e8918dd 基線，不稱最新。CD原研究用固定346abb72d0968d7a4536d06c85032d3f53a0f0b2、tree d3efea86974c772a0e2e61622228ea788c9d6f6b，與180c8c16f193fbc3647038532fca437d83d1b76a同tree。CD於2026-11-05約16:25 UTC另觀察master 2abe7aed60b192b253414f6464e3fd070cc377e7；必要來源交集只有ProductionProvider變更，原研究讀回完整檔及diff，sendChat closure不變。本次未重查master，沒有把本地舊snapshot當最新checkout；SL原研究的固定來源說明仍沿前版。

根HTTP：在本公開目錄執行 python3 -m http.server 8000，開啟 http://127.0.0.1:8000/index.html。子路徑HTTP：把本目錄完整內容放於靜態根的workbench/，從該公開根提供HTTP，開啟 http://127.0.0.1:8000/workbench/index.html。所有內部入口與依賴保留相對路徑，不用file://。不可從含私人來源／證據的父目錄啟server。

GitHub顯示HTML不等於部署。本版未發布、未合併；本次組裝沒有啟server或browser。
