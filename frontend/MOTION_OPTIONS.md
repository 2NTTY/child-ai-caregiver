# Web 動態方向比較（暫不採用）

2026-09-27，使用者決定 Web 與日後 Android 前端先保持靜態。本頁保留當時的比較與驗證證據，並非正式產品設計規則；將來若要加入動態，須另立前端工作包及分平台驗收。

本頁只比較呈現節奏；不改業務狀態、操作收據、任務或通知語義。可在獨立合成預覽的 `/motion-preview` 切換 A／B／C，按「重播進場」「切換孩子」「展開詳情」看同一份示例內容的差異。這不是正式產品頁，也沒有向 Server 讀寫。

| 方向 | 預覽已做的觸發與節奏 | 選定後建議套用的位置 | 取捨 |
|---|---|---|---|
| A 安靜回應 | 孩子與卡片淡入 180ms；詳情淡入 200ms；按鈕保留 Paper 原有回饋 | 記錄／設定等密集資料頁、讀取完成與詳情展開；路由與左／右欄維持穩定 | 最清楚、干擾最少，但較不突出資料切換的方向 |
| B 路徑導向 | 切換孩子由右移入 16px／240ms；卡片向上 12px／240ms；詳情由右移入 20px／220ms | 路由內容區進場、孩子切換、右欄開關與需要理解「下一層」的內容；待確認只動容器 | 最能交代空間關係，但必須控制連續導航時的方向一致性 |
| C 溫暖微動 | 孩子／卡片由上 12px／340ms 進場；示例卡錯開 70–140ms；圖示 260ms 柔和放大；詳情向上 10px／320ms | 首頁、首次引導、空狀態和少量重點卡片；密集記錄、錯誤及結果未知不用錯峰 | 更親和，但大量清單使用時會拖慢閱讀，所以只適合少數位置 |

**當時的技術建議：先選 B，再混合少量 A。** 育伴港需要照顧者分清「換了孩子」與「展開詳情」，B 的短距離方向提示最有用；照顧記錄、設定與結果未知等資訊密集畫面採 A 的淡入或保持靜態。C 可留給首頁和引導，不宜全站套用。使用者現已決定暫不採用，這段只保留作日後參考。

共同限制：320px 時示例卡改單欄，不增加橫向捲動；鍵盤焦點即時可見，操作不用等動畫完成；Web 會即時監聽系統 `prefers-reduced-motion`，亦可在預覽頁手動切換，啟用後直接呈現靜態終點。所有效果只在資料容器或圖示，絕不以動態暗示「待確認」已保存、「處理中」已結束，亦不自動循環或閃動。

技術選擇：沿用本目錄現有 React Native Paper 5.15.3、Expo Router 57.0.22 和 React Native Reanimated 4.5.1；不增加套件。Reanimated 官方的 [進出場動畫](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/)支援 Web，建議在組件外建立動畫 builder；[useReducedMotion](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/)可讀取啟動時偏好，[無障礙指南](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/)說明 `ReduceMotion.System` 的終點行為。Web 偏好在運行中變更時，預覽額外用 `matchMedia` 監聽。官方亦指出 [Web 動畫在 JavaScript 中執行](https://docs.swmansion.com/react-native-reanimated/docs/guides/web-support/)，因此選小位移、短時長及最多三卡錯峰；Web spring 進場尚未支援，不依賴彈簧效果。以上文件於 2026-09-26 核對，實際預覽另經本機瀏覽器驗證，不代表 Android 已驗收。

驗證：`npm run typecheck`、`npm run build:web` 通過；`npm run verify:motion` 在 1440／1024／390／320 CSS px 檢查三款切換、孩子資料同步、鍵盤展開、手動／系統減少動態與無整頁橫向溢出。截圖在 [verification/motion-preview](verification/motion-preview)。正式頁面尚未採用任何方向；錄影需要的本機 ffmpeg 未安裝，因此以可互動頁面及截圖交付比較。
