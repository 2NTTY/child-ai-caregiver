# 選配工作台第 78 題：這個電郵還能註冊嗎？

這是網站管理員查核註冊資格的頁面，不是家庭成員邀請。用完整電郵查當事資格，再分辨待使用、已過期、已使用與已撤銷。更改需管理員重新驗證。待使用或過期按原規則處理；已撤銷不能直接重開，已註冊帳戶不會因此停用。產品不自動寄信。沒有運行正式帳戶或變更權限；兩款只供比較。

- **註冊資格-01 FirstTwo**（Administration Guide © 2025，拍攝日期／build 未列）：[原手冊第 3 頁](https://www.firsttwo.com/help/FirstTwo-Administration-Guide.pdf#page=3)對照「未註冊」與「已註冊」兩表，[第 4 頁](https://www.firsttwo.com/help/FirstTwo-Administration-Guide.pdf#page=4)確認核准電郵可作註冊門檻。手冊圖有註解，不能推定搜尋、到期日或續期。
- **註冊資格-02 Microsoft Entra**（[作者說明](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-renew-extend#admin-initiated-extension)更新 2026-04-23，原圖仍標 Azure AD，畫面內日期是示例，拍攝日期／build 未列）：搜尋、對象、首尾期限及同行操作可對比。這是既有身分的角色授權，不能推定註冊資格、電郵所有權或育伴港的寄信行為。[截圖規則](https://www.microsoft.com/en-us/legal/intellectualproperty/copyright/permissions)。兩款均只連原作者頁，不嵌入或重發作者截圖。

產品基準： [管理分頁](https://github.com/2NTTY/child-ai-caregiver/blob/9cba3fe86d3d0fd0a167ede792dbf7a4bc7e26d0/frontend/src/screens/AdminScreen.web.tsx#L195-L238)及[後端狀態守衛](https://github.com/2NTTY/child-ai-caregiver/blob/9cba3fe86d3d0fd0a167ede792dbf7a4bc7e26d0/server/firestore-authority.ts#L556-L577)。[第 51 題](https://github.com/2NTTY/child-ai-caregiver/blob/647ef13931f90d0312210050bc5a1e643835ba5c/docs/workbench-backups/index65-outgoing-invitations-20261119/README.md#L1-L7)是家庭邀請，不是進入網站的註冊門檻。

驗證範圍：78 主題、159 款選擇，原有 146 張圖保留；本題兩款皆為外部唯讀參考。離線腳本驗證第 78 題跳轉及焦點、預設並排、來源與先選後記／移除、選擇清單含版本及原頁連結。不代表真實網站管理操作、瀏覽器畫面或部署測試。HTML SHA-256：`d65b3cfd9989846b50cc2165363faa59de3f3ad52d389422ec3e77d863951e6e`。這是獨立分支的純文字備份，無 PR、無合併、無發布。
