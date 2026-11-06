# 育伴港選配工作台 · preview29 實驗候選保存版

日期：2026-11-06 UTC。本檔記錄分支保存前的驗證結果；分支保存不等於 Site 部署或 master 合併。這份合成前端候選供比較與挑選，不代表正式產品功能已接線或全站驗收完成。

本檔是當期驗證狀態。原 README、研究頁及候選文字保留各自的歷史時點，其中「待驗」「未發布」等是原檔寫成時的記錄。請以本檔理解本次有限驗證範圍；候選契約及未完成的驗收不因此改變。

## 內容與來源

原 preview29 的 317 個公開檔案、19,204,856 bytes 全部逐 byte 保留。只加本檔和 RELEASE-MANIFEST.json，共 319 檔；清冊列出另外 318 檔的大小與 SHA-256，只排除清冊自身的根目錄名稱。這是完整性清冊，不是測試報告。

37 個唯一候選分布於 36 個有候選模組，仍有 88 個邊界、16 組、285 個角色來源路徑。A/B 只算同一候選。147 個去重研究 URL 保留各自讀取深度、採用／拒絕用途及授權限制，不表示全部全文讀完。

相較 preview27，這版提供兩個新增選配，各自沿已覆核的 fix01 來源原 bytes：

- **MP01 動效偏好**：[motion-settings/index.html](motion-settings/index.html)。五個檔案沿 preview28 整合保留。A 偏好核對單與 B 動效試映場共用一個合成 owner；手動、系統、未知／就緒及合成儲存／session 狀態分開。只有實際 no-preference、頁面可見、合成允許、B 方向且主動開始時，才容許一次 1600ms／24px 的裝飾示範；實際 reduce／unknown／hidden 不可被合成允許覆蓋。這不是完整 motion 系統，也不更改 OS 或帳戶設定。
- **SA01 狀態播報**：[status-announcements/index.html](status-announcements/index.html)。八個檔案沿 preview29 整合保留。A 就地三卡與 B 來源索引／單事件／最多六筆非 live 紀錄，共用合成 owner 及三個來源 gate。切換版面／caller 不建立事件或改優先級；初次靜默、同 key 抑制、ABA 與新 key 同文字只是 gate 語意，不保證螢幕閱讀器播報。caller 決定 priority；loading500ms 是合成輸入公式，未跑真正 timer；operation 可見性不自動關閉公告。這不是通用表單、通知中心、播報佇列或完整焦點框架。

全域 catalog 的 e8918dd 與兩個候選來源的 2abe7aed 保持分層，沒有宣稱對齊最新 master。原 React／RN TSX 僅作來源靜態對照，未在此執行。MP 的既有 RF01／RN01 修復紀錄及 SA 閱讀位置修復保留，不改寫為完整原生通過。

原有 TE01 fix04、TH01 fix01、CO01 fix01、DT01 fix01 與其他候選、設計、selection／undo 全部保留。TH 仍是唯讀終態與歷史，沒有撤銷／重開；CO 正式量度不可用，有值量度只屬明標合成示例；DT 只改本頁欄位，不保存任務，時區獨立套用，取消只丟棄日期／時間草稿。Luxon 3.7.2 與 MIT 授權原樣保留；CW 仍是 preview23 的獨立選項。

## 已核對的有限範圍

獨立覆核接受 preview29 的來源／有限 DOM 整合，在這個明確範圍內未發現阻擋問題。作者的 5/5 整合結果另行保留；覆核新增的 3/3 actual-entry 探測涵蓋根路徑／子路徑的工作台入口與研究標示、SA01 共用狀態及不重播 live 節點，以及一項鄰近的修正按鈕閱讀位置／舊 scope 清除檢查。兩組結果分開記錄，不合併為產品或原生通過數。本次保存準備只核檔案完整性、狀態與導航文字，沒有重跑產品測試。

DOM 檢查不等於真實瀏覽器操作或原生驗收。MP 的合成媒體／可見性／timer ports 不等於真 OS 設定或動畫影格；SA 的 live 節點／gate 與閱讀位置觀察不等於真 AT 語音、重複或順序保證。舊 DT 彈窗未驗日期選擇／取消，TH 的模擬 inert 不等於真彈窗鍵盤與焦點通過。

## 尚未驗收

- 本版原生與 HTTP 檢查均 **NOT_RUN**。舊版局部原生證據不能套用為本版通過；MP 完整 motion 系統及 OS／跨頁／真儲存設定、SA 真正 AT 播報均未驗。
- TE-NATIVE-03 的 rebase 後欄位可見性，以及核對標題外框／間距仍待針對 fix04 原生確認；TH／CO／DT 原生亦待驗。
- 88 個完整語意驗收均待驗；正式 63／65／72／48 與 DT40 未執行，production adapter 尚未實作。
- 真實尺寸／像素／overflow／動畫時間、實體鍵盤／pointer／觸控／手勢、焦點可見性／reveal、Back／Forward／BFCache、OS／IME、AT／螢幕閱讀器／聲音／forced colors／完整 WCAG、原 React／RN／Paper picker、正式 API／Firestore／模型及完整 build／typecheck／CI 均未驗。

原有 CM-F01、hash 焦點、CD 窄 B、SL 初始空白、歷史 code9 原因未知、NP 的 DP-F01／lookup404／reconnect 差異，以及 PH 舊 adapted 17 PASS／1 FAIL 結果仍保留。本版不把這些限制改稱已解決。

## 在本機試看

取得完整 `versions/preview29/` 後，以這個單一版本資料夾作 HTTP document root，不要服務倉庫根目錄，也不要只取 index.html。這是現成靜態檔，不需要 npm install、npm ci 或 build。

若已有 Python 3，在直接含有 index.html、RELEASE-STATUS.md、motion-settings/ 與 status-announcements/ 的版本資料夾執行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

保持終端機開啟，瀏覽器開啟 **http://127.0.0.1:8000/index.html**。若 8000 已被佔用，命令與網址一起改用其他埠。看完按 Ctrl+C 停止；只綁定 loopback，不把本機 server 公開到網絡。

GitHub 檔案瀏覽頁不會執行網站；直接雙擊產生的 `file://` 網址不能可靠載入 ES modules。若使用既有靜態 server，須正確提供 HTML、CSS、JavaScript 與 .mjs 的 MIME 類型。上述命令在本次保存準備中未實跑，不新增 HTTP 或瀏覽器驗收結論。

只使用合成示例，不輸入真實家庭資料。分支保存與網站部署是不同的事。
