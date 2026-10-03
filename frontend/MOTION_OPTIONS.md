# Web 動態方向比較（暫不採用）

> 歷史比較記錄。2026-10-04 使用者已另外批准 FE-W37 的全站語意動效；本輪採納方向見 [MOTION_SYSTEM](MOTION_SYSTEM.md)，實作及驗收狀態見 [STATUS](STATUS.md)。下列「暫不採用／尚未實作」描述當時的比較階段，不限制本輪明確授權，也不代表下列每個候選已被採用。

<a id="page-transitions"></a>
## 換頁動畫研究，尚未實作（2026-10-02）

使用者要求先查成熟方案及報告，暫不改動換頁動畫。下列為本次建議，沒有套入路由、外殼或現有比較頁。首頁首次會話的 3 秒閱讀／360 ms 孩子上移屬另行已批准的局部互動。

核對 [IBM Carbon motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview)：日常任務適合克制而迅速的 productive motion，較鮮明的 expressive motion 留給少量重要時刻；移動距離、資訊層級與時長一起考慮，保留可辨認的連續元素。它不是要求每次路由都使用同一種滑動。

| 場景 | 建議呈現 | 適用理由 |
|---|---|---|
| 主頁、聊天、記錄、任務之間切換 | 內容區淡入淡出約 180–220 ms，建議先用 200 ms；頂部、側欄及底部導覽保持位置 | 同層目的地，家長可以立即閱讀，不造成左右方向的誤解 |
| 清單進入詳情及返回 | 前進／返回方向相反的短滑動，約 220–280 ms；日後原生 Stack 沿平台預設 | 移動交代進入下一層與返回的關係 |
| 側欄及來源詳情展開 | 只移動或展開該區，不重播整頁進場 | 保持正文、輸入草稿和閱讀位置；正文引用仍立即定位 |
| 系統減少動畫、快速連續導航 | 直接顯示終點；新的導航取代尚未完成的效果 | 操作不排隊、不鎖住控制，不以動畫改變保存結果 |

**以上時長及位置是針對育有方的設計建議，不是官方強制規格。** 不使用整頁縮放、每張卡片依次進場或全站彈簧動畫；使用者已指出版面比例跳動，尺寸必須先穩定，不能用過場遮掩量度後的重排。首頁問候只在同一登入會話首次播放，切頁動畫不重新設置此 flag。

技術先復用現有 Reanimated 4.5.1：官方 [進出場預設](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/)支援 Web／Android／iOS，並提供 reduceMotion；Web spring 仍有文件限制。它足以做短淡入或短位移，但同時呈現離開及進入頁面需要核對 Expo Router 57.0.22 的提交時機，不能聲稱給 Slot 加 FadeIn 就已實作完整 cross-fade。現在 dashboard Web 用 Slot，原生用 Tabs；[Expo Stack 指引](https://docs.expo.dev/router/advanced/stack/)講述的 Android／iOS push／pop 行為不能直接視為目前 Web 的換頁效果。

Web 的另一個成熟方向是 [MDN View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using)：舊／新畫面快照可 cross-fade，並能分開指定區域；不支援時保留普通導航。文件已核對，**未在本工程實測路由接合**。若採用，須等待真正新路由 DOM 提交，保留外殼與焦點、處理連續導航及 browser back／forward，並另核對目標瀏覽器；不因有 API 就保證所有瀏覽器或 React Native 支援，也不增加第二套路由框架。

採用前的局部驗證只需圍繞短過場、快速連按／返回、長聊天草稿及位置、來源瞬間定位、減少動畫與窄尺寸。真登入及 Server 操作驗收沿主聊天 P2 集中安排。本次只研究及記錄，換頁動畫未變更。

## 既有比較及歷史證據

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
