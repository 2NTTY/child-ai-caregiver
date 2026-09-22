# S01-W01 開源復用核查

本文件保存 2026-09-22 的有界調查證據；現行採用決定由 [ADR-REUSE-P1](DECISIONS.md#adr-reuse-p1) 維護，版本實際安裝及可運行證據由後續工作包提供。調查不代表已採用程式碼、產品驗收或完整安全審計。

## 邊界

- 工作包：S01-W01／S01／P1；狀態：已完成（有界核查）。驗收：固定必要候選、許可及實際復用清單；[證據](../artifacts/verification/S01_W01_CHECKS.json)／[記錄](../WORKLOG.md#log-20260922-101)。
- 前置：S00 及 DOC-R02 已在 `89d864aba33c35fd2749bc4813156f25f5af1123` 合併（[PR #6](https://github.com/2NTTY/child-ai-caregiver/pull/6)）。
- 按既定 Expo Router／React Native／TypeScript、Server PostgreSQL／Better Auth 路線，只核查 coo 與最小縱向流程必要依賴。沒有重新選底座。
- 沒有下載／執行育兒候選程式、連接模型或部署服務。Agent Prompt Pack 由獨立任務負責，本包不建立 prompt 或 Agent 流程。
- 歷史研究 [OPEN_SOURCE_REUSE](../OPEN_SOURCE_REUSE.md) 保留原文，不把其中 Baby Buddy 優先建議當現行決策。

## coo 固定版本核查

固定 commit：[`1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec`](https://github.com/skidx64/coo-ai-agent/commit/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec)（2025-10-29）。

| 檢查 | 實際證據／結論 |
|---|---|
| 許可正文 | [README](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/README.md) 聲稱 MIT，但固定版本 `LICENSE` 回傳 404；[完整 tree](https://api.github.com/repos/skidx64/coo-ai-agent/git/trees/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec?recursive=1) 的 `truncated=false`、108 個 blob 沒有 LICENSE／LICENCE／COPYING／NOTICE。結論是「許可正文未核實」，不是已核實 MIT。 |
| 技術與完整性 | [requirements.txt](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/requirements.txt) 為 Python／FastAPI、Anthropic／Boto3、SQLAlchemy／Twilio；[database.py](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/src/database.py) 匯入的 `src/models/models.py` 不在 tree。沒有 TypeScript／package.json／Compose 起點。這是靜態缺件證據，並非聲稱已運行失敗。 |
| 身份隔離 | [Lambda 設定](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/terraform/lambda.tf) 設 `SKIP_AUTH=true`；[messages routes](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/src/api/routes/messages.py) 的家庭查詢／刪除入口未見身份或成員檢查，不能沿用為 P1 隔離實現。 |
| 渠道／記憶 | [SMS service](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/src/services/sms_service.py) 耦合 Twilio、選人及未發送的成功旗標；[conversation service](https://github.com/skidx64/coo-ai-agent/blob/1fd98f5f1aea6cb0c79f06ed1e254a83626c1eec/src/services/conversation_service.py) 的電話／家庭短期 context 不等同本產品可恢復記憶。 |

主代理覆核完整 tree、requirements、messages routes 及 Lambda 設定後，決定不複製 coo 程式碼、模板、prompt 或部署檔；只保留來源線索。沒有嘗試修復缺件或改造 AWS／短信底座。

## 保留但不採用的既有研究

| 候選 | 證據及本包結論 |
|---|---|
| Baby Buddy | `v2.10.1` → `664ac751a210d7a84b43e04647828e033a9764ae`；[LICENSE](https://github.com/babybuddy/babybuddy/blob/664ac751a210d7a84b43e04647828e033a9764ae/LICENSE) 正文為 BSD-2-Clause，SHA-256 `f0dcf391cb221791dc0063601968b21b4fa94964051cae11ed16e4ff5f73f182`。只保留育兒記錄流程研究，沒有複製欄位、程式碼或素材。Django 底座不符合既定共享 TypeScript 路線；[官方使用者文件](https://docs.baby-buddy.net/user-guide/managing-users/) 的跨孩子可見性亦不能當本產品的帳號隔離。 |
| Baby Buddy MCP、BabyTracker、UNICEF Bebbo | 沿用舊研究作來源線索；本包不採用、不安裝、不重新核查全部依賴。MCP 寫入工具、另一後端底座、原生／CMS 範圍均不是 S02 最小工程所需。舊 LICENSE 或版本結論不當作未來複製授權。 |
| CareLoop、BreastfeedingTracker | PLAN 保留的設計候選；當前沒有要搬入的模組，故不擴大搜尋或聲稱已核實版本／許可。 |

未採用程式碼與未核實程式碼均不進入交付。日後若出現具體復用需要，再核對指定版本、檔案、許可與修改範圍。

## 最小工程固定候選

官方 [Expo 模板 manifest](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/templates/expo-template-default/package.json) 與同版本 [bundledNativeModules](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/packages/expo/bundledNativeModules.json) 提供 SDK 57 相容組合；npm 官方精確版本的宣告許可、gitHead、integrity 與 URL 保存於 [EV-S01-W01](../artifacts/verification/S01_W01_CHECKS.json)。integrity 是 registry metadata，並非本包已下載驗證 tarball。

| 候選與精確版本 | 許可及固定來源 | 採用邊界 |
|---|---|---|
| expo-template-default 57.0.26 | scoped manifest 明示 0BSD；目錄無獨立 LICENSE，不能把 repo MIT 當模板本身的許可 | 只參考官方版本組合；不複製模板程式碼或素材 |
| expo 57.0.24、expo-router 57.0.22 | [MIT](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/LICENSE) | S02 的 Router／Web bootstrap 依賴 |
| react／react-dom 19.2.3 | [MIT](https://github.com/facebook/react/blob/v19.2.3/LICENSE) | S02 Web runtime |
| react-native 0.86.3 | [MIT](https://github.com/react/react-native/blob/95cffbff2e071e278987c7d7cd51fbc970dd5622/LICENSE) | 共享 UI 必要 runtime；不代表 Android 已驗收 |
| react-native-web 0.21.0 | [MIT](https://github.com/necolas/react-native-web/blob/3c27decd16e1cc62736e33d4458372b42f186f42/LICENSE) | S02 Web adapter |
| typescript 6.0.3 | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/LICENSE.txt)／[第三方聲明](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/ThirdPartyNoticeText.txt) | S02 typecheck，保留上游 notices |
| @types/react 19.2.2 | npm 精確版本宣告 MIT；實際套件 LICENSE 留 S02 安裝時核對 | S02 開發依賴 |
| better-auth 1.7.5 | [MIT](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/LICENSE.md) | S06-W03 再安裝／驗證 |
| PostgreSQL 18.6 | [PostgreSQL License](https://github.com/postgres/postgres/blob/724edf9bde9d356724ad384a2e196edc3c9f80f7/COPYRIGHT) | S06-W03 再安裝／驗證 |
| pg 8.23.0 | [MIT](https://github.com/brianc/node-postgres/blob/df274d1ba9ad9d11a8f1079314faeafde7208207/LICENSE) | S06-W03 的 PostgreSQL 直連候選 |

本機 Node `24.11.0`／npm `11.6.1` 已讀取；符合已查 SDK 57 的 Node 22.13+ 基線及 RN／Metro 的 Node 24.3+ 分支範圍。最終 lockfile、完整間接依賴及可啟動性留 S02 實測；不選浮動 `main` 中的 SDK 58 preview，也不混入 TypeScript 7。固定版本是可重現核查點，並非未來升級禁令。

## 後續落地要求

S02 僅建立 Web 最小工程、實際使用的共享輸入驗證／契約及部署時可配置入口。套件以精確直接版本及 lockfile 固定；模板示例頁面、圖片、字型與無關 native 模組不一併搬入。Server／身份套件留 S06-W03 安裝和驗收。

首次實際採用時保存上游 LICENSE、套件內個別聲明與修改清單，更新 THIRD_PARTY_NOTICES；本包不將候選列成已交付相依。依賴新增或升級在其工作包核對，不以 S01 完成免除後續核查。

本包後評估結果：暫保留 OPEN_SOURCE_REUSE 原路徑及原文；其歷史身份與現行決策已由入口區分，本次不新增 archived-in-place 或搬移，故不修改歸檔索引。
