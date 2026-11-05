# 育伴港選配工作台 · preview21

建置截至 2026-11-05 16:23 UTC。本版是合成資料的獨立前端候選，不是正式產品驗收。固定建置結果不回寫；後續 gallery 驗收須用綁定本版精確 manifest 的日期說明補充。

## 範圍與 HTTP 啟動

- 233 個公開檔：保留 preview20 原222檔，僅五個 metadata／說明檔改動、217檔逐bytes保留；新增 MR01 六檔36,975 bytes與 CI01 五檔28,078 bytes，全部 runtime 原樣複製。
- 23個候選分屬22個有候選模組；88盤點邊界、16組與285個去重角色來源路徑不變。MR01 的A三室索引館／B核對案卷只在memory計一次；CI01 的A正文旁註／B來源分類卷宗只在citations計一次。SL01／CD01未納入，既有五版與選擇保留。
- 94個 exact 研究URL：既有88個保留、新增六個，NN/g及W3C既有URL復用。所採MR／CI方法共七個研究家族，其中多個家族已在工作台登記；兩個Obsidian URL同一家族，Adobe／Radix文檔與repo亦不另算方向。僅公開適用研究摘要，未搬用圖片、字型或第三方程式。
- 從index.html開始，搜尋MR01／CI01，或開啟modules/memory-reading/index.html與modules/citation-reading/index.html。
- 根HTTP：在本公開目錄執行 python3 -m http.server 8000，開啟 http://127.0.0.1:8000/index.html。子路徑HTTP：把本目錄完整內容放在公開靜態根的workbench/，從公開根提供HTTP，開啟 http://127.0.0.1:8000/workbench/index.html。全部依賴與內部入口均相對路徑，不用file://。
- 不可從私有研究／來源／測試／證據的父目錄啟動server；本次組裝未啟動server。

## 已存在的 standalone 結果與本版未驗範圍

建置截至 2026-11-05 16:23 UTC：MR01 是同一合成 host 的 A 三室索引館／B 核對案卷，只在 memory 計一個候選。facts、private context、reference 保留不同資料邊界；準備內容只產生本地合成草稿並保留原稿，不接模型、正式 owner 或真家庭資料。獨立來源覆核及先前主段有界 browser 已完成；最終選中 hover 修訂有八種原生 hover 與兩個鍵盤焦點樣本通過，舊漏檢圖及錯誤 history oracle 記錄保留，不倒推舊版已過。窄屏 hover 未成立；native IME、AT、BFCache 命中及完整競態未驗。preview21 gallery 原生入口／回返／卡片幾何在此建置時點為 NOT_RUN，後續以精確版本的日期補充為準。

建置截至 2026-11-05 16:23 UTC：CI01 是同一合成 host 的 A 正文旁註／B 來源分類卷宗，只在 citations 計一個候選。引用存在不等於內容真實、醫療證據或真來源可達。複製與外開保持未接且 disabled，example.invalid 僅作格式示例，不外開。獨立來源覆核與兩段有界 browser 已完成；scope／message／status、返回同一標記、代表性的 retired／same-frame／新 scope 焦點及真 Back／Forward 已觀察。close 時新選取、composition Escape、完整矩陣、AT 與 native IME 未驗；1440 僅分段 CSS iframe，不是真 1440 頂層視口。preview21 gallery 原生入口／回返／卡片幾何在此建置時點為 NOT_RUN，正式 owner／adapter 未接。

preview20 的指定 GR01 工作台入口／返回及新 footer 幾何，依 2026-11-05 15:23 UTC 日期補充已按原 manifest c38e1cf7990b602a9e109a16b72d842c436315a81a7427c93ea41b8a9505b0c9 有界通過。本版僅校準新metadata中的歷史文字，不改原preview20或GR runtime；該結果不會自動適用於新卡片、變更文字或preview21 gallery。本版 gallery 原生檢查於建置時為 NOT_RUN，獨立覆核待另行記錄。

## 不變的邊界

- 全域清冊仍固定e8918dd基線，候選研究固定f453226，最近已知master為PR #506合併時的2abe7aed60b192b253414f6464e3fd070cc377e7；本次未重新觀察最新master，三者不可混稱。正式client修復與合成候選驗收分開。
- 正式72／正式48 NOT_RUN；semantic88 PENDING。既有AI01背景焦點及其他候選原限制不升級；沒有重跑全部候選或正式產品測試。
- same-document hash Back 的連結至 BODY 焦點限制仍未解。真跨頁返回有界觀察不等於 BFCache 命中，也不承諾內部閱讀狀態持久化。
- native IME、AT、真手機、觸控／手勢、完整競態及完整WCAG未驗；CSS iframe不等於同寬頂層視口。MR窄屏hover未成立，CI1440只有分段iframe。
- 沒有接入真家庭資料、照片、訊息、正式owner、API、模型、writer或帳戶／網站權限。MR準備內容僅本地合成草稿；CI複製／外開disabled、example.invalid不外開。

GitHub顯示HTML不等於部署。本版僅本地封存，沒有外部發布或合併master。
