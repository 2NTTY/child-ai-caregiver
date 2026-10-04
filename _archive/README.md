# 歷史資料索引

本目錄保存已凍結的 S00 基線、驗證證據及舊版參賽材料。日常工作先讀 [STATUS](../STATUS.md)，再沿所屬領域的 PLAN 當前包（[根](../PLAN.md#active)／[前端](../frontend/PLAN.md#active)），然後只按需要讀現行規格或本索引中的指定資料。歸檔內容不是現行權威；除非核對歷史決定、來源或證據，否則毋須讀取。

下方「S00／早期基線」表的來源 commit 均為 [`25244fb44d8e4464af2c8f9600019a7ed1118d6d`](https://github.com/2NTTY/child-ai-caregiver/tree/25244fb44d8e4464af2c8f9600019a7ed1118d6d)。`fullSHA` 是檔案內容的 SHA-256。已實體歸檔的 Markdown 原文逐位元保持不變；原文內的相對連結須按來源 commit 的目錄結構理解。舊路徑相容頁提供本地歸檔副本及固定 GitHub blob 入口，避免為修正歷史連結而改寫證據。

<a id="recent-history"></a>
## 近期歷史及證據：按問題逐層定位

先找領域／工作包，再讀指定 LOG／EV；歷史不參與現行指令優先次序。原 run、失敗結果與版本不覆寫，未重驗不更新成今天的結論。

| 要追溯甚麼 | 下一層入口／查閱時機 |
|---|---|
| P1 完成與交付 | [PLAN P1](../PLAN.md#phase-1) → [S16-W01](../artifacts/verification/S16_W01_CHECKS.json)／[S17-W01](../artifacts/verification/S17_W01_CHECKS.json)；需要重核 P1 驗收或交付限制時 |
| P2 功能包／總交付 | [PLAN 工作包表](../PLAN.md#roadmap-packages) → 該包 EV；整合讀 [S16-W02](../artifacts/verification/S16_W02_CHECKS.json)，公開展示讀 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json) |
| 本人模型增補 | [S06-W05](../PLAN.md#s06-w05) → [EV](../artifacts/verification/S06_W05_CHECKS.json)，真服務未驗不能由本機檢查代替 |
| 某次決定／實際工作 | [DECISIONS](../docs/DECISIONS.md) 的指定 ADR → 所引用 LOG；WORKLOG 只讀被引用錨點及所需段落，不全讀 |
| 前端畫面／交接／失敗 | [前端歷史定位](#frontend-history)，先選功能或包，再到其既有 verification run |
| 演示素材或早期方案 | [presentation](../presentation/README.md) 的版本身份，或下方 S00／早期基線表；不當作現況 |

<a id="frontend-history"></a>
### 前端：領域 → 指定包 → 原證據

- 功能整合問題：從 [HANDOFF 專項索引](../frontend/HANDOFF.md#p2-coverage) 選相應 `*_HANDOFF`，該文件已有固定契約版本及包證據；毋須全讀其他專項。
- 歷次呈現／失敗：從 [HANDOFF 歷史錨點](../frontend/HANDOFF.md#history) 直達指定包原文，再讀其相對連結的 `frontend/verification/fe-w*/<run>`。固定 GitHub 原文的相對連結會沿同一 commit，不指向今日混合版本。
- 當前未合併包：[frontend/PLAN#active](../frontend/PLAN.md#active) → 固定 PR head 及該包證據；缺檔／dirty 未知就停在缺口，不以舊 run 頂替。
- `frontend/verification/RESULTS.md` 只屬 FE-W01；不作整個前端最新驗收入口。

### 2026-10-04 收斂前快照（Git 保存，不另複製文件）

以下來源均為 `c51dd52e0cdea03b1d412a10d08ac6761e010d9b`；SHA-256 依 Git blob 原始 bytes 計算（不是工作區 CRLF 轉換後檔案）。現在的同名文件已收短，不稱其原位凍結；歷史原文在固定 commit，現行 HANDOFF 保留舊錨點導引。需要本機原文時可用 `git show <commit>:<path>`。

| 原路徑 | 用途／查閱時機／現行替代 | 保存位置 | SHA-256 |
|---|---|---|---|
| `STATUS.md` | P1／P2 歷次現況及驗收敘述；追溯某次「未部署／待集中驗收」的時點；現況看根 STATUS | [固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/STATUS.md) | `a3acffafdf39fe5d563d620c96a3232e1cbc96cfbba785b936f450ad863f898c` |
| `frontend/STATUS.md` | 前端逐包現況、舊 FE-W11 接續及帳號快照；查當時交付報告；現況看 frontend/PLAN#active | [固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/STATUS.md) | `9eca213132cc9cad022e5d2e77cc601bb4d0598141345cfc8a90d7e4230cccbb` |
| `frontend/PLAN.md` | FE-W01–36 範圍、歷史關口及商業方案卡；查具體舊包範圍；現行包及未驗看 frontend/PLAN | [固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/PLAN.md) | `a91611856828d14244afa5eb11f1b9c243eab30e7b486d2e40fd238c9addb4d7` |
| `frontend/HANDOFF.md` | FE-W06–36 詳細交接／演變／失敗及證據連結；由現行 HANDOFF 舊錨點直達指定章節；不預設全文讀 | [固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md) | `05959c0d157a10023ed37719ad8093418776994578c18cd177f7227845b93db5` |

## S00／早期基線

維護時，任何文件移入 `_archive/` 或改為 archived-in-place，必須在同一工作包更新本索引；日常 AI 不直接掃描歸檔，追溯時先讀本索引，再讀指定資料。凍結原文使用 `.gitattributes` 的 `-text` 保護位元組，避免 Git 換行轉換改變下列 SHA。

| archiveID | 內容摘要 | 用途／何時讀 | 原 path | current path | 狀態 | 基線 commit | fullSHA | 現行權威 |
|---|---|---|---|---|---|---|---|---|
| ARC-S00-001 | v1.0 十章完整開發計劃基線 | 核對原始產品、架構、步驟及完成標準時讀 | `DEVELOPMENT_PLAN.md` | [`_archive/s00/DEVELOPMENT_PLAN.md`](s00/DEVELOPMENT_PLAN.md) | 已歸檔；原文凍結 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `86c7eabbe18f9f339730fb2fbaf86f2b29ac5f04a36ea20b5c5a239e958388e4` | [SPEC](../SPEC.md)、[PLAN](../PLAN.md) 及相關現行 `docs/` |
| ARC-S00-002 | S00 逐條遷移映射、來源定位及核對結果 | 追查舊條款遷移落點或 S00 證據時讀 | `docs/MIGRATION_MAP.md` | [`_archive/s00/MIGRATION_MAP.md`](s00/MIGRATION_MAP.md) | 已歸檔；不再是現行權威 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `c2a9c20f8c56cded91fe5b0585ac53c9cec8cea42f45c3aedf440b57c5a14f44` | 各映射目標文件；執行狀態以 [PLAN](../PLAN.md) 為準 |
| ARC-S00-003 | EV-002 S00 獨立只讀核查報告 | 審閱 S00 完整性、權威及核查限制時讀 | `artifacts/verification/S00_AUDIT.md` | [`_archive/s00/verification/S00_AUDIT.md`](s00/verification/S00_AUDIT.md) | 已歸檔；歷史驗證證據 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `4a06d83554ae042110bff79a750f323eddc398c9b3444057b22bf724e4442c66` | 不屬規範權威；現行狀態見 [STATUS](../STATUS.md) 及 [PLAN](../PLAN.md) |
| ARC-LEGACY-001 | 舊版產品提案、香港來源及驗證假設 | 查閱早期研究、競品及參賽構思時讀 | `PROJECT_PROPOSAL.md` | [`_archive/legacy/PROJECT_PROPOSAL.md`](legacy/PROJECT_PROPOSAL.md) | 已歸檔；legacy | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `b62a7e6f6f4c56a71e7d5d337c670ce5132e2016448f2a87ffe48a5c9c2206b8` | [SPEC](../SPEC.md) 與 [DECISIONS](../docs/DECISIONS.md) |
| ARC-LEGACY-002 | 舊版參賽簡介、演示及答辯草稿 | 查閱歷史演示敘事或問答素材時讀；不可當作已實現證據 | `PITCH_AND_DEMO.md` | [`_archive/legacy/PITCH_AND_DEMO.md`](legacy/PITCH_AND_DEMO.md) | 已歸檔；legacy | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `2d37d7c55c202aa3bc7eaa281b62e8dc590e9e0528efc467d78726dc4849ed95` | 實際交付狀態以 [STATUS](../STATUS.md)、[PLAN](../PLAN.md) 及真實驗證證據為準 |
| ARC-LEGACY-003 | 四人每週 Log 與證據模板 | 查閱早期團隊記錄模板時讀 | `WEEKLY_LOGS.md` | [`_archive/legacy/WEEKLY_LOGS.md`](legacy/WEEKLY_LOGS.md) | 已歸檔；legacy | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `b685fbae1d60495f5a6b15ab7ba66a4aa94de23118f92a3565bdb9d63da8ce06` | 實際工作記錄以 [WORKLOG](../WORKLOG.md) 為準 |
| ARC-S00-IP-001 | EV-001 S00 機器核對摘要 | 核對 S00 自動檢查結果時讀 | `artifacts/verification/S00_CHECKS.json` | [`artifacts/verification/S00_CHECKS.json`](../artifacts/verification/S00_CHECKS.json) | archived-in-place；唯一凍結檔，不搬移、不複製 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `e65c5e3bdd2324c528d0446226c7246a8e29246ad083737fc0fd64f6118b7979` | 不屬規範權威；只作歷史驗證證據 |
| ARC-S00-IP-002 | S00 來源單元索引 | 需要機器級來源定位時讀 | `artifacts/verification/S00_SOURCE_INDEX.json` | [`artifacts/verification/S00_SOURCE_INDEX.json`](../artifacts/verification/S00_SOURCE_INDEX.json) | archived-in-place；唯一凍結檔，不搬移、不複製 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `97d8c2fed3124ee33883ae6e5931f110a4410eedd013ef08821955f2a2db5f4a` | 不屬規範權威；只作歷史來源索引 |
| ARC-S01-RESEARCH-001 | 已有開源候選與授權研究 | 只在追溯早期候選、license 或來源時讀 | `OPEN_SOURCE_REUSE.md` | [`OPEN_SOURCE_REUSE.md`](../OPEN_SOURCE_REUSE.md) | 歷史研究、原位凍結；2026-10-04 確認保留，無須搬移 | `25244fb44d8e4464af2c8f9600019a7ed1118d6d` | `6cdd461f045ece714152509fe00bb0ec5221a9e99c9f274e7a0ebcf5a289485c` | [DECISIONS](../docs/DECISIONS.md)／[TECH_REUSE](../docs/TECH_REUSE.md#decisions) 的正式採用決定 |

## 固定來源入口

- [DEVELOPMENT_PLAN.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/DEVELOPMENT_PLAN.md)
- [docs/MIGRATION_MAP.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/docs/MIGRATION_MAP.md)
- [artifacts/verification/S00_AUDIT.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/artifacts/verification/S00_AUDIT.md)
- [PROJECT_PROPOSAL.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/PROJECT_PROPOSAL.md)
- [PITCH_AND_DEMO.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/PITCH_AND_DEMO.md)
- [WEEKLY_LOGS.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/WEEKLY_LOGS.md)
- [artifacts/verification/S00_CHECKS.json 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/artifacts/verification/S00_CHECKS.json)
- [artifacts/verification/S00_SOURCE_INDEX.json 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/artifacts/verification/S00_SOURCE_INDEX.json)
- [OPEN_SOURCE_REUSE.md 原版本](https://github.com/2NTTY/child-ai-caregiver/blob/25244fb44d8e4464af2c8f9600019a7ed1118d6d/OPEN_SOURCE_REUSE.md)
