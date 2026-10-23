# 檢查、審核及限制

## 最終定向整合

**15 unique scripts／144 PASS，0 fail／skip**。每個script只按30最後bytes計一次，不加上29的159、作者15／40／7或重播數。來源hash及每份原log的SHA-256見[checks](receipts/checks.json)。

| Script | Pass／tests |
|---|---|
| `agent-activity-layout.test.mjs` | 21/21 |
| `care-agent-pending-composition.test.mjs` | 10/10 |
| `care-conversation-review.test.mjs` | 16/16 |
| `care-focus-refresh.test.cjs` | 18/18 |
| `care-history-return-focus.test.cjs` | 10/10 |
| `care-saved-record-card-presentation.test.mjs` | 5/5 |
| `contact-form.test.mjs` | 7/7 |
| `growth-timeline-markers.test.mjs` | 5/5 |
| `history-card-presentation.test.mjs` | 6/6 |
| `history-empty-cards.test.mjs` | 6/6 |
| `memory-source-display.test.mjs` | 10/10 |
| `metadata-hierarchy.test.mjs` | 4/4 |
| `metadata-reading-presentation.test.mjs` | 4/4 |
| `preparation-layout.test.mjs` | 6/6 |
| `task-read-copy.test.mjs` | 16/16 |

## 審核與保留的失敗

- 三renderer metadata包來源審核無blocker；作者15項，4個新增回歸對原版4 fail。這是前置證據，不另加進整合144。
- 提案／Care／記憶採review-fixed版本；URL及長值shrink兩項審核紅已修，獨立40/40重播結論保留。不是GitHub required review或整站browser PASS。
- Contact原native渠道回歸0/1，候選7/7；使用真schema resolver及既有API validator的合成值，不是真掛載表單或通知驗收。
- 30首次Care history focus測試因缺AppIcon test port無法載入，首失敗停批。唯一新增port後10/10，原bytes除該行不變，產品未改、原焦點／權限斷言未放寬；原紅log保留。
- 29原兩次test紅、V8 heap失敗、28的137／SIGKILL／130均留各自原包，30不能洗成全綠。

## TypeScript／export

- Full frontend原tsconfig、程序heap768：exit137、Killed、沒有diagnostics，原因未明，**不是TS PASS**。替代雲端Terminal同heap768亦exit137／Killed，9.854秒、RSS842696KiB，沒有diagnostics，inputs／scope前後一致。兩次根因均未知，不推定host OOM。完整TS門檻未通過，不能以preview驗收代替正式全綠。
- Export僅一次：heap384／worker1，exit0，135.301秒；553產品inputs與57scope前後一致。65原始產物、36HTML、72包裝檔，static validator PASS。
- Bundle、archive與build log的實際bytes/hash已為此報核對；沒有重跑產品測試、build或browser來準備文件。

## 不在已驗結論內

30有界browser取證已完成，但Summary仍紅；Tasks1440自然focus未知，Contact僅503安全展示／重試，通知取消未證回焦。29圖及操作不冒充30。仍分開正式API、真模型、真家庭資料、真機、螢幕閱讀器、完整WCAG／全錯誤分支與外部發布。權限、scope、first-error、unknown及原operationId守門不因視覺整理放寬。
