# 選配工作台 preview23 · 實驗來源歸檔

**實驗來源歸檔，整合原生驗收未完成，尚不作部署完成版。** 截至 2026-11-05 18:58 UTC，來源整合已獨立覆核，但 preview23 工作台原生驗收仍為 **INCOMPLETE**。根頁曾成功呈現，CD01 搜尋顯示 1／88；其後群組鍵盤操作與 AX 觀察批次逾時，唯一事後原生視窗圖顯示 Chromium **錯誤代碼 9**，可按相同 `/#modules` URL 關聯到當次檢查頁。原因未知，不能判定 OOM、歸為純工具問題、宣稱已排除產品缺陷或已修復。

本補充記錄比應用建置時間更晚的結果，不改寫應用中的舊截點文字，也不把單獨候選的通過結果轉成整合通過。

## 版本內容與來源界線

- 保留精確的 **245 個應用檔／18,287,662 bytes**，另加本說明與 RELEASE-MANIFEST.json 兩檔，公開版本共247檔。應用清單、逐檔大小及 SHA-256 完整列於 [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json)；原應用 manifest SHA-256 為 `319929fa2f2729ac5c293115a874e009af8d477ed1d66576077b267ca944e0ef`。
- **25個候選／24個有候選模組／88個盤點邊界／16組**。具有A／B方向的候選仍只計一項，不是25套全站，也不是88個已完成模組。
- 相對preview21，只接入 SL01-fix01七個 runtime 檔及 CD01-fix01五個 runtime 檔，並更新必要清冊與說明；本補充不再改任何應用bytes。相對preview22，235個檔案逐bytes相同，五個清冊／說明檔更新，新增五個CD檔。原版、Harbour、Care、Handbook、第四方案及既有選擇／undo保留，本輪沒有重驗所有舊候選。
- SL01是來源物件的唯讀合成探索，CD01是記憶體文字草稿與原操作演示。未加入PC、AP、TC、CP、CW候選；沒有正式owner、API、模型、持久儲存、上載或真家庭資料。
- 實際清冊有285個去重角色來源路徑，86項source-traced、2項not-applicable；88項semanticReview仍全數pending。已追溯來源不代表操作已接線或語意驗收完成。既有508份非測試前端來源分類、161份附屬對應待核及3個正式接線待確認入口，仍按原固定基線理解。

## 如何開啟與返回

從 [index.html](index.html) 進入工作台，搜尋SL01或CD01，或使用其候選卡片及清冊入口：

- [SL01來源資料庫](modules/source-library/index.html)：A來源書架／B處理檢視列，分開正文取得、提取、人工核對及授權狀態。初始未選詳讀區仍空白；分頁只切已載資料。用瀏覽器返回回到工作台，不承諾跨頁閱讀狀態持久化。
- [CD01文字草稿](composer-draft/index.html)：A訊號艙；[B稿件台](composer-draft/index.html?direction=B)可直接開啟。頁內品牌連結的 `../index.html` 指向**同一版本的工作台／候選總覽**，不是正式產品首頁或其他版本。CD必須保持在版本根下的composer-draft/，不能移到modules/composer-draft/。正文、保存收據及回覆是三個階段，unknown須先查原ID／原文再明確重試；刷新會清空本頁記憶體。
- 根HTTP與真正子路徑HTTP均須保留完整相對目錄。CD品牌返回路徑已做來源／URL模型覆核，但本輪沒有完成原生進入與返回驗收。SL／CD先前各自有界standalone原生結果只適用原範圍。

## 這次驗收到哪裏

來源整合的獨立結論為 **ACCEPT_FOR_NATIVE_DELTA**：清冊單次註冊、245檔allowlist、原樣runtime、root／nested資源模型與A／B執行接線、104筆研究資料已在其有界範圍覆核。這是來源／模型證據，不是瀏覽器布局、真正nested部署或完整產品驗收；各階段測試及負控不相加成總通過數。

preview23原生只觀察到根頁畫面、導航至模組區，以及CD01搜尋後1／88與正確卡片文字。唯讀DOM另見25張featured卡片，但新卡片未視覺驗收或啟動。下一次群組鍵盤操作及AX批次返回 `DOMSnapshot.captureSnapshot timed out`，無法確認批次內哪一步失敗或最後選取值。事後唯一原生圖顯示code9，畫面本身不帶頁面識別碼；當時清單中只有一個相同 `/#modules` URL，據此關聯。此證據沒有定位根因。

**本輪NOT_RUN：**群組結果確認及ready／mapped／Clear、新卡片啟動、CD根入口／品牌返回／A-B內容、真正Back／Forward、真正nested瀏覽器入口與返回、320／390新卡片及來源／頁尾視覺樣本、四條新來源href的原生檢查。沒有整合native PASS或已完成產品案例分母。當次只提供受影響的20檔closure各一份於根與nested，並非完整245檔網站的端到端測試。

