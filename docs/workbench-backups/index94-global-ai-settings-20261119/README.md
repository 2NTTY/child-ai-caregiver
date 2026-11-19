# 選配工作台第 80 題：全站 AI 設定

管理員先看正在生效的版本，再核對未保存的表單。告警是通知，不是停止；軟目標引導助手預留收尾，不是通知門檻；硬上限限制嘗試次數，不保證供應商停止計費。顯示的軟目標按已保存版本算，一般設定適用於新一輪；暫停平台 AI 在下次模型呼叫前生效，不撤回已存結果。這裏沒有更改任何設定。

- **全站設定-01 Google Cloud**：[2026-10-14 BigQuery 作者文章](https://cloud.google.com/blog/products/data-analytics/using-bigquerys-generative-ai-cost-management-features)、[列表圖例](https://storage.googleapis.com/gweb-cloudblog-publish/images/1_dxxy8WS.max-2000x2000.png)、[修改圖例](https://storage.googleapis.com/gweb-cloudblog-publish/images/2_7NmvWbT.max-2000x2000.png)、[配額說明](https://docs.cloud.google.com/docs/quotas/view-manage)。可比較先核對生效配額，再送出新值；官方說明與圖例連結已核對，未驗完整原圖的所有可見欄位。BigQuery 規則不是育伴港行為。拍攝日期與 build 未標。
- **全站設定-02 AWS Budgets**：[2020-10-16 作者文章](https://aws.amazon.com/blogs/aws-cloud-financial-management/get-started-with-aws-budgets-actions/)的門檻畫面把警示／通知和另行附加執行動作分開；[現行指南](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html)仍列動作為選用。舊控制台圖例，不用它推定助手次數和帳單。兩款均只連原作者，不嵌圖或轉載。

[育伴港生效設定、軟目標、告警及保存流程](https://github.com/2NTTY/child-ai-caregiver/blob/9cba3fe86d3d0fd0a167ede792dbf7a4bc7e26d0/frontend/src/screens/AdminScreen.web.tsx#L243-L301)。與第 14 題個人模型／憑證及第 45 題費用對帳不同。

80 題、163 款，原有 146 張圖不變；離線驗證跳轉、焦點、並排、選擇與連結版次的複製／移除。未操作正式網站、Google Cloud/AWS 帳戶、模型或付費資源。HTML SHA-256：`155c8b94a563dc76f11140b562284e050da52c64cb80a735d834f8fc1cb21e61`。獨立分支純文字備份，無 PR、無合併、無發布。
