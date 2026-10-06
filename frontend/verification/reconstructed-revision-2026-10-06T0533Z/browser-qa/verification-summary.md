# 新重建修訂瀏覽器驗證

## 結論

2026-10-06 05:52–06:04 UTC，在 dot 雲端 Chromium 完成本次限定的合成前端檢查。已驗項目沒有未解決的產品缺陷；一次 iframe 外層捲動造成的 pointer 方法失敗已保留，停批後按主模型批准修正方法，單次可見 pointer 補驗通過。沒有改動應用來源或 frozen export。

## 被測版本與方法

- Sites v45；來源 `79f3b6c821aa2cbb1698f9fff688455a467507ef`；部署 `appgdep_6ac48c6dd23081919a7e49f386a87c2e`
- 已在 DOM 核對入口：`/_expo/static/js/web/entry-95f28dfed645f645616bbf755e1c7e4e.js`
- build-input SHA-256：`4584409d4061c2daa63c6d133386070a2b90626b9500e6f5035e895dc84d652c`
- export fingerprint SHA-256：`16fa97ac4ae9b7ea7162ec8fe77e6d73470bedb88b57a666d50c74b365cd5038`
- 網址：`https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site`；尺寸工具實際網址：`/qa-viewport`
- 四尺寸使用既有 QA-only 同源 iframe，實測應用 document 寬度為 1440／1024／390／320 CSS px，高度均為 900 CSS px。這不是手機瀏覽器或真機模擬；外層視窗不同，full-page 截圖包含 wrapper
- 普通桌面直接頁面另實測 1180 × 757 CSS px；確認／取消／結束／撤銷及 History 恢復使用可見 CUA pointer，沒有以鍵盤代替失靈 pointer

## 已通過

1. Care 詳情四尺寸均無 document 水平溢出。1440 列表／詳情為 376.31／783.69 px；1024 為 243.19／500.81 px，未出現約 20 px 清單。390／320 原話內容自然高度為 170／196 px，下一段 Agent 理解相隔 16 px，未見巨大空白。320 返回清單再重開成功，重要內容仍保持待確認
2. Growth 關注鏈、標準報告、History 清單各完成四尺寸畫面及幾何檢查，document scrollWidth 均等於 viewport width。History 已結束列四尺寸高度均為 77 px，恢復與開啟詳情是獨立按鈕，沒有巢狀 button
3. 普通桌面：具名結束確認→取消，內容未改且焦點返回結束按鈕；再確認結束→撤銷，保留待家長核對及原事件，新增相應結束／恢復事件；再結束→History 的獨立恢復按鈕，列表消失而未開詳情，返回 Growth 保留原待核對狀態、原事件及兩組結束／恢復事件
4. Memory 將「記錄來源」由目前版本改為來源已更改，再返回 Growth，時間軸完整文字與切換前一致，包含已新增的四個操作事件
5. 320 報告「導出」可開啟用途選項；「PDF 下載暫不可用」實際 disabled，並明示報告生成／下載未接通。Escape 關閉後焦點返回「導出報告」。320 欄目選單跳至「近期變化與支持」，modal 關閉、正文捲至目標且焦點在目標段落
6. 320 History 可用 Enter 開詳情，再返回列表。普通桌面孩子切換至阿樂，內容為課後分享；320 History 切孩子後沒有殘留小昕已結束列，新孩子顯示空歷史
7. 普通桌面孩子切換的三次 post-click DOM／截圖採樣為 05:57:32.813–05:57:33.136 UTC；320 為 06:01:38.425–06:01:38.862 UTC。各採樣均保留 frontend-preview-ready，未見 startup 文案，孩子標示與內容一致
8. 站內「減少動畫」由 off→on，顯示已減少動畫；切孩子回小昕後，所見終態正確、沒有舊孩子標题或 startup 文案。完成後已恢復 off／跟隨系統，AX switch Value 0 與文案均已核對

## 中斷及補驗

- 本地 Expo serve 成功啟動，但雲端 browser 對 `http://localhost:8082/care` 回 `ERR_BLOCKED_BY_CLIENT`。未嘗試換 host 或繞過限制；之後使用主模型已發布的新 v45。這是環境限制，未當成產品失敗
- 05:52 的 DOM instrumentation 首次嘗試 iframe.contentWindow 受只讀 DOM facade 能力限制；改用受支持 frameLocator→html 幾何讀取。沒有修改 DOM
- 首次 UI 方法失敗於 06:00:17：320 History 返回後，外層 wrapper 已捲動，把 app 頂欄移出可見 viewport；locator click 未打開孩子選單，下一 radio 查詢零項而逾時。即時停批並保存 first-failure.json、截圖及 AX。主模型批准一次方法修正後，正常 CUA 捲外層至頂，量得 iframe x12/y68，實際 pointer (86,101) 一次打開選單；其後 pointer 選阿樂成功，未改應用
- 06:02 reduced-motion 後续 grouped browser call 被 reviewer 拒絕。已暫停並回報；主模型補充原始用戶授權後，同一 call 只重試一次成功，再復原偏好
- 一次整段 timeline 相等的診斷讀值在 Undo 後為 false，原因是正常追加結束／恢復 audit events；驗收條件是原內容及待核對狀態保留，已逐項確認，沒有把新增操作歷史當成資料遺失

## 限制及告警

- 所有資料／操作均為隔離合成預覽。未驗正式 Server、真模型、API 外發、持久化、真照片、相機、咪高峰、Android／iOS 或讀屏
- 沒有使用 DevTools；其入口顯示組織限制。沒有系統級 reduced-motion 模擬、受控慢網絡、連續錄影或逐幀 trace。上述 post-click 離散窗口不能证明首個可見幀／每一幀無白閃，也不能證明所有機型無閃動
- 只驗此限定通常路徑及必要 scope 邊界；沒有宣稱全站／全狀態回歸或實際 PDF 生成
- runtime log sample：普通頁 89 項、wrapper 97 項，產品來源各一項 React Native Animated useNativeDriver 不支援、回退 JS 的 warning；其餘為 browser extension metadata 傳送 error。採集範圍內未見產品來源 error，不等同完整 network/pageerror 追蹤
- 舊 v44 或歷史證據沒有用作本修訂通過依據

幾何原始資料見 observations.json；採樣見 desktop-child-switch-samples.json／mobile-child-switch-samples.json；截圖及所有證據 hash 見 browser-manifest.json。
