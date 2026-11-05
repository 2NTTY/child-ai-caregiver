# CW01 fix01 精簡選配入口 · 固定 preview23 清冊

這是一個獨立的工作台介面選項，讓同一份清冊以搜尋、分頁、逐項詳讀及最多四個公開方向 ID 暫存比較來瀏覽。**它不是新增候選模組，不是 preview24，也不是正式產品配置。** 原完整工作台、候選內容、歷史狀態及既有選擇邏輯保留。

## 開啟哪一頁

- [精簡選配入口](workbench-compact/index.html)：CW01 fix01。
- [原完整工作台](index.html)：原 preview23 根頁，逐 byte 保留，沒有改成 redirect。
- [原基線說明](README.md)：原版本的建置與歷史限制。
- [完整公開內容與狀態](RELEASE-MANIFEST.json)：250 個應用檔的大小與 SHA-256，以及這次補充的來源和驗收邊界。

頁內品牌／返回連結仍依各候選原本目的地導航，可能回原工作台；要回此精簡入口，使用瀏覽器「返回」。CD 品牌的 `../index.html` 是同一掛載版本的原工作台。不能把品牌連結的舊目的地當作精簡頁返回缺陷已修或假造 redirect。

## 精確組成與不同分母

保留原 preview23 **245 個公開應用檔／18,287,662 bytes**，加入 CW01 fix01 **5 個應用檔／40,599 bytes**，應用合計 **250 檔／18,328,261 bytes**。另加本文件及 RELEASE-MANIFEST.json 兩份公開說明，完整版本共 **252 檔**。完整公開集合的總大小和每檔身份另由發布準備清單覆核；manifest 不把自己的雜湊放進自己，以免循環。

清冊仍為 **25 個候選、24 個有候選模組、88 個盤點邊界、16 組及104 個研究網址**。A／B 方向不另算候選；CW 是另一種清冊工作台介面，沒有變成第26個候選或第25個有候選模組。沒有從 preview24 或其他後續包混入 PC／AP／TC／CP 等新內容。

原 preview23 的清冊、來源資料、runtime、美術及根頁不變。五個精簡入口檔中只有 fix01 的 app.js 相對原 CW01 增加64 bytes，用於拒絕來自不相符 URL scope 的歷史狀態；其餘四檔完全沿用原 CW01。既有 scope、schema、候選路徑及方向 query 均未換版。fix01 不是對歷史 code9 的修復。

## 比較與方向入口的含義

比較只暫存本頁的公開候選方向 ID，最多四項；重複方向不增加項目，第五項被拒絕。沒有寫入或套用正式配置。搜尋字只保留於本頁瀏覽歷史狀態，不加入公開 URL；請勿輸入家庭資料。這不保證刷新、不同版本、不同分頁或候選內部狀態的持久化。

只有以下已建立的方向深連結：

- [CD01 A 訊號艙](composer-draft/index.html)；[CD01 B 稿件台](composer-draft/index.html?direction=B)。CD 必須留在版本根下的 composer-draft/。
- [CH01 A 連續時間線](modules/chat-reading/index.html)；[CH01 B 日期原文索引](modules/chat-reading/index.html?ia=atlas)。

其餘23個候選保留原入口，不為它們虛構可用的 A／B query。精簡頁的選取、暫存比較與導覽不代表候選內部的送出、閱讀確認、結算、保存或 owner 操作已驗收。

## 來源與原生證據分開理解

fix01 已有獨立來源覆核：精確64-byte差異、scope 邊界正控與有效回滾負控、組合來源及歷史還原模型均在限定範圍接受。模型的 persisted pagehide/pageshow 不等於真正 BFCache 命中，JSDOM 不等於原生布局、鍵盤、AT 或輸入法驗收。歷史測試數字不相加成一個全產品通過分母。

其後 **2026-11-05 19:47–19:55 UTC** 的有界桌面原生場次，對精確 fix01 組合觀察到：

- 初始畫面與無障礙樹、CD01 搜尋／清除、每頁12項的前後分頁、群組與 ready 篩選、空結果與清除後焦點。
- 實際 Tab／Shift+Tab／Return／Space 的部分鍵盤與焦點樣本，無候選項目的詳情，來源 disclosure 的開合及 CD 完整原來源限制。
- CD A、CD B、CH A、CH B 四個不同方向的比較，重複項不新增，第五項明確拒絕，移除與清空後的焦點。
- 真正進入 CD A／B、CH A／B 並看到各自內容；真正 Back／Forward 返回精簡頁，保留搜尋、選中模組與四項 ID。這不證明 BFCache 命中或候選內狀態持久化。
- 104筆研究目錄的分頁與搜尋、版本資訊、真正兩段 nested 掛載下的 CD B 入口及 Back，以及普通公開 URL 的異 scope 拒絕樣本。
- 部分桌面畫面可讀，一個唯讀幾何樣本沒有量到水平溢出；不是所有畫面或尺寸的完整稽核。

