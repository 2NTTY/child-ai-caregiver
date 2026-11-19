# 育伴港選配工作台｜第 49 頁：帳戶安全，管理登入方式

只比較在同一帳戶新增登入方式及避免移除最後入口。不是合併帳戶或變更家庭成員和孩子資料權限。

- **登入-01｜Plaud 手機登入方式**：[v4.0.x 或以上的完整指南](https://support.plaud.ai/hc/en-us/articles/63429904519065-Sign-in-methods-for-v4-0-x-or-later)、[帳戶與安全原圖](https://support.plaud.ai/hc/article_attachments/63430546808601)、[登入方式原圖](https://support.plaud.ai/hc/article_attachments/63430515782297)。同一清單顯示已連結電郵與可加入的 Apple／Google。原指南於 2026-10-20 更新；截圖細版號未公開。產品記述開啟兩步驗證才會先再驗證、不能移除最後入口；並有其他註冊方式限制，不套作育伴港能力。
- **登入-02｜VPSDime 桌面登入方式**：[原方指南](https://vpsdime.com/knowledgebase/client-area/account/manage-sign-in-methods)、[整頁原圖](https://vpsdime.com/knowledgebase/client-area/account/images/signin-methods-linked.png)。分組顯示已連結、可新增及最近活動；指南說僅剩一種時不准解除，原圖只示範可解除狀態。原指南 2026-07-02 複審；介面版號未公開。未抽取圖中示例電郵。
- 兩張來源只外鏈官方完整頁和圖，不嵌入或重新分發。

## 育伴港對照及範圍
- [現有帳戶設定](https://github.com/2NTTY/child-ai-caregiver/blob/e8198480c270d16a60b7726fc75ee2afcdb6662c/frontend/src/components/account/AccountDataControls.tsx#L35-L55)「本人登入方式」→「連結 Google」→「先驗證本人身份」→另行確認 Google 連結。[合成拒絕及同 UID 規則](https://github.com/2NTTY/child-ai-caregiver/blob/e8198480c270d16a60b7726fc75ee2afcdb6662c/tests/firebase-client-auth.test.ts#L13-L40)與[產品契約](https://github.com/2NTTY/child-ai-caregiver/blob/e8198480c270d16a60b7726fc75ee2afcdb6662c/SPEC.md#req-p4-09)不以相同電郵代替相同 UID 或授權。
- [2026-11-18 Google 交付紀錄](https://github.com/2NTTY/child-ai-caregiver/blob/e8198480c270d16a60b7726fc75ee2afcdb6662c/artifacts/verification/P4_GOOGLE_AUTH_DELIVERY_20261118.json#L46-L68)核實 Web 及 Android 交付範圍，受邀真人、實機各入口續登同一 UID 還待驗；原生 Apple 聯絡及發布按既有團隊條件。本輪沒有使用帳戶、登入、改動登入方式或擴大權限。

## 離線驗證
49 頁、101 款；原有 48 頁及 146 張圖片雜湊不變。23 項離線閱讀器檢查通過。HTML 30,882,787 bytes，SHA-256 `ec4fef456d08ead42fe15b859980cca389d4b719fee29604e77ba7f953261064`。沒有真瀏覽器、登入、PR 或發布；此分支只保存來源文字。
