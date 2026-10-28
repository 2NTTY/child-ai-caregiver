# 切片 B — 下一張：答案前先展示來源卡（mid-run source cards）

- Date: 2026-10-29 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1** · origin/master @ 8e86e28e
- Chosen per supervisor order: **(1) mid-run source cards** ahead of disconnect recovery and revise hard-reserve.
- Auth: CheungHiuTung-2526. HOLD merge. No Android / PRIMARY / labels / daily quota / raising modelCalls.

## Ticket title

**答案前先展示來源卡（mid-run source layer；partial）**

## Backlog quotes

**REQ-001 §5.3 檢索與生成**

> 可以先展示已找到的來源卡與原文入口，再交付核對後的整理答案；來源命中不等於個別建議已獲核實。

**REQ-002 §5 分階段交付 → 來源／資料層**

> 權限及展示檢查通過後，先顯示已取得的來源卡、標題、可確認日期與有界原文片段。清楚標示「已找到／已讀取」，不等同「此來源適用於你的孩子」或正式建議已獲核實。

**REQ-002 驗收「來源先到、答案仍審核中」**

> 來源卡不冒充已核准建議；必要適用條件及求助訊息不被延後隱藏。

**REQ-002 實施次序「3．驗證分階段交付」**

> 先做可安全顯示的來源卡；只有量測與審核契約證明可行，才增加獨立核准答案部分及後續詳情

（對照：#273 對應嘅係 REQ-002 **§5.3 後段失敗時保留**已取得來源，唔係答案前 mid-run 展示——唔 extend #273 當本 gap 嘅 owner。）

## Branch plan

- **New branch** from current `origin/master` @ `8e86e28e`（或更新 tip）：建議名 `cursor/slice-b-midrun-source-cards`
- **唔 extend** #254／#262／#263／#265／#273／#353：無一張 PR tip 擁有「答案前串流來源卡」主責；#273 只係 fail 後保留 citations
- 本計劃 branch `cursor/slice-b-backlog-next-plan` 只放計劃 md；產品實作另開上述新 branch
- HOLD merge；手測 UI 前停低交過目

## Scope（等 go 先寫 code）

1. 成功 `search_knowledge`（或同等已取得、通過權限／展示檢查嘅來源）後，喺正式 `present_answer`／delivery review **之前**，經既有 feedback／progress 通道發出可展示來源卡事件（標題、可確認日期、有界原文入口／片段、來源身份）。
2. 卡片語意：**已找到／已讀取**；唔標「已核實適用於你的孩子」；唔把未審草稿升格為正式答案。
3. 「來源先到、答案仍審核中」：審核中／失敗時來源卡仍可按契約保留顯示；與 #273 fail-retain 對齊但唔要求先 merge #273（若行為重疊，PR 註明相容）。
4. 最小 server＋既有 SSE／feedback 契約優先；大改前端視覺／全套來源庫管理（REQ-006）OOS。

## Out of scope

- Disconnect／原 run 恢復（supervisor 次序 2）
- Hard revise／re-review reserve（次序 3；#353 後仍 optional）
- 合併任何 open PR；加高 modelCalls；Android；#254；完整 corpus／整站同步

## Acceptance checks

- [ ] 有成功檢索嘅 interactive care run：答案／審核完成前，客戶端可收到至少一組達展示條件嘅來源卡事件（單測或契約測優先；真 UI 手測另批）
- [ ] 卡片唔冒充已核准建議；未審正文唔因出卡而變成 formal reply
- [ ] 審核仍進行中時，來源卡與「答案未核准」狀態可並存（對照驗收「來源先到、答案仍審核中」）
- [ ] 後段 review fail：唔清空已達展示條件嘅來源（相容 #273 意圖；若本分支未含 #273 邏輯，至少唔倒退 master 行為）
- [ ] PR 正文引用上述 backlog 段；標 **partial**；HOLD merge；CheungHiuTung-2526；無 force-push 改其他 tip

## STOP

**等 Grok Bot / user go 先寫產品 code。** 本檔只係計劃。
