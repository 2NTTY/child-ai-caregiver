# 育有方前端單一計劃

本文件是 FE-Wxx 的任務、依賴、下一步及關口入口；STATUS 只作短指路，HANDOFF 只管實際接點。[修改邊界](../AGENTS.md#frontend-backend)／[資訊更新職責](../AGENTS.md#document-updates)。

<a id="active"></a>
## 目前工作包

2026-10-04 核對：主線文件整理已合併至 `37625d0`；兩個前端包仍為 draft／未合併，原始程式基線為 `c51dd52`。下列遠端 head 與本地新增實作分開；開工及提交前重查，不能把合成預覽當正式接線。

| 活動包 | 固定遠端／範圍 | 下一步及關口 |
|---|---|---|
| FE-W37 語意動效 | [PR #84](https://github.com/2NTTY/child-ai-caregiver/pull/84)，`dot/fe-w37-motion-system`，`fa696d60ef390383ddf049b4dfba54bd2069e81a` | Web 灰幕純視覺退場、圖片 paint 前尺寸已有有界結果；按最新要求改手機頂欄為原高度內橫向替代 Logo，該新增來源待補驗；保留 draft。来源 End 捲動中切換仍未通過，桌面表單最初跳動尚未完整捕捉；不能以 route 位移尾段解釋全部現象 |
| 助手式首頁及快速記錄 | [PR #85](https://github.com/2NTTY/child-ai-caregiver/pull/85)，`dot/home-information-layout`，`5af4027fa3cc8f205c0578f3afe5f75a7badc3e2` | 使用者已改為一按拍照交助手、文字補充、表單退為補改；第一區獨立 Agent 重要事項，第二區持續觀察、側欄保留待辦。本地前端邊界及合成流程已實作，最終 UI 待驗；正式重要事項 feed、圖片辨識／記錄、語音及背景處理尚未接通 |

- **範圍與授權**：只改 `frontend/**`、必要規範／Skill 及既有位置的驗證紀錄。使用者批准 dot 雲端有界合成檢查、公開測試站及向 #84 推送動效程式／相關規範；首頁另在 #85。沒有真 Server／模型／通知／家庭資料操作，不建立 Work／Codex 任務；推送不等於准予未驗收合併。
- **證據**：恢復來源沿 [既有索引](https://github.com/2NTTY/child-ai-caregiver/blob/fa696d60ef390383ddf049b4dfba54bd2069e81a/frontend/verification/fe-w37-motion/recovery-2026-10-04/README.md)。正確整合 v22 的[首頁／灰幕有界檢查](verification/combined-home-motion-2026-10-04T12-35Z/cua-v22-checks.json)已完成，對應[來源與產物證據](verification/combined-home-motion-2026-10-04T12-35Z/provenance-corrected-build-checks.json)；錯誤 Metro 快取產物 v21 不作正確來源驗收。後續新增源碼須補受影響檢查，不能沿用 v22 的通過。原始結果留各 `verification/` run；本表只記下一步，不複製流水帳。
- **後續有界結果**：[v24 優先補驗](verification/combined-followups-2026-10-04T13-42Z/cua-v24-priority-checks.json)確認灰幕退出互動、減少動畫資料列終態及手機軸協調；其[固定來源／產物](verification/combined-followups-2026-10-04T13-42Z/coordinated-final-build-checks.json)不包含之後的 profile 位置錨點及 32px 輸入框重疊，後者仍待補驗。
- **當批補驗（2026-10-04 15:24 UTC）**：[v26](verification/combined-source-intake-2026-10-04T14-51Z/cua-v26-checks.json) 通過私人來源共用 editor／unknown 鎖定與恢復、家庭角色彈窗及普通孩子切換無提示文字；[v27](verification/combined-source-intake-2026-10-04T14-51Z/cua-v27-initial-position-checks.json) 首個可量度聊天樣本在底部，閱讀保位／回到最新／End＋多行回歸通過。這是固定合成整合版有界結果，不代表獨立分支或正式接線全面通過。初次 Expo 環境失敗與同源碼修復建置保留在 [build-checks](verification/combined-source-intake-2026-10-04T14-51Z/initial-position-build/build-checks.json)。
- **頂欄有界補驗（2026-10-04 16:10 UTC）**：[v28](verification/horizontal-header-2026-10-04T15-57Z/cua-v28-checks.json) 的 390／320 Home、chat、profile 頂欄均 64px、正文起點均 101px；孩子選擇、資料箭嘴、鈴鐺／側欄、快速反向及隱藏層鍵盤隔離正常；站內減少動畫首個可量度樣本已 settled。[固定來源建置](verification/horizontal-header-2026-10-04T15-57Z/build-checks.json) 通過。連續中间幀、精確曲線、系統偏好與原生未驗。使用者後續指出首頁孩子資訊塊返回時跳動，屬新待定位問題，不由此終態檢查推定不存在。
- **首頁與聊天配色（2026-10-04 16:37 UTC）**：[v29 有界結果](verification/home-chat-visual-2026-10-04T16-18Z/cua-v29-checks.json) 確認 390／320 返回首頁孩子區按容器置中，實際聊天色值／32px 輸入框重疊符合本批來源；[建置及来源](verification/home-chat-visual-2026-10-04T16-18Z/build-checks.json) 通過。320 PageUp 停穩檢查未達預期，仍在區分焦點／工具與跟隨邏輯，不能標通過；原複合過渡及未捕捉連續幀保留。桌面 1024 截圖已存，1440 fullPage 的工具 timeout 不作畫面通過證據。
- **320px 鍵盤關口**：[明確焦點補驗](verification/home-chat-visual-2026-10-04T16-18Z/cua-v29-native-pageup-checks-1641.json) 中，普通點擊後確認聊天 viewport 為焦點，再送一次 PageUp，首個／停穩樣本仍離底 0px；不能只歸咎 locator focus。現有工具沒有 keydown／default action 回執，未判明事件輸送、原生 default 或跟隨反制，沒有加入猜測性補丁。相關 adapter／hooks 在本批配色前後未改，不足以認定配色或首頁回歸。雲端此關口保持未通過；使用者於 2026-10-04 16:53 UTC 依提供的 320×600 手動步驟回報本機瀏覽器沒有問題。這是使用者端手動結果，不改寫雲端失敗，也不足以斷言純工具原因；保留環境差異，不加入猜測性補丁，按使用者既有收尾／推送／合併授權繼續交付。
- **未驗**：系統媒體 reduced-motion、連續首幀／精確曲線、受控慢載／失敗網絡、文字放大及原生／讀屏／正式 API 等未被有界 Web 結果證明。手動偏好、自然暖載、Android bundle 各只代表自己的範圍。
- **接合**：#84／#85 的 AppShell、手機首頁及部分入口按 hunk 保留兩邊意圖；文件以主線精簡結構為底，動效方法／新交接留正確位置，不恢復舊長版文件。外部文件 PR 已合併，不再當待合併阻塞。
- **停止條件**：首次失敗先保存必要證據、查因及局部補驗；來源不明、工具限制或超出原授權依 [根驗收規則](../AGENTS.md#finish) 處理。

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
