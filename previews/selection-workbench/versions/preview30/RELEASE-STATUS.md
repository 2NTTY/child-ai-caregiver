# 育伴港選配工作台 · preview30 實驗候選保存版

日期：2026-11-06 UTC。**來源／有限合成 DOM 整合已獲獨立覆核接受；保存版獨立覆核仍待完成。** 本檔記錄本次分支保存準備的有限驗證結果，不是原生、正式產品或網站部署批准；分支保存不等於 Site 部署或 master 合併。這份合成前端候選供比較與挑選，不代表正式產品功能已接線或全站驗收完成。

原 README、研究頁及 QK／RR 候選內的 PENDING、「待驗」「未發布」等原文保留各自的歷史時點；請以本檔理解本次實際已驗與未驗範圍，原契約及未完成驗收不因此改變。本日的來源／有限合成 DOM 整合接受另行記錄，不改寫封存 runtime，也不把它當作保存版覆核或原生驗收通過。

## 內容與來源

原 preview30 的 332 個公開檔案、19,314,137 bytes 全部逐 byte 保留。只加本檔和 RELEASE-MANIFEST.json，共 334 檔。清冊列出另外 333 檔的大小與 SHA-256，只排除清冊自身的根目錄名稱；同名巢狀檔不會被忽略。這是完整性清冊，不是測試報告。

39 個唯一候選分布於 38 個有候選模組，仍有 88 個完整語意待驗邊界、16 組、285 個角色來源路徑。A/B 只算同一候選，ready 只表示有可試候選。154 個去重研究 exact URL 保留讀取深度、採用／拒絕用途與授權限制。QK／RR 的 8 份 URL 用途為 7 個新 exact URL、1 個沿用，不是 8 個新渠道或全文閱讀。cmdk 部分 README 與另讀 MIT 正文分開；Apple 未取得實質內容，不作設計依據、授權或資產來源；Expo 選讀不是已安裝 SDK 證據，react-error-boundary README／MIT 標示也不是完整實作或授權審查。本次沒有重取外部頁或加入第三方程式、美術、字型。

相較已保存的 preview29，本版加入兩個選配：

- **QK01 快捷入口**：[quick-actions/index.html](quick-actions/index.html)。A 拇指托盤與 B 搜尋分組、選擇後確認，共用一個新合成 owner 和來源 assistant-draft helper。固定文字示例與照片 metadata only，沒有真照片、上傳、送出或照護紀錄寫入。pending／unknown 保留原操作 ID，metadata 交接／釋放一次。明確 local-hide 的焦點修復只在合成 DOM 窄範圍驗證；最後移焦仍讓位給同步新意圖，背景清除不搶焦點。三個 helper 僅去除型別，其餘 adapter 自寫，未接正式文字 owner、Provider、picker 或 guard；不是通用焦點框架或原生焦點修復證明。
- **RR01 路由恢復**：[route-recovery/index.html](route-recovery/index.html)。A 恢復卡與 B 意圖索引共用一個自寫合成 retry authority。切換共用同一代 retry／receipt，完成回調不能蓋過較新的 reference／home 意圖；chat 在完成後可執行一次合成 home 回調，root 沒有 home 入口。只有 safe-reference 是來源 helper 去除型別，其餘為自寫 adapter。這不是原 React／Expo error boundary、Router retry、owner／Provider 重掛或正式導航；不能推論草稿、pending／unknown、原收據跨重掛保存或 leave guard 已通過。回調完成不等於產品或資料恢復。

兩個 fix01 的 15 個 runtime 檔案、72,745 bytes 原樣加入來源整合。preview29 的 317 條來源公開路徑全部保留，312 檔 byte-exact，只有 index、README、modules、catalog、sources 五個整合 metadata 檔不同；37 張舊卡、lab runtime、selection／undo、舊 runtime 和資產保持。這個保存版又將整份 preview30 原 bytes 保留，不改任何封存 runtime。

