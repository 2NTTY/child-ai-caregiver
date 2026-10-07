# 本人模型設定前端交接

更新：2026-10-01。FE-W13 只修改 `frontend/**`，沿現有 draft PR #73；前置 `433d31202b6e56e97f742e626e37bed3ade451dd`，源碼及驗證交付 `095f1356c1f1d1b9ad62ee1ad589b2d7e23582cb`，其後只補交付定位文件。主責 B，前端責任份額 100%、相對權重 5；使用者比較視覺，主聊天接正式 API／權限及驗收。

**前端已實作；合成操作可預覽，沒有保存真密鑰、呼叫 Server 或 Google。** 不改後端、正式 App、根依賴／配置、AGENTS 或主聊天文件，不自行 merge。

## 權威來源

先直接讀 GitHub 的 UI-P2-18，再局部讀 API／型別／正式 Panel 及封裝。交付前重核 master `ce87370b6375b25e45f016f2218d924b44f06f3c`，以下內容沒有變動；沒有依賴主聊天本機是否拉取。

| 來源 | 核對用途 |
|---|---|
| [P2 UI 交接：UI-P2-18](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md#personal-model-ui) | 平台／個人／停用、費用及外送同意、背景 opt-in、刪除、用量及 unknown |
| [API：personal-model-http](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#personal-model-http) | 路由、權限、版本、輸入範圍與錯誤 |
| [共用型別](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/model-settings.ts) | command／settings／usage／check 型別及上限 |
| [ModelSettingsPanel](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/ModelSettingsPanel.tsx) | 正式 scope、清除輸入、未知重讀及已保存後讀用量失敗的既有行為 |
| [model-settings-api](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/model-settings-api.ts) | 既有 transport／嚴格回應核對，不重建第二套 API |

## 組件及預覽

`http://localhost:8083/settings` → 個人與帳戶 →「管理模型設定」，或選「模型設定」分頁。啟動及固定輸出沿 [HANDOFF](HANDOFF.md) 的既有命令。

| 位置 | 職責 |
|---|---|
| [ModelSettingsView](src/components/model-settings/ModelSettingsView.tsx) | 純 view model／操作回調；兩欄／單欄表單、分開用量、模型資料查核、刪除 Dialog |
| [model-settings-view-model](src/model-settings-view-model.ts) | 根型別的顯示投影及 `refresh`／`save`／`check` 回調；不是新 wire contract |
| [model-settings-form](src/components/model-settings/model-settings-form.ts) | RHF／Zod 草稿驗證；建立原 command 及刪除 command |
| [ModelSettingsPreview](src/components/model-settings/ModelSettingsPreview.tsx) | 收起的合成情境工具；模式、結果、服務可用性、帳戶及 Server 切換 |
| [useModelSettingsPreview](src/preview/useModelSettingsPreview.ts) | 只保存無密鑰的合成 metadata，取消舊範圍及遲到結果；不得當正式 transport |
| [settingsScreen](src/screens/settingsScreen.tsx) | 掛入既有設定分頁及帳戶入口；本人身份與渠道預覽共用 |

沿 Paper 5.15.3、RHF 7.88／Zod 4.5 和共用 AppTextField／AppSelect／AppCheckbox／AppDialog／OperationPill／SectionCard。沒有新依賴、新色階或逐頁自造控件；間距／字級及 SVG 沿現有 theme。主內容可用寬度不足 820 時改單欄；手機仍使用既有外殼及底部分頁。

`frontend/tsconfig.json` 增加 `allowImportingTsExtensions`，配合現有 `noEmit`，讓 Node 的原生 TypeScript 測試能載入 schema 的 runtime `.ts` import；Metro 仍負責 bundle。已核對 [TypeScript 官方限制](https://www.typescriptlang.org/tsconfig/allowImportingTsExtensions.html)。正式接線時沿正式工程的型別／常數及 import 規則，不為複製此投影而修改根配置。

## 回調接線及清理

| 回調 | 原 API | 主聊天須保留的行為 |
|---|---|---|
| `refresh()` | `GET /api/ai/settings` → `api.read(signal, userId)` | 重讀 metadata／版本，不讀回密鑰。成功後重設表單、清同意與密鑰、核對目前模式 |
| `save(command)` | `POST /api/ai/settings` → `api.save(command, signal, userId)` | 使用 `expectedVersion`。密鑰只在直接 request 存在；不設 opId、重試正文或離線隊列 |
| `check(expectedVersion)` | `POST /api/ai/settings/check` → `api.check(expectedVersion, signal, userId)` | 只查已保存密鑰的模型 metadata；回應 version 必須相同。AI 或個人服務不可用時停用此按鈕 |

正式版復用 `createModelSettingsApi`：登入 cookie、每次 `x-expected-user-id`、`cache: no-store`、20 秒 abort、原輸入及嚴格成功回應。UI callback 不接管密鑰加密、模型 SDK、配額或實際用量權威。

- 範圍按 Server＋本人身份隔離。換帳戶／Server、撤權／401／403、離線或卸載時清密鑰及同意，取消舊請求，忽略遲到結果；不要顯示舊帳戶的用量或保存結果。
- 切換孩子不切換本人密鑰或清除此帳戶表單。本包已檢查這個區別；切孩子不應被當作模型 scope 改變。
- 密鑰欄遮罩、停用 autofill／自動修正，不讀回已保存原文。送出前先清欄位；已知失敗仍保留非秘密選項草稿，但密鑰及同意要重新輸入／確認。離線亦不保留密鑰。
- 合成 metadata Map／timeout 只持有版本、模式、boolean、上限及用量；不存密鑰、hash、command body 或 retry body。沒有 localStorage／sessionStorage 的密鑰保存。

## 操作語義

| 情況 | 畫面及下一步 |
|---|---|
| 未保存草稿／待確認 | 目前 Server 版本與編輯草稿分開；改選項不當作已保存 |
| 保存中 | 鎖定寫入，顯示處理中；範圍切換後不可回寫舊結果 |
| 已保存 | 嚴格成功回應後更新版本並清秘密。若其後用量 GET 失敗，已保存狀態不倒退成 unknown；使用者可手動刷新用量 |
| 已知未保存 | 顯示失敗；保留非秘密草稿，密鑰與費用同意清空 |
| 結果未知 | 網絡／逾時、5xx 或成功回應未能核對均不能當未保存。清秘密及鎖定；先 GET 目前版本／設定，再讓使用者核對及明確保存，絕不自動重播原密鑰 |
| 409 版本衝突 | 先重讀最新 metadata；不用舊 expectedVersion 覆蓋，也不偷偷換基準重送 |
| 429 查核限流 | 告知每帳戶每分鐘最多一次，稍後手動重試；前端合成器只展示 429，沒有冒稱已執行 Server 限流 |
| 401／403 | 清身份相關 metadata 與輸入，請重新登入 |

保存密鑰不等於連線成功；`accessible` 只表示此版本的模型資料可讀，不代表生成／查詢向量、帳單或剩餘配額已驗證。查核新輸入前須先保存，不能用未保存草稿查另一把密鑰。

個人每日上限 1–1000（預設 100）、每次 Agent 生成 1–12（預設 4）、查詢向量 1–6（預設 2）；只有個人模式能編輯。非個人 command 沿已保存上限，省略密鑰；平台沿既定 4／2 配額，不以個人草稿改平台規則。

平台／個人用量分開，保留 `unknownUsageAttempts`，顯示計數日、全站安全上限及每日 UTC 00:00／香港 08:00 重置。工具 8、運行 90 秒、輸出 1024 tokens 只作唯讀資訊。互動上下文上限從 GET /api/ai/settings 頂層 agentInputCharacters 顯示實際 Server 設定（32,000–64,000 整數）；缺欄位顯示「互動上下文上限未提供」，不可硬編 32k 或猜 64k。背景維持 32k。計數不冒充完整供應商帳單。

刪除要開 Dialog 再明確勾選及確認，command 必須 `removeKey: true`＋`mode: disabled`、無新密鑰、無背景同意。服務不可用仍可刪除或選停用；保存停用／刪除後不自行改用平台，也不撤回供應商已接受的請求。

## 驗證及待接續

本包執行 typecheck、三項有關費用／整數上限、非個人省略密鑰及刪除模式的輕量檢查；固定 Web export、Android Hermes／資產 export；模型設定在 1440／1024／390／320、Space／Enter、費用及背景分開、metadata-only 查核／429、服務不可用仍可刪除、unknown 已生效／未生效、409、已知失敗草稿、孩子／本人／Server／離線清理及 browser storage 檢查。另只針對此表單檢查 390／320 的 150% Web 文字及欄位重排。

最新結果及源碼／bundle hash 見 [build-checks](verification/fe-w13/build-checks.json)／[UI 檢查](verification/fe-w13/checks-model-settings-model-settings-text.json)，實際截圖見 [1440](verification/fe-w13/model-settings-1440.png)、[390](verification/fe-w13/model-settings-390.png)、[320](verification/fe-w13/model-settings-320.png) 及 [320 放大文字](verification/fe-w13/model-settings-large-text-320.png)。Paper 浮動標籤以穩定後位置截圖，沒有因自動化中間幀更換控件；其餘未改畫面及 18 組色彩對比沿 FE-W12／FE-W11 的證據。

**待接線／待驗收：**主聊天使用原 Panel／API controller 接真身份、設定保存／查核／用量，保留 abort／清理／unknown 行為；跨頁模型模式須由權威 metadata 同步。本包沒有真 Google key、真服務、區域可用性／帳單證據、正式瀏覽器 E2E、部署或 APK。Google Developer API 地區限制及產品 P2／P3 狀態仍以主聊天為準；手機截圖和 Android bundle 不代替原生鍵盤／安全輸入、TalkBack、大字體或真機。
