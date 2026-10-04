# 育有方前端單一計劃

本文件是 FE-Wxx 的任務、依賴、下一步及關口入口；STATUS 只作短指路，HANDOFF 只管實際接點。[修改邊界](../AGENTS.md#frontend-backend)／[資訊更新職責](../AGENTS.md#document-updates)。

<a id="active"></a>
## 本輪交付與下一步

2026-10-04：本輪隔離前端按動效、首頁、私人來源三部分收尾。以下區分程式交付、有界驗證及正式接線；合成預覽不代表正式產品已接通。

| 部分 | 交付位置 | 接續邊界 |
|---|---|---|
| FE-W37 動效及局部畫面修正 | [PR #84](https://github.com/2NTTY/child-ai-caregiver/pull/84) 已合併；merge `117e53dd444e0c451e1cd07801da42d0ea7fcff3` | 包括共用灰幕、頂欄橫向替代 Logo、首頁回頁定位、聊天配色及相關捲動／焦點修正；未驗項不因合併而消失 |
| 助手式首頁與快速記錄 | [PR #85](https://github.com/2NTTY/child-ai-caregiver/pull/85) 已合併；merge `242d9ac4d9bcb5378ee024c0cfc68416550e7284` | Agent 重要事項、持續觀察、側欄待辦分清；拍照只到未送出預覽。正式 feed／上傳／辨識／保存仍待相應接線 |
| 私人來源協助接入 | 本次 `dot/private-source-purposes` 交付；合併狀態以該 PR 為準 | 共用 sources 清單／editor、Agent 協助與人工入口；意向已確認不代表正式接入。接線見 [專項](SHARED_INPUT_HANDOFF.md#assisted-source-management) |

### 接手先看

- **沒有授權中的整體改造包**：使用者要求版型／導航、記錄上拉更多、左下快捷手勢等改造等另行通知；自訂背景持久保存／跨裝置與原生選圖也延後。目前只保留設計與接線安排，不能自行啟動。[設計方向](DESIGN_SYSTEM.md#function-specific-layouts)／[快捷輸入](AGENT_HANDOFF.md#mobile-quick-input-design)／[照片入口](PHOTOS_HANDOFF.md#records-photo-entry)。
- 新任務只讀相關專項；正式 controller／Server／API 接線由原主聊天按已授權工作包承接，沿 [HANDOFF 索引](HANDOFF.md#p2-coverage)，不重新把 fixture 當正式資料庫。
- 只改前端所屬範圍，保留本人／孩子／Server scope、原操作查核、權限及草稿清理。需要接線時，一處注入權威 controller，多處呈現及刷新，不建立重複保存路徑。

### 本輪有效證據與限制

- [v26](verification/combined-source-intake-2026-10-04T14-51Z/cua-v26-checks.json)：私人來源共用 editor、unknown 鎖定／恢復、家庭角色彈窗、普通孩子切換無延遲文字；[v27](verification/combined-source-intake-2026-10-04T14-51Z/cua-v27-initial-position-checks.json)：首次可量度聊天定位及閱讀保位。各結果只適用所列固定來源。
- [v28](verification/horizontal-header-2026-10-04T15-57Z/cua-v28-checks.json)：390／320 頂欄固定 64px、正文起點一致、控制／鍵盤隔離及站內減少動畫。
- [v29](verification/home-chat-visual-2026-10-04T16-18Z/cua-v29-checks.json)／[建置來源](verification/home-chat-visual-2026-10-04T16-18Z/build-checks.json)：首頁孩子區返回置中、主題色值／對比、輸入框重疊與相關有界互動；一次 typecheck／Web export 通過。桌面 1024 截圖保存，1440 fullPage 工具 timeout 不作通過證據。
- **保留差異**：[320px 明確焦點 PageUp 補驗](verification/home-chat-visual-2026-10-04T16-18Z/cua-v29-native-pageup-checks-1641.json) 在雲端沒有離底；使用者於 16:53 UTC 依 320×600 步驟回報本機瀏覽器正常。分開記錄，不推定純工具原因、不改寫失敗，不加猜測性補丁。來源 End 捲動中切換的原失敗與複合過渡未定結果亦保留；完整聊天鍵盤沒有被標為全面通過。
- 連續首幀、首次問候收合接縫、精確曲線、系統媒體 reduced-motion、慢載／失敗網絡、原生／讀屏／真相機及正式 API 等，未由本輪 Web 合成結果證明。孩子切換超過 5 秒提示只有實作與普通路徑證據，沒有製造假的 hold 作成功證明。
- 已核對的 #84／#85 GitHub heads 沒有回報相關 check／status／workflow run；本地與有界瀏覽器證據不稱作 GitHub CI 全綠。舊證據、失敗及恢復歷史保留原 `verification/` 路徑；需要追溯才沿原結果，不預設全讀。

<a id="integration-gates"></a>
## 正式整合及仍未完成的關口

- **Web 視覺／正式接線**：整套使用者確認、正式 controller／session／API、跨頁及必要正式驗收仍未由合成預覽證明。主聊天按 [正式 UI 對照](../docs/P2_UI_HANDOFF.md#chat-handoff) → [專項交接](HANDOFF.md#p2-coverage) 界定接線包；既有 Sxx 後端已完成的能力不重標未實作。
- **Android**：依 [根分工](../AGENTS.md#frontend-backend) 可提前做共用 UI；bundle 只證明建置，P3／APK／真機／權限／鍵盤／讀屏仍按根 PLAN 前置處理。
- **範圍缺口**：真歷史游標／stream／取消／逐句引用、正式身份與 unknown／草稿差異，以及沒有契約的畫面功能，按 [正式移除及接線清單](PRODUCTION_UI_HANDOFF.md) 與 [已記錄差異](HANDOFF.md#contract-review) 逐項重核，不從設計圖片創造 API。

<a id="delivered"></a>
## 已交付範圍與歷史定位

下列是主線已合併的隔離前端範圍索引，**不把未完成的視覺／接線／真機關口標為完成**。逐包範圍、當時狀態和證據見 [固定舊 PLAN](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/PLAN.md)／[歷史索引](../_archive/README.md#frontend-history)，不用全讀後才開工。

| 範圍 | 讀取入口 |
|---|---|
| FE-W01–06 主頁、共用外殼、核心表單及手機共用 UI | [核心接線表](HANDOFF.md#p2-coverage) |
| FE-W07–20 渠道、Agent、照片、模型、私人來源、成長、摘要、聯絡與背景偏好 | [專項交接索引](HANDOFF.md#p2-coverage) |
| FE-W21–31 品牌、登入／響應式、聊天來源／歷史及契約修補 | [舊錨點及指定包](HANDOFF.md#history) |
| FE-W32–35 商業設計研究、閱讀／首頁／工作頁配方 | [設計規則](DESIGN_SYSTEM.md)、[正式接線映射](HANDOFF.md#commercial-rollout) |
| FE-W36 Codex 聊天、引用返回及來源提示 | [交接與指定證據](HANDOFF.md#codex-chat-presentation) |

<a id="fe-w32-design-review"></a>
## 商業方案的採納與接續

原五階段／八張卡是設計輸入；FE-W33–35 已交付共用配方及隔離畫面，正式 adapters 仍由主聊天接續。已採納呈現以 DESIGN_SYSTEM 為準；[DESIGN_REVIEW](DESIGN_REVIEW.md#design-intent) 保留取捨，[原計劃全文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/PLAN.md#fe-w32-design-review) 保留當時範圍。不要重新開啟「建議首包」、把全部提案當已採納，或為同一進度另建卡片。