歷史結果也保持各自範圍：

- preview21較長場次code9仍未解；短場次補足指定頁尾並未重現，不能排除原問題。
- preview22後續補驗已見root mapped／Clear、真正nested的SL A／B閱讀與Back、七條來源的DOM文字／href、390 CSS iframe新卡片及焦點樣本。390長清冊只有DOM／部分畫面，來源與頁尾仍缺完整視覺檢查；隨後截圖逾時，該次事後原生圖未見code9。
- preview22另一次有界診斷見320 CSS iframe新卡片文字／入口焦點及長清冊部分畫面，隨後再次截圖逾時；事後原生圖確有code9，但選中地址為about:blank，與被測頁對應不明。這不等同preview23按URL可關聯的code9，也不能證明兩者同因。320／390完整清冊、來源與當期頁尾仍未補齊；CSS iframe不等於頂層窄視口或真手機。

## 保留的限制與研究深度

same-document hash Back曾使焦點從連結移到BODY，仍未修復。SL初始詳讀空白及未完成的lease／寬度／競態矩陣保留。CD窄B編輯區在下方但文案仍說「右側」，原非阻擋文案問題未改。真離頁／Back／Forward可用不證明BFCache命中。CM-F01未修；正式72／正式48 NOT_RUN，semantic88 PENDING。原生IME／組字、AT／讀屏、真手機、觸控／手勢、軟鍵盤、完整WCAG、縮放／reduced-motion、正式React／owner／服務仍未完成驗收。

104個exact研究URL是參考筆數，不是設計方向、獨立研究家族或通過數。preview21的94筆先由SL新增6筆成100，再由CD新增4筆成104。SL相關七URL屬五家族，Carbon文件／repo／license算同一家族；原Paperless官方頁403未讀正文、外部main未pin commit等限制保留。CD四筆保留原readDepth：Discourse只讀文字未看圖片／連結修復；assistant-ui只讀組裝片段未執行；公開Skill僅摘要與可見節錄，Show more未開；NN/g未看影片。此次沒有重訪外部設計研究來源；只另核對下述GitHub來源身份，沒有把方法參考當作第三方資產授權；新增SL／CD未搬用第三方程式、圖片、字型、標誌或文章。

全域清冊固定於[e8918dd](https://github.com/2NTTY/child-ai-caregiver/tree/e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92)；CD來源研究的本地HEAD為 `346abb72d0968d7a4536d06c85032d3f53a0f0b2`，不是已核實可連結的遠端commit；公開來源改連同tree的[180c8c16](https://github.com/2NTTY/child-ai-caregiver/tree/180c8c16f193fbc3647038532fca437d83d1b76a)。2026-11-05 19:12 UTC的GitHub唯讀核對確認該遠端commit存在，tree為 `d3efea86974c772a0e2e61622228ea788c9d6f6b`，與原本地來源清單一致；同tree不等於同commit。原研究曾核對[2abe7ae](https://github.com/2NTTY/child-ai-caregiver/commit/2abe7aed60b192b253414f6464e3fd070cc377e7)的相關差異，此補充沒有重新查master，三者不可混稱最新來源。

應用內NOT_RUN／PENDING保留 **2026-11-05 17:56 UTC** 建置快照；本文件只補充其後來源覆核與未完成的原生嘗試，不改UI、舊版本或原報告。

## GitHub來源檔不等於執行網站

本文件產生時preview23尚未上傳，不含遠端commit確認、Site改版或master合併聲明。目標是既有分支codex/selection-workbench-20261105的新版本目錄。下列是**該目錄實際完成分支歸檔後**的完整啟動方式；只看到GitHub的HTML原始碼不是網站已運行。

```sh
git clone --branch codex/selection-workbench-20261105 --single-branch https://github.com/2NTTY/child-ai-caregiver.git
cd child-ai-caregiver
python3 -m http.server 8000 --directory previews/selection-workbench/versions/preview23
```

根入口：`http://127.0.0.1:8000/index.html`。也可進入完整版本目錄，執行 `python3 -m http.server 8000`。不要只下載index.html，不用file://雙擊。

要以真子路徑開啟，停止上一個server後，在clone根目錄執行：

```sh
python3 -m http.server 8000 --directory previews/selection-workbench
```

子路徑入口：`http://127.0.0.1:8000/versions/preview23/index.html`。CD品牌應回此版本入口；也可把完整247檔內容放進獨立公開靜態根的workbench/，啟HTTP後開 `http://127.0.0.1:8000/workbench/index.html`。這些是使用方法，不是新增原生驗收結果。只提供公開目錄，不從含私人來源或驗收證據的父目錄啟server；不會自動部署、改權限或合併master。
