# 第 74 題｜照顧摘要寫着 180 mL：哪幾筆加起來？

假設今天記了三次餵食：80 mL、約 100 mL，另一次只記已餵，未填多少。180 mL 只是兩筆有數值的合計，其中一筆是約數。第三筆不是零，也不能把合計當成全天奶量。若另有時間不明的記錄，不能當作今天漏了一餐。這裏只比較怎樣查看入數的原記錄和缺項，不補寫或評估奶量。

## 兩個原作者的畫面

**摘要核對-01｜Zoho Analytics：由合計查回原記錄。** 作者圖同時顯示所選日期格及前景明細。按特定格只查該格的來源，與用工具列查看整張表不同。借給家人的是從 180 mL 查只有哪兩筆入了數；不把剩下一筆算成零，也不說畫面可見的幾列已驗算完整合計。

[看 Zoho 作者原圖：同一數字與其明細（需連網）](https://www.zohowebstatic.com/sites/zweb/images/analytics/shopify_pivotvud.png)。[Zoho 官方說明：資料格與整表明細的分別](https://www.zoho.com/analytics/apps/shopify/help/workingwithpivot.html)；[Shopify 的官方產品刊登資料](https://apps.shopify.com/advanced-analytics)；[Zoho 使用條款](https://www.zoho.com/terms.html)。

Zoho Advanced Analytics for Shopify，產品刊登 2021-07-07；示例年份、拍攝日期和版本不可混用，作者未列畫面 build。 作者原圖；未確認有重製授權，只提供外鏈。

**摘要核對-02｜Eniris Unify：合計旁先標缺多少資料。** 在作者明確標為示例的整月報告，先看 360 個入選站中只有 354 個有相關讀數，再看已量到的合計。其餘六個站沒有數，不是零。放到照顧摘要，讓家人同時看到三筆記錄、兩筆有數和其中一筆是約數，不發明應記餐數或比例。

[看 Eniris 作者示例原圖：合計與實際有讀數的範圍（需連網）](https://manual-sofar.eniris.be/api/media/Unify/large-portfolio-20261104/unify-combined-key-figures.png)。[Eniris 官方手冊：完成期的報告及涵蓋情況](https://manual-sofar.eniris.be/en/Unify/reports/creating-reports)；[Eniris Unify 產品與示例說明](https://manual-sofar.eniris.be/en/Unify)；[Eniris 法律文件入口](https://manual-sofar.eniris.be/en/Legal)。

Eniris Unify 英文手冊，2026-11-04 更新；虛構示例，原圖拍攝方式、日期和產品 build 未公布。 作者公開示例；未確認可重發，僅連原圖及原手冊。

## 本輪以 GitHub connector 讀取並固定的 master
 
[55b763cf63f4c7724d7fd87221554d21fc14be9d／PR #688](https://github.com/2NTTY/child-ai-caregiver/commit/55b763cf63f4c7724d7fd87221554d21fc14be9d)。證據來自原始碼，沒有開生產頁、重測或呼叫模型。
 
1. [正式 /summary 概況串接孩子範圍與原記錄路徑](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/screens/SummaryScreen.tsx#L68-L80)；[「最近生活片段 → 查看完整回顧」及不能定位的記錄提示](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/child-overview/ChildOverviewRecentRecords.tsx#L20-L30)；[同孩子的正式摘要、開始日／一日或連續七日／時區，須套用才重讀](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/production/TaskKnowledgeSummaryContent.tsx#L29-L56)；[完整回顧實際承載此摘要，不是只接在舊版預覽](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/production/TaskKnowledgeSummaryContent.tsx#L70-L77)。
2. [特定統計列顯示單位、樣本數、約數、合計或範圍；逐筆列出構成此統計的來源，可點原記錄](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/summary/SummaryRecords.tsx#L53-L71)。[「閱讀時要留意」區分無可歸屬時間、數值不能入統計、該類別沒記錄，不把空白說成零；期間清單有原始依據](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/summary/SummaryRecords.tsx#L75-L96)。[原記錄的事件時間／確認時間／加入時間是不同概念](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/summary/SummaryRecords.tsx#L25-L36)。
3. [後端只按實際事件時間與所選時區歸入期間；時間未明於全個孩子的已掃描記錄計數](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/server/care-summary-policy.ts#L71-L88)。[期間類別計數先於數值篩選、數量未填不入數、不合規數值另計；數量或時刻非精確便列作約數；各指標帶明確來源 ID](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/server/care-summary-policy.ts#L90-L128)。只有指定種類／單位提供合計，不能假設所有指標可加或跨單位相加。沒有量是未提供，不能順手稱為一筆「錯誤數值」。

## 私用版本與驗證

- 私用離線檔：`育伴港選配工作台-74主題-照顧摘要核對-20261119.html`；30,973,838 bytes；SHA-256 `5c23234b1103c590665893bf3fe550040735f041137974a6e2317ece1469f6a4`。保存已交付第 73 題基準 `f727af2dee344b6e43816e3bab13923213fbb046c002fb99e1860a9a9b6a1615` 的全部紀錄與原圖。

- 74 題、151 款。原來的 146 張圖逐張核對；本題作者圖只保留原始連結。頁上不會對作者網站預取、登入、匯出或更改原記錄。

- 已驗證離線結構、內容安全策略、JS 語法以及新版閱讀器的模擬導覽、並看、選擇、複製來源、替換和撤選。未做瀏覽器／真機或產品功能實測；沒有讀取真實家庭資料、調用模型或實際派發事項。本分支只有文字備份，沒有建立 PR、合併或發布網站。