全域 catalog 仍沿 e8918dd，QK／RR 候選來源沿 2abe7aed；兩層來源不混稱最新 master。原 React／RN TSX 未執行。舊 MP01／SA01、TE／TH／CO／DT 與 CW 的限制照留：MP 的合成偏好、owner、媒體／可見性／timer 與 RF01／RN01 歷史不是完整 motion、真 OS／跨頁／儲存驗收；SA 的三個 gate、caller priority、初次靜默、同 key 抑制、非 live 紀錄及閱讀位置修復不是實際 AT 播報保證，loading500ms 仍是合成輸入。TH 是唯讀終態與歷史，沒有撤銷／重開；CO 正式量度不可用，有值量度只是明標合成示例；DT 僅改本頁欄位、不保存任務，時區獨立套用，取消只丟棄日期／時間草稿。Luxon 3.7.2／MIT 原樣保留，CW 仍是 preview23 的獨立選項。

## 本日已核對的有限範圍

獨立覆核接受這份來源／有限合成 DOM 整合，在此明確範圍內沒有阻擋問題。作者 6/6 與新獨立覆核 4/4 分開記錄，不累加為產品或原生通過數，也不把 selected DOM 數字換算成完成度。新覆核涵蓋根／子路徑工作台篩選與入口、QK 取消移焦中產生新 B 意圖與 metadata 一次交接、RR 共用 retry／receipt／較新意圖與一次 chat home／root 無 home，以及 HTML／import／style／說明頁的有限本地資源閉合。

覆核首跑為 3 PASS／1 FAIL，原因是資源檢查的 selector 漏看既有 SVG use 引用；原結果保留，只補這個 selector 後，同四組得到 4/4，沒有改產品 bytes、降低斷言或把兩次通過數相加。本次保存準備只核檔案完整性、清冊、狀態及導航契約，沒有重跑產品測試。

合成 DOM 不等於真瀏覽器、原生操作、OS、AT 或產品接線；合成 cached pagehide 也不證明真 BFCache。舊 DT 彈窗未驗日期選擇／取消，TH 模擬 inert 不等於真彈窗鍵盤與焦點通過。

## 尚未驗收

- 本版原生及 HTTP 均 **NOT_RUN**。舊版局部原生證據不能套用成本版通過，QK 原生焦點、RR 正式重掛／guard／導航、MP 完整 motion 與 SA 真 AT 播報仍待驗。
- TE-NATIVE-03 的 rebase 後欄位可見性、標題外框／間距，以及 TH／CO／DT 原生仍待驗。
- 88 個完整語意驗收仍待驗；正式 63／65／72／48 與 DT40 未執行，production adapter 尚未實作。
- 真尺寸／像素／overflow／動畫時間、實體鍵盤／pointer／觸控／手勢、可見焦點／reveal、Back／Forward／BFCache、OS／IME、AT／螢幕閱讀器／聲音／forced colors／完整 WCAG、原 React／RN／Paper picker、正式 API／Firestore／模型與完整 build／typecheck／CI 均未驗。

原有 CM-F01、hash 焦點、CD 窄 B、SL 初始空白、歷史 code9 原因未知、NP 的 DP-F01／lookup404／reconnect 差異及 PH 舊 adapted 17 PASS／1 FAIL 仍保留，不改稱已解決。

## 在本機試看

取得完整 `versions/preview30/` 後，以這個單一版本資料夾作 HTTP document root，不要服務倉庫根目錄，也不要只取 index.html。現成 buildless 靜態檔不需要 npm install、npm ci 或 build。

若已有 Python 3，在直接含 index.html、RELEASE-STATUS.md、quick-actions/ 與 route-recovery/ 的版本資料夾執行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

保持終端開啟，再開 **http://127.0.0.1:8000/index.html**。若 8000 已被佔用，命令與網址一起改用其他埠；看完按 Ctrl+C 停止。只綁 loopback，不把本機 server 公開到網絡。

GitHub 檔案頁不是 running website；雙擊檔案的 `file://` 不能可靠載入 ES modules。其他靜態 server 須正確提供 HTML、CSS、JavaScript 與 .mjs 的 MIME 類型。命令在本次只核對 shell syntax，沒有啟動 HTTP 或瀏覽器。只使用合成示例，不輸入真實家庭資料；保存分支不會部署網站。
