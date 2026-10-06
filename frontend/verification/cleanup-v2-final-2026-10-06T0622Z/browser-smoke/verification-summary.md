# 清理版 v46 限定 smoke

2026-10-06 06:34–06:38 UTC，在 dot 雲端 Chromium 完成限定 smoke。已驗通常路徑通過，沒有發現遺失元件或未解決產品缺陷；没有修改應用來源或 dist。

## 版本

- Sites v46，source `a7778bedb0204bb01ac38b143daccf8757ad786b`
- deployment `appgdep_6ac49640f17081919eee7d317b7386ec`
- 每個已保存畫面均從 DOM 核對新 entry `123f157e5a028b7f1bb01348c60a6323`
- build-input SHA-256 `7b50b8b33b0b958f8986f766ea88156dffe5c3823fd8d5ba982bd8d18aa2b2d8`
- export fingerprint SHA-256 `2fdf3d0d7e0465b216039fc72b81f2dca663905d362717e011ba55f2a225cc5a`

## 已驗

- 普通桌面 1180 × 757 CSS px：Home、Care 已打開詳情、Growth、Memory 版面正常；實測 document scrollWidth 均等於 1180
- 320 × 600 CSS px 同源 QA iframe：Home、Care 已打開詳情、Growth、Memory 正常；實測 document scrollWidth 均等於 320。事前把外層 wrapper 捲到頂部，整個 iframe 留在可見範圍，沒有重複上次不可見 pointer 的方法
- Growth pointer：具名結束確認→取消，時間軸文字不變；再結束一次→History 獨立恢復一次，返回 Growth 保留待家長核對、原來事件及新增操作歷史
- Chat：只輸入合成文字，離開到 Memory 再返回，未送出草稿逐字保留；完成後清空該測試草稿，没有按送出／預覽輸入
- 320 Growth 切換到阿樂，內容變為課後分享與表達，沒有舊孩子標題；觀察時 frontend-preview-ready 仍在，沒有 startup 文案
- Memory 可由普通桌面側欄及窄屏助手入口正常進入

## 中斷與方法備註

- 一次 grouped synthetic History Restore call 被工具審查拒絕，已暫停；主模型提供原始用戶授權後，完全相同 call 只重試一次並成功。這是權限中斷，沒有改驗收條件或繞過限制；原訊息及處理記於 flow-results.json
- QA wrapper 的高度按鈕已把 iframe／應用實際高度設為 600，但右側說明文字仍顯示 900。截圖上的該說明是 stale wrapper label；本次尺寸依 observations.json 的實際 document clientHeight=600，不依標籤。没有修改 QA wrapper
- 所採集 runtime logs 中，產品來源只有兩項 React Native Animated useNativeDriver 回退 JS 的 warning，沒有產品來源 error；browser extension 的 metadata error 分開保留

## 限制

這是本清理修訂的短 smoke，沒有重做舊四尺寸矩陣、全站回歸或新按鈕閃動核查。靜態畫面及離散終態不能證明首幀／逐幀不閃，也不能作正式 Server、真模型、持久化、真照片、native／真機驗收。沒有真上傳或模型操作。

11 張本修訂 JPEG、observations.json、flow-results.json、runtime-logs.json 及 checksum manifest 同存於本目錄；v45 證據保持原狀。
