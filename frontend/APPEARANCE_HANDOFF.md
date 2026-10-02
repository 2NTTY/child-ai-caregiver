# 配色及首頁背景交接（FE-W20）

日期：2026-10-01。前置 `0ae397636342b57d7f474ff9d4ee7cc210b57ea1`，沿 `codex/fe-w11-photos`／[draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)，主責 B。只改 frontend，不改正式 App、Server／Agent、根依賴、品牌素材或指導文件。

交付源碼／驗證 checkpoint：`3ae41c769e03d3f0f2b61fe30443f668a2eddc50`。19 項當前改動的源碼 SHA／Git blob、最終 Web／Android 產物及覆核範圍見 [build-checks](verification/fe-w20/build-checks.json)；source snapshot SHA-256 為 `c07a119e266b3cbcd38c801e1e507c0d41ee8e28f094add672c55672b6a38002`。60 個重排證據早於最後插畫定位／頭像底色修正，最終設計／背景／composer 局部檢查已補驗，不冒稱每頁都重跑業務。

## 已實作／只屬預覽

- 共用主題採 [Happy Hues 14](https://www.happyhues.co/palettes/14)，網站角色、本項目映射及 OKLCH 參數在 [COLOR_STRATEGY](COLOR_STRATEGY.md)，唯一色值入口是 [theme](src/theme.ts)。普通提交深底白字，Agent 強調入口黃底深字，其他頁面共用同一主題。
- `/settings` 的「應用偏好 → 首頁背景」可真正選取 Web 本地圖片／預覽／恢復。回首頁後桌面及手機共用該背景，切孩子保留本人的外觀設定。
- JPG／PNG／WebP、最多 4 MiB，檢查可解碼。取消、格式／大小／解碼錯誤保留原圖。沒有保存、上傳、模型、網絡圖片輸入或通知。
- 本次預覽內跨頁保留；替換、恢復、離開 dashboard 路由區／進入登入預覽、unmount 釋放 object URL，遲到選圖不套入已離開的範圍。重新整理恢復原圖。Router Stack 可保留舊頁，Provider 同時沿 useFocusEffect 處理路由區失焦，不能只依賴 unmount。
- HomeBackground 以 RN Image／SVG 漸淡保護文字。文字區不透明，手機底部接回 canvas；裝飾圖片不讀屏、不攔點擊。保持靜態。

預覽：在 frontend 執行 `npm run web -- --port 8083`，或 build:web 後 `npx expo serve --port 8083`。驗證設 `FRONTEND_PREVIEW_URL=http://localhost:8083`、`FRONTEND_VERIFICATION_DIR=verification/fe-w20`，執行 `node scripts/verify-ui.mjs layout design appearance`。不停止其他聊天的預覽。

## 待主聊天接線

| 入口 | 責任／接續 |
|---|---|
| [background-view-model](src/background-view-model.ts) | 顯示層 PickedBackgroundImage／PickBackgroundImage：uri、filename 及冪等 dispose，不是 Server body。原生取消返回 null，晚回傳的 URI 須能釋放 |
| [BackgroundImagePicker.web](src/components/appearance/BackgroundImagePicker.web.tsx) | 真 Web 選檔、格式／大小／解碼、object URL；不作持久保存 |
| [BackgroundImagePicker](src/components/appearance/BackgroundImagePicker.tsx) | 原生薄 port；沒有 pickImage 時明確停用，不冒稱手機可選圖。SettingsPage 尚未注入 adapter；接線後須驗權限、取消及 URI 生命週期 |
| [BackgroundSettings](src/components/appearance/BackgroundSettings.tsx) | 共用預覽／錯誤／恢復 UI，可注入原生 pickImage |
| [BackgroundContext](src/preview/BackgroundContext.tsx) | 預覽狀態與資源歸屬。正式版須以真 userId／session／Server 掛載或清理，不能沿用 caregiverName 作身份；禁止帶回另一個帳戶的背景 |
| [HomeBackground](src/components/appearance/HomeBackground.tsx) | 桌面／手機的共用背景及漸淡；外殼、照顧資料、原草稿不跟背景選擇改變 |

直接核對 GitHub master `ce87370b6375b25e45f016f2218d924b44f06f3c` 的 [P2 UI 交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md)（blob `8124bf61b31ed402d5b3f1cd264079f931eeeac1`）及 [NotificationPreferences](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/family.ts)（blob `5f605fac7d982748ca2e90c38964ce6458adbf9b`）。偏好型別只有時區、安靜時段、預約例外、版本，**沒有背景保存契約**。

正式背景讀取／保存、帳戶隔離、儲存及刪除由主聊天另行安排。不要把 wallpaper 塞入 notification-preferences／照顧照片 API，也不要持久保存 object URL。本包滿足日後替換的前端入口，不代表背景後端已完成。

## 驗證與限制

typecheck、22 組對比、Web export、Android Hermes／31 資產 export、15 頁四尺寸重排、六寬度 Dialog／SVG，背景取消／有效／格式錯誤／損壞／替換／恢復／跨頁及離開清理，以及 390／320 的 150% Web 文字通過，見 [FE-W20 證據](verification/fe-w20)。沒有 API、真家庭資料／登入／上傳、模型、原生選圖或 Android 實機驗收。

首次檢查發現 Stack 保留舊路由，單靠 unmount 清理不足；已加 blur 清理並重驗。業務操作源碼未改，沿用 FE-W11–W19 規則證據。配色不取代正式接線／完整無障礙／使用者視覺確認；交付源碼及產物身份記於 build-checks。

<a id="ripple-follow-up"></a>
## FE-W20 按下效果補修

2026-10-01，基線 `2362228d000220b0094795f5cdc645aaa5d49058`。使用者指出 Agent 按鈕按下變成實色青色；原因是 [AgentEntryButton](src/components/AgentEntryButton.tsx) 遺留 rippleColor=colors.sage。改為局部 onSurface=colors.onAccent，復用 Paper 5.15.3 的 12% alpha ripple 及原生 underlay 後備；共用 AppButton 原本已按 textColor 自動產生透明層，毋須重寫。黃色及深色文字／SVG 保持原角色，不新增顏色或動畫框架。

實際 Web export 在 1440／1024 的八項檢查通過：Agent、共用 accent／secondary 的按住透明層／父層底色、放開清理，Agent Enter／目前頁面及原草稿。無 pageerror、console.error 或 API 請求；[pressed-checks](verification/fe-w20-ripple/pressed-checks.json)，[按住](verification/fe-w20-ripple/agent-pressed-1440.png)／[放開](verification/fe-w20-ripple/agent-rest-1440.png)。typecheck、Web 33 路由及 Android Hermes／31 資產 export 通過，當前源碼及產物身份見 [build-checks](verification/fe-w20-ripple/build-checks.json)。只改桌面側欄入口，窄 Web 底部分頁沒有使用此元件；沿用 FE-W20 的手機重排證據，不宣稱重跑全站或原生實際按下。