此場次每個掛載只放入 **5 個精簡檔＋19 個基線檔**，共24檔；根與 nested 共48檔。CD／CH 的入口載入資源齊備，但原245檔中226檔、25候選中23個runtime沒有放入該原生 stage。**本次發布集合雖包含完整252檔，沒有因此把未測項目升級。新完整根與 nested 發布集合本輪沒有另跑原生驗收。** 本次準備只做離線身份、路徑與檔案解析模型，不啟動瀏覽器、HTTP server 或預覽程序。

本場次沒有觀察到協定逾時或 code9，不能推出歷史問題已解。原 preview23 整庫原生驗收仍為 **INCOMPLETE**，歷史 preview21／22／23 的 code9 原因仍為 **UNKNOWN**。不宣稱精簡入口修好崩潰，也不以 DOM 元素較少宣稱較快、較省記憶體或定位原因。

最後的 developer-log 樣本有20條瀏覽器 extension metadata 傳送錯誤。**console 不是 clean**；這也不是完整 console 稽核、產品缺陷確診或 code9 根因判定。

## 尚未驗證與歷史限制

本次有界原生範圍的 **NOT_RUN／NOT_PROVEN** 包括：

- 320／390 窄視口、真手機、觸控與手勢、OS 軟鍵盤、OS IME／原生組字、AT／讀屏、完整鍵盤矩陣及完整 WCAG。
- forced-colors、reduced-motion、完整縮放矩陣、真正 BFCache 命中診斷、原生注入 history payload 的 F1 oracle、已卸載舊控制項生命週期。
- 23個未放入原生 stage 的候選runtime、原完整根頁顯示／品牌返回導航、候選內送出／閱讀／結算操作、外部來源連結的原生開啟，以及正式 owner／API／模型整合。

原完整工作台曾出現 same-document hash Back 的焦點落至 BODY，原記錄沒有因此修復。CM-F01 UNFIXED，semantic88 PENDING，正式72／正式48 NOT_RUN，正式 React／owner／服務／模型／持久儲存／媒體仍未接線或未測。SL 初始詳讀空白與其未完成矩陣保留；CD 窄B編輯區在下方但舊文案說「右側」的已知問題保留。

應用檔的「native 未驗」、「NOT_RUN」、「PENDING」及版本 disclosure 是各自建置時的歷史快照，為保持已驗 bytes 原樣保留。本文件提供後續有界觀察，不回寫舊檔，也不把上述原生樣本外推至完整工作台、所有候選或正式產品。

## 研究來源與可核對的程式身份

104個 exact 研究 URL 是原清冊參考數，不是104個設計方案或驗收通過數。CW 另有五筆工作台方法參考，保留在原版本 disclosure，不混算為原清冊候選或104筆計數。外部研究的原讀取深度與限制全部保留；本輪未重訪外部設計頁面，參考不等於第三方資產授權。

固定清冊來源是 [e8918dd](https://github.com/2NTTY/child-ai-caregiver/tree/e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92)。CD 研究記錄的本地 commit `346abb72d0968d7a4536d06c85032d3f53a0f0b2` 不能當作已核可用的 GitHub commit 連結。公開來源使用 [180c8c16](https://github.com/2NTTY/child-ai-caregiver/tree/180c8c16f193fbc3647038532fca437d83d1b76a)：先前2026-11-05 19:12 UTC 的唯讀 GitHub 回覆已確認它存在，tree 為 `d3efea86974c772a0e2e61622228ea788c9d6f6b`，與原本地來源一致。同 tree 不等於同 commit；本輪僅核對該已封存回覆，沒有重新查遠端或 master。

SHA-256 識別值可核對內容，不是數位簽名。原資料、來源覆核與 bounded native 的各自識別值列於 RELEASE-MANIFEST.json，彼此不能互換。

## 用普通靜態 server 啟動

本文件產生時只完成本機發布準備，**尚未宣稱此新版本已上傳、已部署 Site 或已合併 master**。以下方式適用於新目錄實際完成 GitHub 分支歸檔後。GitHub 顯示 HTML 原始碼不等於網站在執行。

```sh
git clone --branch codex/selection-workbench-20261105 --single-branch https://github.com/2NTTY/child-ai-caregiver.git
cd child-ai-caregiver
python3 -m http.server 8000 --directory previews/selection-workbench/versions/cw01-preview23
```

- 精簡入口：http://127.0.0.1:8000/workbench-compact/
- 原完整工作台：http://127.0.0.1:8000/index.html

要以真正子路徑啟動，先停止上面的 server，再執行：

```sh
python3 -m http.server 8000 --directory previews/selection-workbench
```

精簡入口：http://127.0.0.1:8000/versions/cw01-preview23/workbench-compact/

若已取得完整252檔版本目錄，也可進入該目錄執行 `python3 -m http.server 8000`。不需要安裝依賴或建置工具，不要只取 index.html，不用 file:// 雙擊。只能 serve 公開版本根；不要把包含驗收資料的私人準備父目錄當網站根。

本集合僅含項目程式、美術與合成例子。沒有真實家庭資料、照片、訊息、憑證、真模型呼叫、正式配置套用、帳戶權限或網站公開範圍變更。
