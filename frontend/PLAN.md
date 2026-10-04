# 育有方前端單一計劃

本文件是 FE-Wxx 的任務、依賴、下一步及關口入口；STATUS 只作短指路，HANDOFF 只管實際接點。[修改邊界](../AGENTS.md#frontend-backend)／[資訊更新職責](../AGENTS.md#document-updates)。

<a id="active"></a>
## 目前工作包

2026-10-04 提交前核對（PR 更新截至 11:52 UTC）：已合併基線 **master `c51dd52`／PR #83（FE-W36）**。以下兩個 PR 均為 **draft／未合併**，各自從此基線開出；按使用者本次任務選對入口，不另開等價包或同時操作重疊檔案。開工仍須重查 head／PR 與現場差異。

| 活動包 | 觀察版本／入口 | 下一步與未驗關口 |
|---|---|---|
| FE-W37 全站語意動效 | [PR #84](https://github.com/2NTTY/child-ai-caregiver/pull/84)，`dot/fe-w37-motion-system`，`4ecb67b8ab4e247aedbff0b571241f85e50ccde0`；[包範圍](https://github.com/2NTTY/child-ai-caregiver/blob/4ecb67b8ab4e247aedbff0b571241f85e50ccde0/frontend/PLAN.md#目前工作包)／[交接](https://github.com/2NTTY/child-ai-caregiver/blob/4ecb67b8ab4e247aedbff0b571241f85e50ccde0/frontend/HANDOFF.md#semantic-motion) | 先沿 [恢復來源與驗證索引](https://github.com/2NTTY/child-ai-caregiver/blob/4ecb67b8ab4e247aedbff0b571241f85e50ccde0/frontend/verification/fe-w37-motion/recovery-2026-10-04/README.md) 核對重建範圍及新證據，再補受影響的來源捲動、首屏、灰幕／箭頭／跨頁首幀等；系統 reduced-motion 與精確換文逐幀門檻仍不能由手動路徑／舊 run 代替 |
| 首頁資訊與快捷記錄（PR #85，未獲分配 FE-Wxx） | [PR #85](https://github.com/2NTTY/child-ai-caregiver/pull/85)，`dot/home-information-layout`，`5af4027fa3cc8f205c0578f3afe5f75a7badc3e2`；[固定改動](https://github.com/2NTTY/child-ai-caregiver/commit/5af4027fa3cc8f205c0578f3afe5f75a7badc3e2)，啟動原文／細節見該 PR 正文 | 目標是首頁「現在要處理／持續關注」、首頁與右欄的同孩子投影，以及正常 flex 內的手機四快捷；刪除／刷新／首個孩子建立先保持合法選取。瀏覽器 UI、大字體、首屏快捷可達性仍未驗；與 #84 合併後的行為／UI 亦待核對。Android bundle／裝置或恢復 hash 一致都不等於 UI 通過；原生驗收沿本域既有邊界另列 |

- **範圍**：兩包均只改 `frontend/**` 合成介面及所需檢查，不改 Server、正式 App、API 或正式部署；本索引不擴大原包授權。FE-W37 採納規範在固定版本的 [MOTION_SYSTEM](https://github.com/2NTTY/child-ai-caregiver/blob/4ecb67b8ab4e247aedbff0b571241f85e50ccde0/frontend/MOTION_SYSTEM.md)，未合併不能假設在 master。
- **現場／版本**：本次只核對遠端，不接管原執行現場；dirty 清單及最新被測版本仍須向原現場核對。PR #84 回報 native-instant 來源捲動修正尚未包括在 `4ecb67b`；不得把此 head 的結果擴至後續修改。較舊 `e8a653d` 的恢復索引缺檔已由上述新 checkpoint 補入，舊 UI 通過仍只屬各自版本。
- **交叉範圍／gate**：#85 的 AppShell／MobileHome 內容接線與 #84 的 drawer 幾何、startup readiness、timer 邊界重疊；按 hunk 整合並保存兩邊意圖，不能整檔覆蓋。#85 沒有提出合併要求；兩包均保留 draft，直至相關必要證據／review 與當次授權齊備。
- **停止條件**：來源／被測版本缺口、工具限制、首次驗收失敗或超出範圍，按 [根驗收規則](../AGENTS.md#finish) 處理，不繞過環境限制或以重跑無關項代替。

本次文件整理在獨立分支，不修改兩個活動 PR 的源分支。#84 同時改本 PLAN、STATUS、HANDOFF、DESIGN_SYSTEM、MOTION_OPTIONS 與 Skill；合併時保留該包新增內容／證據，依本次職責收斂到正確位置，不能把舊長版整檔覆回。活動包以後在本域 PLAN 原位更新；#85 現有 PR 正文保留為啟動來源，補入本域工作卡後不再兩邊各養一份進度。

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
