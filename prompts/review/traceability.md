# 需求與模組映射

本表是閱讀索引，不複製業務 schema，也不改動 REQ／AC。案例 ID 的條件與預期見 [cases.json](cases.json)；全部僅作文件靜態審查。

| 現行要求 | Prompt 落點 | 案例 | 後續真實驗收 |
|---|---|---|---|
| [語言／四年齡段](../../SPEC.md#section-1-2)、[體驗](../../SPEC.md#section-1-4) | conversation、chat、domain.profile／care-workflows | C01–C07、C22、C40–C44 | S11、S14、S16 |
| [Server 模型邊界](../../docs/ARCHITECTURE.md#section-3-1)、[工具接口](../../docs/API.md#section-3-3) | identity-and-trust、tool-use、output、contracts | C23–C31、C35–C36、C49 | S06、S11、S13 |
| [輸入確認](../../SPEC.md#req-1-3-05)、[事實](../../docs/DATA_MODEL.md#section-5-3) | capture-confirmation、context-and-privacy | C02–C08、C46–C47 | S05、S11 |
| [聊天](../../SPEC.md#section-5-2)、[摘要／話題](../../docs/DATA_MODEL.md#section-5-4) | memory-maintenance、conversation | C09–C12、C45–C46 | S09、S11 |
| [衝突／終態](../../docs/DATA_MODEL.md#section-4-5)、[在線確認](../../docs/API.md#sync-contract) | context-and-privacy、tool-use、task-intents | C07–C08、C12、C25、C28、C32、C35 | S07、S13 |
| [穩定／近期與時效](../../SPEC.md#knowledge-freshness)、[來源欄位](../../docs/DATA_MODEL.md#section-5-6) | knowledge-answering／maintenance、domain.sources-freshness | C14–C18、C37–C39 | S10、S11 |
| [知識品質 AC](../../SPEC.md#section-10-4)、[freshness AC](../../SPEC.md#ac-knowledge-freshness) | 知識配方、來源引用及契約 | C14–C18、C34、C37–C39、C44 | S10、S14、S16 |
| [外部輸入及照片](../../SPEC.md#section-1-5)、[來源不可信](../../docs/ARCHITECTURE.md#rule-5-5-13) | identity-and-trust、multimodal-input、domain.safety | C13、C19–C21、C50 | S12、S11 |
| [任務台帳](../../docs/DATA_MODEL.md#section-5-5)、[Server worker](../../docs/ARCHITECTURE.md#section-3-5) | task-intents、proactive-run | C22–C23、C25–C28、C36、C45 | S13-W01／W04、S11-W02 |
| [授權投遞](../../docs/API.md#notification-contract)、[新增 AC](../../SPEC.md#ac-server-agent) | authorized-contact、tool-use、domain.care-workflows | C23–C33、C45 | S13-W05／W06／W07、S13-W02 |
| [私隱](../../SPEC.md#section-10-5)、[私人聊天](../../docs/API.md#api-3-4-09)、[刪除](../../SPEC.md#section-5-9) | context-and-privacy、所有資料／外發模組 | C10、C12–C13、C27、C29、C48、C50 | S05、S06、S07、S09 |
| [摘要報告](../../SPEC.md#section-5-8)、[數字計算](../../docs/ARCHITECTURE.md#section-5-8) | summary-report、summary-visit 配方 | C12、C29、C34、C43、C50 | S14 |
| [遷移／恢復](../../docs/ARCHITECTURE.md#section-6-4)、[rollback](../../docs/ARCHITECTURE.md#section-6-6) | tool-use、run-context、能力契約 | C28、C31、C48 | S13-W03、S15、S06-W04 |
| [成本與無空轉](../../docs/ARCHITECTURE.md#section-9-3)、[快取](../../docs/ARCHITECTURE.md#section-9-5) | context-and-privacy、proactive-run、Gemini 接入 | C11、C18、C35–C36、C45 | S11、S16 |

核心與各任務模組的缺資料、衝突、工具失敗、權限、不確定性和確認規則會在组合中同時生效，不要求所有模組各自重複整套常駐安全 prompt。來源政策及育兒限制集中在 `childcare-hk`，案例使用本產品語境但不新增第二領域。
