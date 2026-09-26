# 四人 AI 協作與 GitHub 交付流程

本文件集中維護人類成員分工、署名身份及交付操作；核心規則見 [AGENTS](../AGENTS.md#team-contributions)。只在分配工作包、準備署名或交付時按需讀取。

<a id="baseline"></a>
## 適用基線與簡化原則

- 文件由最新 `master` 的 `1e6d0f78114f772ea805868f384fc13ebfc0a79f`（PR #38）建立；流程自 2026-09-26 起用於後續交付，舊歷史不改作者、不補簽、不倒算比例。
- 使用者已簡化原簽署方案：重點是 GitHub 歷史清楚呈現四人的責任與功勞，沿用現有帳號，不新增 SSH／GPG 金鑰、不安排逐人登入或獨立 CLI 環境、不更改帳號及全局認證設定；unsigned 只照實報告，不阻塞正常交付。
- 人類 A／B／C／D 與主模型／Luna／Sol、前後端聊天是不同維度；本流程不擴大聊天修改範圍、不啟動功能包或改前置。沿用 [聊天分工](../AGENTS.md#frontend-backend)及 [PLAN 驗證制度](../PLAN.md#verification)。
- 歷史 WORKLOG 保留當時事實，其早期分工不取代本流程的未來責任安排。普通 Git 核對只在當前對話回報，不因此更新 STATUS／WORKLOG 或新增進度台帳。

<a id="ownership"></a>
## 分工與貢獻計算

四人共用同一套 AI，由 A（使用者）統一管理 Codex 與 GitHub 操作。比例是團隊約定的程式開發分配，不是 GitHub 統計或實測工時。

| 成員 | 約定開發比例 | 責任方向 |
|---|---:|---|
| A（使用者） | 40% | 核心 Agent 架構與行為、提示詞、工具定義與實作、工具編排、記憶／RAG 的 Agent 接線 |
| B | 25% | Web／App 介面、客戶端業務功能、跨端互動及平台接線 |
| C | 25% | Server API、身份與家庭權限、資料庫、加密儲存、交易與一致性、背景 worker 及部署 |
| D | 10% | S13-W06 Telegram 通知作中等功能候選；測試執行、人工驗收及 PPT 另外記錄 |

A 負責 Agent 如何理解、決策及使用工具，包括模型可見工具協議與提示詞；C 提供底層 Server 業務服務、授權及持久化。跨層接口由 A 統籌責任分界，再按實際參與記共同責任。

D 的 Telegram 功能包含綁定、授權／撤銷、發送／回應、錯誤狀態及相關測試，沿用 C 的 Server 基礎，Agent 工具接線歸 A；前置仍為 [S06-W02](../PLAN.md#s06-w02)／[S13-W04](../PLAN.md#s13-w04)。沿用最新 [S13-W06](../PLAN.md#s13-w06) 的 grammY 候選、去重及 unknown 驗收，不另行改框架或提前開工。

- 每包開始前，AI 建議主要負責人、共同參與者、責任範圍、驗收人及 1／2／3／5 級相對開發權重，交 A 確認；共同責任份額合計 100%。
- 約定比例與已完成加權分配分開。後者為已驗收包的「權重 × 個人份額」加總，再除已驗收包總權重；沒有已驗收包時標未有資料。估重只供規劃，範圍實質改變才修訂並說明原因，不冒稱實測貢獻或工時。
- 功能所需的自動化測試程式跟隨該功能包；D 額外的測試執行、人工驗收及 PPT 不計入開發分母。透過後續適合的工作平衡比例，不用 commit 數、行數、空提交或拆碎 PR 湊比例。
- 署名依實際參與、成果認領及 A 確認的團隊分工；有共同完成的改動才列共同作者，不因比例或 A 管理所有 AI 就自動四人全掛名。記錄共用 AI 與 A 代操作，不描述為四人各自手寫程式或親自執行測試。

<a id="identity"></a>
## 成員身份

以下只記 GitHub 可用的署名資料，不保存密碼、token 或私鑰；帳號邀請、提交 email 關聯及 Verified 是不同事項。

| 成員 | GitHub username | 提交 email／noreply | 確認狀態 |
|---|---|---|---|
| A | `2NTTY` | 沿用目前 Git 身份，不更改全局 email | 使用者確認 A；GitHub API 身份已核對 |
| B | `CherylNg-2526` | `230520362+CherylNg-2526@users.noreply.github.com` | A 已確認角色；noreply 按 GitHub ID 格式，實際提交關聯仍須核對 |
| C | `WongWingHo-2526` | `230520282+WongWingHo-2526@users.noreply.github.com` | A 已確認角色；邀請待接受，實際提交關聯仍須核對 |
| D | `CheungHiuTung-2526` | `250016155@stu.vtc.edu.hk` | username／email 由 A 確認；GitHub email 關聯待相關提交核對 |

2026-09-26 已查 GitHub：`CherylNg-2526`（ID `230520362`）與 `CheungHiuTung-2526`（ID `230520630`）已加入並有 write 權限；`WongWingHo-2526`（ID `230520282`）有待接受的 write 邀請。其公開 profile 沒有 email，不能由邀請成功推定學校 email 已綁定。

署名名稱預設用已確認的 GitHub username。B／C 採 GitHub 的 ID 型 noreply 格式，記錄並核對實際 GitHub 識別結果；D 優先用 A 指定的學校 email，若無法關聯到 D 帳號，報告後再改用已確認的 noreply，不為修正舊提交自動改寫歷史。C 的待接受邀請不代表其作者身份無效，但不能宣稱 C 已具備直接操作此私人 repo 的權限。

<a id="attribution"></a>
## 簡單署名方式

- **共同改動**：主要負責人作 Author，訊息正文後空一行，按實際參與加入 `Co-authored-by: Name <account-associated-email>`；相同成員不重複列為主作者及共同作者。
- **獨立改動**：用 `git commit --author` 明確指定相應組員的姓名及 email；A 代操作時保留 A 的真實 Committer，不輪流修改全局身份，不造假日期。
- **PR**：預設由 A 用現有帳號建立，說明主要負責人、共同責任、AI 協助及 A 代操作；PR 建立者會顯示 A，這與 commit 作者歸屬分開。若成員之後本人開 PR，按實際帳號記錄；不為分配功勞冒稱 PR 是其他人建立。
- **開 PR 前**：用 `gh api user --jq .login` 核對實際帳號，使用既有登入即可；不把登入成功當成作者或簽署已通過。
- **簽署**：已有可用簽署則沿用，沒有就按現況提交，不新增金鑰；若既有簽署配置報錯，先報告原因再處理，不自行更改帳號／全局配置。

共同作者格式例子（占位資料不可直接用於提交）：

```text
Implement the agreed feature

Co-authored-by: Member Name <member-associated-email>
```

<a id="delivery"></a>
## 每包交付步驟

1. **分配**：按本文件的責任方向，由 AI 建議本包主要負責人、共同參與者、估重、份額及驗收人，交 A 確認；不把尚未完成的工作記為貢獻證據。
2. **實作**：沿用正常工作包、前置及驗收要求，保留實際需求、決策、修改與確認的證據。
3. **提交**：獨立工作指定該組員 Author；共同工作加入實際共同作者，Committer 按 A 的實際操作保留。核對訊息及署名後正常提交，不為分配比例增加無內容 commit。
4. **PR**：A 統一推送並建立 PR，列明 `Owner / co-authors / responsibilities`、`AI assistance / operated by A`、`Validation / actual executor / evidence` 及未驗項；正文使用英文。
5. **合併前核對**：直接查 GitHub，本包全部新增開發提交的作者／共同作者、PR 建立者與預期相符；簽署照實分類，不以 unsigned 作交付阻塞。署名錯配／漏署或查詢缺項要明示，不能宣稱歸屬已核對成功。
6. **合併後核對**：預設 Merge commit，另查正式合併 SHA、合併者及目標分支；原開發提交與合併提交分開回報。新增提交或 head 改變後重新核對新增及受影響部分。

<a id="remote-audit"></a>
## GitHub 遠端核對

使用既有 `gh api`／GraphQL 唯讀查詢，不增加認證服務或例行輸出完整 diff、簽名 payload。

| 對象 | 核對方式及欄位 |
|---|---|
| PR | `GET /repos/{owner}/{repo}/pulls/{number}`：建立者、head／base repo 與分支／SHA、state、merged、merged_by；已合併時才採用正式 `merge_commit_sha` |
| 全部開發提交 | GraphQL `pullRequest.commits(first:100, after:cursor)`，依 `pageInfo` 讀完所有頁，與合併前預期新增 SHA 集合比較 |
| 每個提交 | REST `GET /repos/{owner}/{repo}/commits/{sha}`：Author／Committer 原值與 GitHub login、trailer、`verification.verified/reason/verified_at` |
| 已識別共同作者 | GraphQL 每個 `Commit.authors(first:100, after:cursor)` 獨立完整分頁，比對已確認參與者；有 trailer 文字而未關聯正確帳號，標為歸屬待修正 |
| 簽署身份 | GraphQL `Commit.signature` 的 `isValid/state/signer.login/wasSignedByGitHub`；`null` 為沒有簽名，不推定為已驗證 |

- 合併前保存本次 base SHA、head SHA 及 `git rev-list --reverse <base-sha>..<head-sha>` 的新增集合，排除目標分支已有歷史；目標分支推進時重算。合併後復用合併前集合，避免用已含 head 的 base 重算成空集合。
- PR 提交與作者名單都完整分頁；REST PR commits 有 250 個上限，不能只用 `--paginate` 便當全部讀齊。查詢錯誤、缺頁、SHA 不符或 head 變動須標未完成核對。
- 分支內本機 merge 仍屬開發提交；正式 PR 合併提交按 PR 回傳關係識別，不只按 parent 數判斷。未合併 PR 的 merge SHA 可能只是測試合併結果，不當成正式交付。
- API 簽名驗證與網頁徽章分開：`verified=true` 只描述簽名，不能證明工作量或全部共同作者的同意；vigilant mode 可能令徽章顯示 `Partially verified`。未讀到徽章就標「網頁徽章未核對」，不推定畫面。
- `unsigned`、`Unverified`、`Partially verified` 及查詢／服務失敗各自照實報告，不混為同一結果，也不因此新建金鑰或重做帳號設定。

交付報告在當前對話附核對時間與 GitHub 連結，分開列出：

```text
PR: URL | creator | head/base | state | merged by
Development: SHA link | author | committer | recognized co-authors | signature status/reason
PR merge: SHA link | signer | signature status/reason; or not merged
Observed badge: Verified / Partially verified / Unverified / no badge / unchecked
Attribution mismatches / unrun checks / next action:
```

<a id="evidence"></a>
## D 的額外貢獻證據

| 工作 | 必需證據 |
|---|---|
| 測試執行 | 被測版本／SHA、案例、實際執行者、結果、失敗及重測紀錄 |
| 人工驗收 | 驗收清單、被驗收版本／SHA、D 的實際回覆與日期；沒有回覆不代填通過 |
| PPT | 可編輯來源、交付版本、D 負責內容及審閱紀錄 |

證據連到相應 PR 或正式交付物。AI 機器檢查與 D 親自執行的驗收分開；A 代轉錄時標示原執行者與回覆來源。有實質測試程式、報告或 PPT 改動才建立相應 commit／PR，不以角色分配代替完成證據。

<a id="verification"></a>
## 核對情境及已知樣本

下列是規則的預期結果，不表示新成員署名已全部實測；在正常交付驗證，不製造空測試提交。

| 情境 | 預期結果 |
|---|---|
| 獨立工作 | GitHub Author 對應負責成員，Committer／PR 建立者按真實操作顯示；PR 說明列出責任 |
| 共同工作 | GitHub 作者清單識別全部已確認共同作者，沒有多掛或遺漏 |
| email 未關聯／成員對應不明 | 標示待確認／歸屬待修正，不把文字署名冒充 GitHub 已識別帳號 |
| unsigned／簽名無效／服務不可用 | 分別如實報告，保留正常交付及產品驗收要求；不新設簽署門檻 |
| Partially verified | 簽名結果及部分驗證徽章分開，不寫成完整 Verified |
| 新增提交／head 變動／缺頁 | 重新核對新增及受影響範圍；未讀齊不報全部已查 |
| 開發 unsigned、PR 合併有效 | 分列兩者，不能報整個 PR 的開發提交全部已驗證 |

已核實樣本：[PR #37](https://github.com/2NTTY/child-ai-caregiver/pull/37) 開發提交 `fa995ac05efcabcb968b2d1fc410e61b9a4a7ad7` 為 `verified=false/reason=unsigned`、`signature=null`；正式合併提交 `80cf50c08ee044e734d2463fe9a22ae30eeb786d` 為 `verified=true/reason=valid`、簽署者 `web-flow`。此為舊樣本，不代表本次或其他成員的提交已核對。

署名錯誤在推送前修正；已推送才發現時，先報告具體 SHA 及影響，不自動 amend／rebase／force-push，也不為湊比例改寫舊歷史。GitHub Merge commit 保留原提交；Squash 不補簽原開發提交，GitHub Rebase 產生新 SHA，因此預設不用這兩者。

<a id="sources"></a>
## 官方依據

2026-09-26 已核對，按需復用；以下是技術依據，不要求新增帳號設定。

- [共同作者格式及 email](https://docs.github.com/en/pull-requests/how-tos/commit-changes/creating-a-commit-with-multiple-authors)
- [提交 email 關聯](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)／[GitHub noreply 格式](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)
- [簽署與 Rebase 限制](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)／[vigilant mode](https://docs.github.com/en/authentication/managing-commit-signature-verification/displaying-verification-statuses-for-all-of-your-commits)
- [合併方式](https://docs.github.com/en/pull-requests/reference/pull-request-merges)／[提交驗證 API](https://docs.github.com/en/rest/commits/commits#get-a-commit)／[PR 提交清單上限](https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request)
