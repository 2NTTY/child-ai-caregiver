# 切片 B — 下一張最小工作包（backlog 為準）

- Date: 2026-10-29 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1** on origin/master @ 8e86e28e
- Source of truth: **交付包 B（搜索可用切片）** = REQ-001 必要提問／官方檢索／引用／適用核對／交付 + REQ-002 真進度、必要修正與恢復。工程舊標 B0–B4 只係歷史 PR 標籤，唔再當需求次序。
- Auth: CheungHiuTung-2526 only. HOLD merge. No Android / PRIMARY / labels / daily quota / raising AGENT_LIMITS.modelCalls unless user explicitly approves.

## Open PRs that already map（reuse, do not rewrite tips casually）

| PR | Backlog map | Status vs 切片 B |
|---|---|---|
| #262 | REQ-002 §3.3 單純 hi／謝謝短路徑 | partial；寒暄 skip review，未保證唔全載 search |
| #263 | REQ-001 失敗如實 + REQ-002 stop 細節 | partial taxonomy |
| #265 | REQ-002 reviewing 真進度 + soft 審核預留 | partial；hard finish 仍最後 1 call |
| #273 | REQ-002 §5.3／驗收「最後補充失敗」保留來源 | partial；未做 mid-run 來源卡 |
| #353 | REQ-001 收尾計入**初次**審核 + 提早收束 | partial；**修訂／再審仍 opportunistic** |
| #254 | 記憶 wording／propose | **非**切片 B 主線；繼續 HOLD 分開 |

Master tip moved: fd5f432 → df4bfa7 → **8e86e28e**. Open tips may need another merge-align before extend（ops，唔算產品 ticket）。

## OOS this round（backlog 有、但唔係下一張最小）

- Mid-run 來源卡串流（REQ-001「可以先展示已找到的來源卡」；REQ-002 §5.1 來源／資料層）— 較大、牽前端／Owner UI
- 斷線後原 run 查回（切片 B 驗收「斷線查回」；REQ-002 驗收「斷線後原 run 完成」）
- 完整官方搜索主路徑／corpus 覆蓋
- Hard revise＋re-review **同時**硬預留 2 call（會逼 modelCalls=4 天花板；未批准加額前不做）
- 合併任何 open PR；Android；#254 tip rewrite

## NEXT ticket（proposed）

**Title:** 收尾路徑：修訂／再審餘額如實收束（soft revise 指引 + 不足時 hard wind-down）

**Backlog cites（v0.9.1）**

1. REQ-001（體驗／交付，約「收尾規劃」）  
   > 收尾規劃須按當前交付路徑計入初次審核，以及仍允許的修訂／重審與終態交付，不只預留最後一次生成及終態工具。餘額不足時提早有界收束並說明缺項，不讓模型先耗盡再跳過審核

2. REQ-002 §3.5 精準修正  
   > 設定同類拒絕、補查、修正及重審的有界次數與停止條件，預留正式審核資源；相同失敗不能無變更重送到耗盡額度。

3. REQ-002 驗收表「接近收尾餘額及修訂／重審」  
   > 規劃保留該路徑必要 review／revision／re-review 及交付資源；不足時如實收束，不把只剩最後生成的 snapshot 當審核已獲保證

4. REQ-002 §9.1 審核收尾預留（現況缺口）  
   > planningSnapshot 目前只列 1 次生成及可選 1 次終態工具；spendText 與修訂條件仍另需審核及修訂／再審餘額。

**Why this over mid-run source cards**

- 繼續同一條 server budget／delivery-review 閉環，可 unit test，唔依賴 Owner streaming UI。
- #353 已硬預留初次 review；backlog 下一句就係「以及仍允許的修訂／重審」——喺 **唔加高 modelCalls=4** 前提下，唯一誠實最小步係：soft 標明 reviseReserve + 當 review 要求修訂但餘額 < revise+re-review 所需時 **hard 收束**（停止碼優先復用 #263 `delivery_review_budget`，否則 `delivery_review_incomplete`），並保留 #273 來源保留行為。
- 唔假裝已 hard-guarantee 修訂呼叫。

## Branch strategy

- **Prefer:** new branch from **current** `origin/master` @ `8e86e28e`（或更新 tip），cherry-pick／re-apply #353 budget hard-reserve 若尚未入 master，再加本 ticket。  
  原因：#353 仍 OPEN HOLD；master 已前移；獨立 PR 較易審、唔逼 merge #353。
- **Alt (if supervisor prefers):** extend #353 tip after merge-align onto latest master — 同一 PR 延續收尾預算主題。
- **Do not** stack onto #254.

## Implementation sketch（等 go 先寫 code）

1. `planningSnapshot(..., { reserveDeliveryReview })`：保留 #353 hard finish = present+review；另加 **soft** `reserveForRevise.modelCalls`（或 metadata）= 2（revise+re-review）當路徑仍允許修訂；**唔**把 hard finish 抬到 4（避免一開始就 phase=finish）。
2. Delivery-review 路徑：若結果需要修訂且 `remainingModelCalls < 2`，停止並帶明確缺項／預算原因；唔 silently 跳過再審。
3. 停止碼：能則對齊 #263 taxonomy `delivery_review_budget`；否則沿用 incomplete 並喺 plan／PR 註明依賴。
4. 來源：review／budget stop 仍跟 #273 保留仍有效 citations（若本分支未含 #273，行為與 master+#353 一致，PR 註明依賴 #273）。
5. Tests：agent-budget + delivery-review 有界；唔跑真模型／手測 UI 直至批准。

## Acceptance checks

- [ ] planningSnapshot 對 product-interactive 可見：初次 review hard reserve + revise／re-review soft 指引；非 interactive 不變
- [ ] 餘額不足以修訂+再審時提早停止，訊息／stop code 說明缺項；唔耗盡後先跳過審核
- [ ] 未批准下 `AGENT_LIMITS.modelCalls` 仍為 4
- [ ] 單測覆蓋 soft revise metadata、不足收束、非 reserve 路徑
- [ ] PR 正文引用上述 backlog 段落；標 **partial**；OOS 列 mid-run 來源卡／斷線恢復／加額
- [ ] HOLD merge；gh = CheungHiuTung-2526；無 force-push 改寫其他 tip

## Wait

**No product code until Grok Bot / user go.** 本檔只係計劃。若選 extend #353，先做 tip 對齊 master 再動手。
