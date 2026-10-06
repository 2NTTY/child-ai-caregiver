# v49 輸入框限定瀏覽器驗收

日期：2026-10-06，約 08:04–08:13 UTC。環境：dot 雲端 Chromium。

網址：https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/chat

## 結果

已執行的桌面、390／320 窄屏及輸入檢查通過，沒有發現 composer 產品失敗。send 的持續按住及釋放未執行，不能稱為完整按壓驗收。已在結束時清空合成草稿，送出停用；沒有提交文字、觸發預覽回覆、呼叫模型、上传檔案／照片或啟用相機／咪高峰／權限。

## 被測版本

- Parent 提供版本：v49
- 瀏覽器實際 script：`/_expo/static/js/web/entry-3e2f8d0fc2f8a09690edb0560b8a9fe3.js`
- Parent 提供 source：`8be24dc28a23baae506821fcb89efffe368cfa52`
- Parent 提供 deployment：`appgdep_6ac4ab40fa8c819184ba6bf1b41a37a5`
- 本輪直接確認 live entry，沒有自行重驗 Sites metadata、Git、304 項測試或 export；這些沿 parent 的既有證據

## 已實測

### 桌面：1180 × 757 CSS px

- 面板 752 × 98，24px 圓角、1px 柔和邊線、4px／8px 內距、輕陰影
- 初始 textarea 734 × 48，透明背景，8px／8px／4px padding
- 工具列 gap=0；拍照、文件、語音、建議及 send 點按區均 40 × 40
- send 圓形為 36 × 36、18px radius、無常駐邊框；空值 aria-disabled=true，圓形 opacity=0.35
- 真實鍵盤 Shift+Enter 保留第一行並加入第二行，沒有啟動預覽；高度變為 60px
- 12 行合成文字後 textarea 限高 168px，scrollHeight=300、overflow-y=auto；Control+End 後 scrollTop=132
- Tab 可到達工具及 send；有 :focus-visible、1px 深色 focus 邊線，send 外層保持透明
- 同一合成孩子的草稿經「待辦與預約」再返回聊天仍保留；改選另一合成孩子後草稿清空，send 停用

### 手機樣式：既有 QA iframe，實際 390 × 600 及 320 × 600 CSS px

- 以 element.ownerDocument 的實際 documentElement.clientWidth/clientHeight 量度，分別為 390×600／320×600；scrollWidth 各等於 viewport 寬度
- 390 面板寬 358，320 面板寬 288；左右位置均 x=16，沒有 composer 橫向溢出或工具重疊
- 兩寬度 textarea 初始高度 48px、面板初始高度 106px
- 五個操作點按區均 48 × 48；send 視覺圈維持 36 × 36
- 兩寬度 10 行合成文字均到 168px 上限；面板高度 226px，工具及底部导航仍可見
- 320 使用真實 scroll 操作，textarea scrollHeight=252、scrollTop=84，內部可捲動
- 清空後回復 textarea 48px、overflow-y=hidden、scrollTop=0，send 停用
- 320 安全 pointer hover：send 圓形由 rgb(255,216,3) 變為 rgb(229,194,11)；外層透明無框、面板／工具 opacity=1，沒有整排淡出

## 參考圖及畫面觀察

已直接檢視使用者提供的窄面板截圖及官方 Codex mobile 截圖，再檢視本輪桌面／窄屏真實像素。新版保留上方輸入、底部左側輕量圖示及右側單一圓形 send 的層次；邊界較柔和，工具更緊湊，手機點按區仍保留。這是按參考呈現規則核對，不是逐像素一致性或主觀偏好最終裁決。

## 失敗及修正，與產品結果分開

1. 導航草稿驗收第一次 tool approval 被拒，立即停批並通知 parent。Parent 提供原文授權後，只把同一 call 原樣重試一次，成功。詳見 `v49-helper-failure.json`
2. 初次手機量度 helper 在頂層讀 iframe.contentDocument 得 null，誤回退外層；結果 panel/textarea=null、1180×757 是無效量度，原檔 `v49-mobile-390-empty.json` 保留，不列通過
3. Parent 批准 frame-scoped 修正；字串函式 evaluate 回 undefined，JSON 寫入失敗，立即停止。再次獲批後用直接函式的最小 probe，成功回傳 390px 真實 DOM 寬度；同方法再取完整 390／320 量度。詳見 `v49-frame-helper-failure.json` 及 `v49-mobile-390-empty-corrected.json`

## 限制

- send 持續按住／釋放沒有安全取消保證，本輪沒有點擊 send，也没有用 Enter 啟動預覽。來源中的 pressed/hovered 共用局部 circle 配方可支持靜態判斷，不能替代真實 held 證據
- IME composition、每幀穩定性、原生手機鍵盤／真機、跨瀏覽器沒有新實測
- 桌面正常瀏覽器是 1180px，沒有擴測1440／1024
- QA wrapper 的文字仍顯示 900px，實際 iframe height attribute、style 及 DOM clientHeight 均為600；沿既有已知 wrapper 標籤限制
- 不擴為來源列字體、整站、Server 或正式家庭資料驗收；沒有 source、Git 或 Sites 修改

## 關鍵截圖

- `v49-desktop-empty.jpg`：桌面空值及周邊正文
- `v49-desktop-send-focus.jpg`：桌面多行上限及 send 鍵盤焦點
- `v49-mobile-390-empty.jpg`：390 窄屏空值
- `v49-mobile-390-cap.jpg`：390 多行上限
- `v49-mobile-320-empty.jpg`：320 窄屏空值
- `v49-mobile-320-cap.jpg`：320 內部捲動
- `v49-mobile-320-send-hover.jpg`：320 局部 hover
- `v49-end-cleared.jpg`：結束時草稿清空、send 停用

所有檔案都在本包新 browser-qa 目錄；舊 v48 QA 未更改。瀏覽器操作已停止，可交還。
