# 選配工作台第 45 題：月度用量與對帳：這個月花了多少？

月中想知道「照這個速度，到月底會花多少」，看 A；月底想知道「為甚麼結算金額跟標價不同」，看 B。育伴港的模型呼叫次數、Token 用量、估算費用和已入帳金額是不同的數字；未設定預算也不代表預算是零。選擇只記錄你偏好的報表，不會讀取帳單或調整預算。

## 對帳-01｜Azure Cost analysis

看累計成本圖：截至當日已入帳多少，跟月底預測相差多少？再看下方按服務和地區拆分的費用，找出主要花費。已入帳是目前累計，預測是推算，兩者都不是付款收據。

[完整報表區原圖](https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/3eb2d039ec7b5b3caf752eb5f3c5abb6f4f52941/articles/cost-management-billing/understand/media/plan-manage-costs/cost-analysis.png) · [Microsoft 官方指南：成本分析與預測](https://learn.microsoft.com/en-us/azure/cost-management-billing/understand/plan-manage-costs) · [與原圖同一提交的 MicrosoftDocs 指南](https://github.com/MicrosoftDocs/azure-docs/blob/3eb2d039ec7b5b3caf752eb5f3c5abb6f4f52941/articles/cost-management-billing/understand/plan-manage-costs.md)

圖中月份為 2019 年 1 月；原圖與指南固定在 MicrosoftDocs 提交 3eb2d039。截圖所用介面版本未公開。 Contoso 文件示例，只連官方原圖與說明，不內嵌或重發。原圖顯示報表區，不代表整個入口網站，也不是育伴港帳單。

## 對帳-02｜Google Cloud Cost breakdown

按帳單月份讀瀑布圖：從按標價計算的用量費用起步，逐項看折扣、抵免和稅項怎樣改變最後的金額。適合解釋「差額從哪裏來」，不是月中趨勢圖；結算金額也不能證明已付款。

[完整報表區原圖](https://docs.cloud.google.com/static/billing/docs/images/cost-breakdown-list.png) · [Google Cloud 官方指南：如何閱讀費用拆解報表](https://docs.cloud.google.com/billing/docs/how-to/cost-breakdown) · [Google Cloud 官方說明：比較計費報表](https://docs.cloud.google.com/billing/docs/reports?hl=en)

圖中帳單月份為 2022 年 7 月；連結來自官方現行指南，後續可能換圖。截圖所用介面版本未公開。 官方文件以示例帳戶展示報表區，未交代每個數字如何產生。只連原圖與說明，不內嵌或重發；不是實際收到的帳單或收據。

## 與育伴港的關係

[管理員平台月結](https://github.com/2NTTY/child-ai-caregiver/blob/5ddc68e4b02ae0e9a934cc3f209b634a4ba600fa/frontend/src/screens/AdminScreen.web.tsx#L459-L470) · [個人本月對帳](https://github.com/2NTTY/child-ai-caregiver/blob/5ddc68e4b02ae0e9a934cc3f209b634a4ba600fa/frontend/src/components/model-settings/ModelSettingsView.tsx#L315-L320) · [金額與狀態顯示](https://github.com/2NTTY/child-ai-caregiver/blob/5ddc68e4b02ae0e9a934cc3f209b634a4ba600fa/frontend/src/components/admin/MonthlyFinanceDetails.tsx#L10-L21)

現有程式分開顯示一般／公共知識維護、估算、待對帳、已結算及未設定預算。Google 示例的瀑布圖按帳單月份合計，不是個別發票或付款證明。本備份不讀取實際帳務，也不修改設定。

## 驗證

維持前 44 題與 146 張既有離線圖。共 45 題、93 款（77 款離線、16 款外部原圖）。靜態驗證及 JS VM 選取、改選、撤回測試通過；未做瀏覽器測試。未內嵌第三方圖、未合併、未部署。
HTML SHA-256: `0c28ae0d697115447e22763870805b2af040c4ba3742528cf8bfdd094e3d0d03`。
