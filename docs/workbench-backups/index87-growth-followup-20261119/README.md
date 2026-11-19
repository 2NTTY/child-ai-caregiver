# 第 73 題｜成長建議：只記低已知悉，還是約好由誰跟進？

假設你在孩子的關注鏈看到「幼兒遊戲與溝通」的建議。先看為何提示、來源及適用限制。若只是想記低已看過，選「只記錄已知悉」再核對，不會建立待辦。若家人已商量好星期六一起看繪本，才另選建立待辦、明確指定負責人，確認時間及家庭共享後提交。星期六是這個家庭自己排的，不是來源要求。拿不定主意可延後或關閉這一則。已有連結待辦就先看原項，不重複建立；來源失效不照舊建議操作。建立事項不表示家人已收到、已答應或已完成。工作台只比較設計，不建立或派發任何事項。

## 兩個原作者的畫面

**建議跟進-01｜IBM Storage Insights：在原建議上記低已知悉。** 看 IBM 教學的圖 7‑24 及 7‑25：先從建議清單找到一則，詳情說明系統看到甚麼、建議怎樣處理，再選 Acknowledge。作者文件說這是記下已知悉，不是執行畫面上建議的操作。圖中是設備連接，不是育兒指導；可以參考怎樣把『看過這一則』留在原處，不另派工作。

[看 IBM 原書第 164 頁：建議清單和知悉詳情（需連網）](https://www.redbooks.ibm.com/redbooks/pdfs/sg248501.pdf#page=182)。[IBM Redbooks：原書出版資料](https://www.redbooks.ibm.com/abstracts/sg248501.html)；[IBM 作者說明：Advisor 建議及知悉](https://www.ibm.com/docs/en/storage-insights?topic=pro-monitoring-recommended-actions-in-advisor)；[IBM Redbooks 版權與外鏈說明](https://www.redbooks.ibm.com/copyright)。

IBM Redbooks SG24-8501-00，2021-12-17；書頁 164（PDF 第 182 頁），圖 7‑24／7‑25。實際拍攝日期和 UI build 未列。 IBM Redbooks 內的作者畫面。連到原書，不抽取、嵌入或改畫。

**建議跟進-02｜MeazureUp：由原項另開一件跟進。** 先看已提交的檢查報告，再從原條目的 Add Action 進入。最後一張畫面保留所屬條目，另填新事項名稱、日期時間及負責人，有取消和確定。報告已提交，不代表跟進已做；按確定才建立工作。借的是從哪一則來、要由誰做的分工，不是把餐廳巡查內容搬入育伴港。

[看 MeazureUp 原圖：已提交評估的完整頁面（需連網）](https://d33v4339jhl8k0.cloudfront.net/docs/assets/590f525f0428634b4a32ec8a/images/5aa048112c7d3a7549516e83/file-qStYVGAd3f.png)。[MeazureUp 第二張原圖：在原條目選 Add Action](https://d33v4339jhl8k0.cloudfront.net/docs/assets/590f525f0428634b4a32ec8a/images/5aa0493804286374f708a9d3/file-fjv3SQQsLI.png)；[MeazureUp 第三張原圖：期限及負責人的提交前表單](https://d33v4339jhl8k0.cloudfront.net/docs/assets/590f525f0428634b4a32ec8a/images/5aa049a02c7d3a7549516e91/file-YwKHBLrrI2.png)；[MeazureUp 官方說明：從已提交的評估建立事項](https://meazureup.helpscoutdocs.com/article/111-how-to-create-an-action-on-a-submitted-assessment)。

MeazureUp 官方舊版教學，2018-06-04 更新；實際 UI build、拍攝日期未標明，不代表目前版本。 官方教學作者原圖。未見工作台再發布的許可，只連原圖和說明，不嵌入或改畫。

## 固定版本及生產入口
 
本輪透過 GitHub connector 重讀 master 為 [ae32af38308b2f70fd100faa5c1d4db47268fdad](https://github.com/2NTTY/child-ai-caregiver/commit/ae32af38308b2f70fd100faa5c1d4db47268fdad)。以下為只讀原始碼核對，不是部署或運行驗收。
 
- [實際 /growth 頁串接候選元件及去原待辦的路徑](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/screens/GrowthScreen.tsx#L31-L49)；[在「關注鏈」而非「準備單」分頁 render 該元件](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/components/growth/GrowthView.tsx#L78-L83)／[L102–115](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/components/growth/GrowthView.tsx#L102-L115)。prop 名為 previewTools，但正式路由確有傳入及渲染，並不是猜測未連頁的後端能力。
- [成長建議列出具名候選、為何此刻提示，點入詳情](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/TaskKnowledgeGrowthCandidates.tsx#L25-L46)；[顯示來源節錄、版本、適用限制，已連結待辦可另查](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/TaskKnowledgeGrowthCandidates.tsx#L90-L101)。
- [接受預設只知悉、不自動建立待辦，草稿變更就清除確認；建立時核驗負責人及家庭共享](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/TaskKnowledgeGrowthCandidates.tsx#L64-L88)；[知悉／建立／延後／關閉及真正提交的界線；已有連結任務就不可改選新建](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/TaskKnowledgeGrowthCandidates.tsx#L99-L119)。[原始來源有效才能操作，僅 proposed 或 snoozed](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/growth-view-model.ts#L151)。[後端將 accepted 與可選的新待辦處理分開](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/server/growth-store.ts#L122-L146)。後端另有 existing 型別，不代表這張表單讓家長任意選一個既有待辦去連結。
- 「看圖畫書」並非另發明一項產品建議：[幼兒遊戲規則及已確認近況選項](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/server/growth-rules.ts#L10-L16)、[只用核實來源、幼兒遊戲與溝通的建議原文](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/server/growth-rules.ts#L64-L75)。星期六／誰負責是家庭自行安排的例子，並非官方期限或醫療要求。

## 私用版本與驗證

- 私用離線檔：`育伴港選配工作台-73主題-成長建議與跟進-20261119.html`；30,970,879 bytes；SHA-256 `f727af2dee344b6e43816e3bab13923213fbb046c002fb99e1860a9a9b6a1615`。保存已交付第 72 題基準 `17a33f1daa909fccf1042119717ca3144e364b9d00711d4ddfe5d8c2550d16d2` 的全部紀錄與原圖。

- 73 題、149 款。原來的 146 張圖逐張核對；本題作者圖只保留原始連結。頁上不會對作者網站預取、登入、發訊息或建立待辦。

- 已驗證離線結構、內容安全策略、JS 語法以及新版閱讀器的模擬導覽、並看、選擇、複製來源、替換和撤選。未做瀏覽器／真機或產品功能實測；沒有讀取真實家庭資料、調用模型或實際派發事項。本分支只有文字備份，沒有建立 PR、合併或發布網站。
