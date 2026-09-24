---
name: postgres-resource-access
description: 修改 PostgreSQL 業務資源授權、成員角色、撤權與交易內寫入時使用；不適用純 UI、模型提示詞或身份供應商設定。
---

# PostgreSQL 資源授權

適用 PostgreSQL 18、Node 24／pg 8；最後核對：2026-09-24。官方鎖與 READ COMMITTED 行為已核對；鎖後授權、唯讀角色及拒絕路徑的輕量測試通過，本包真資料庫結果見 S06-W02 驗收證據。

- 登入會話只提供身份。每次資源操作由 Server 核對目前成員關係、操作角色及目標範圍；請求中的 userId、角色或預期版本不構成授權。
- 需與撤權協調時，以同一穩定父資源作鎖定順序：業務操作在交易持 FOR SHARE，角色／撤權更新持 FOR UPDATE。取得父鎖後，另起同一交易的查詢核對成員關係；不可先從舊 statement snapshot 讀角色，再等鎖後沿用。READ COMMITTED 每個 statement 重新取 snapshot；鎖定讀等候後可能取得新版本，不能假定 joins 的其他資料也一併更新。[交易隔離](https://www.postgresql.org/docs/18/transaction-iso.html)／[row locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)
- 保持短交易，先授權再讀寫，commit／rollback 後 release。同一父資源按一致順序鎖定；不要在持鎖期間呼叫模型、通知或使用另一 connection 等待同一資源，避免死鎖／耗盡 pool。跨資源批次先定義固定順序，不自行加無限重試。
- 撤權前已完成的讀取無法從裝置收回；撤權後的新操作須拒絕。長時間生成及回傳敏感衍生結果前重查，不能以之前讀到的角色或模型 session 代替。客戶端收到失效／不存在需清除相應頁面快取及草稿。
- 加密 AAD 用穩定的資料歸屬與原作者，不因換成另一位有權讀取的成員而改用當前 caller。共享資料的讀取權不能延伸到同一資源下其他人的私人資料。
- 單元檢查證明應用分支及鎖後核權順序；真 SQL、並發及持久結果仍需獨立批准的本機驗收。用合成資料，保持既有資料與 migration checksum；禁止把 fake Pool 成功當作 PostgreSQL 證據。

產品角色及權限以 [API](../../../docs/API.md#p2-family-permissions) 為準；現有 [family-access helper](../../../server/family-access.ts) 可按需要復用。此 Skill 不另定產品角色或邀請政策。
