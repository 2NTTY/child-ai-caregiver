# 選配工作台第 138 頁：打開重設密碼的電郵連結，密碼就改好了嗎？

- **A｜先填表，再指引登入。** [Microsoft CMT 的完整重設表單原圖](https://cmt3.research.microsoft.com/docs/help/general/images/request-password/reset-password-page-from-email-link.png)及[官方流程](https://cmt3.research.microsoft.com/docs/help/general/request-new-password.html)。參考欄位及返回入口，不搬 CAPTCHA、密碼字元要求或一小時期限。
- **B｜用獨立頁說清結果。** [OCPS 的完整成功頁原圖](https://myid.ocps.net/documentation/images/sspr_reset_07_success.png)及[官方流程第 6、7 步](https://myid.ocps.net/documentation/#using-self-service-password-reset)。只參考成功後明確返回登入，不搬短訊驗證。原圖均外連；核對日期及版本界線見 `spec138.json`。

開啟連結不等於已修改或已登入。兩次新密碼要相符；只有服務確認成功才報已改，之後仍要正常登入。未確認就保留重新要求指引的出口，不自動重送。使用合成示例，沒觸發重設、登入或任何帳戶寫入。相機候選另保留，未計入本版。

## 重建

- 前 137 題和原執行碼不變；本版 138 題、279 款，其中 183 款只外連，保留 165 張既有圖。
- SHA-256 為 `67c69bfb27bb7fbf48a6bf181da35a0236d37e2311bc4ffe258829d3d2be4ff6` 的第 137 頁 HTML：`python append138.py baseline137.html spec138.json output138.html`。
- HTML 34,477,899 bytes，SHA-256 `424126a50fef12f33447137f010bb998551fb84a02a6ab2eacf1669d4726f7c0`。
- ZIP 22,801,390 bytes，SHA-256 `8cfdbf6b816fcc5f151baf32bda73ddc1f6014878426de3baa83c60ec2b115f3`；`zip-proof.py` 可驗證與還原。
- 獨立備份，沒有更新網站、原項目或主分支。
