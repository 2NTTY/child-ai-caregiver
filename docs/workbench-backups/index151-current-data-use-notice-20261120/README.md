# 選配工作台第 133 頁：電郵已驗證，為甚麼還要確認資料使用說明？

- **A｜同頁先讀完整說明。** [緬因州 DHHS 官方手冊第 14 頁](https://www1.maine.gov/dhhs/mecdc/sites/maine.gov.dhhs.mecdc/files/S3%20Merchant%20Link%20Mobile%20App%20Farmers%E2%80%99%20User%20Guide%20.pdf#page=14)左上完整手機畫面有正文、修訂日、未勾方格、下一步與登出。
- **B｜先看開通進度，再進完整說明。** [英國教育部官方案例](https://design-histories.education.gov.uk/dfe-identity-account/account-created-scenarios)分開帳戶已建立與服務未開通。借用進度與下一步的安排，不借資格審核；育伴港這個整頁是提案。

只比較開啟帳戶門檻的環境。電郵已驗證但仍未確認目前版本；[勾選不等於提交](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/components/account/AccountCallbackGate.tsx#L19-L45)，離線或版本不符不能確認，須以[服務回傳](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/AccountServiceOwner.ts#L194-L201)為準。也可登出；確認說明不授權通知或分享。工作台不接受條款、不更改真帳戶，只外連原圖。

## 重建與檢查

- 前 132 頁不變。133 題、269 款，其中 173 款只外連；保留 165 張既有圖。
- #132 HTML SHA-256 `cf5e91c86d333850d817b64f71770dfbd86d40df67cb56765617747bb2b1b36a`；`python append133.py baseline132.html spec133.json output133.html`。
- HTML 34,443,685 bytes，SHA-256 `34fbe59753ed011342b0be1e1529a4d9698f2ee474b59353336f20fe5ba2c01d`；ZIP 22,792,742 bytes，SHA-256 `884f43be39c83fec34339e3b89f02f3ab10271ea0cfc1f9a5160b29d67fe0931`。
- 離線核對，未執行真實開通；未更新網站、主分支或四方案。
