---
name: better-auth-account-lifecycle
description: 接入或修改 Better Auth 電郵驗證、密碼找回、註冊資格、會話撤銷及其 SMTP hook 時使用；不適用家庭成員邀請、普通通知或 UI 設計。
---

# Better Auth 帳戶生命週期

適用 Node24、Better Auth1.7.5、pg8及Nodemailer10.0.16（MIT-0）。最後核對2026-10-08；官方文件及安裝版本source已核對；Node24.11／PostgreSQL18.6的原生註冊、驗證、找回及會話撤銷已以本機SMTP實測，真郵件供應商未驗；官方網站顯示1.7.7，不因此自動升級或假定所有新API可用。

- 使用原生驗證／找回／password verify／session revoke，不另存密碼hash或重造token流程。requireEmailVerification、sendOnSignUp、sendResetPassword及revokeSessionsOnPasswordReset是獨立選项；核對回應與既有session是否真的撤销。[Email](https://better-auth.com/docs/concepts/email)／[Email-password](https://better-auth.com/docs/authentication/email-password)／[Sessions](https://better-auth.com/docs/concepts/session-management)。
- Better Auth已支援validateUserInfo及database hooks；註冊资格是業務規則，hook只接回Server權威。版本1.7.5的sign-up在原生transaction內建立user/account並呼叫verification hook，database create.after會在transaction後排入callback。另開Pool的SQL並不共享該交易；向未commit的user插入FK資料可互等，不能靠file型別通過當作原子性。[Hooks](https://better-auth.com/docs/concepts/hooks)；核對node_modules/better-auth/dist/api/routes/sign-up.mjs及db/with-hooks.mjs。
- 電郵callback不要等待外網投遞；可交既有持久queue，固定郵件內容、token期限及合法同源目的地。若outbox在原生user提交前建立，consumer須核user仍存在及用途有效；rollback留下的郵件不外發。一般回應不洩漏帳號是否存在，logger不輸出完整request／URL／SMTP錯誤。
- Nodemailer使用TLS或requireTLS的STARTTLS及正常憑證驗證、有限連線／socket期限；不要把secure=false誤當成禁止加密。disableFileAccess／disableUrlAccess、單接收者、關閉debug；未知SMTP結果不能盲重發。accepted只代表SMTP接收，不是已讀。[SMTP](https://nodemailer.com/smtp)。
- Native deleteUser可以依password或fresh session執行，但不自動涵蓋產品附件、job、key及備份還原邊界。業務清理與身份核對責任要明確，不能讓另一個原生端點繞過產品刪除收據。
- 最低驗證連貫覆蓋註冊資格→驗證→登入→找回後舊會話失效及必要隱私界線；本機capture或fake transport不能冒稱真收件箱送達。

產品政策及邀請／資料退出契約見[API](../../../docs/API.md#p2-a08-service)，本Skill不複製當前包進度或營運配置。
