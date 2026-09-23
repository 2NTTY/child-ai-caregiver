---
name: node-postgres-encryption
description: 修改 Node Server 的 AES-GCM 業務儲存、密鑰檔案、既有明文升級或 PostgreSQL 加密備份／空庫還原時使用；不適用純 UI、產品 prompt 或完整跨環境遷移。
---

# Node／PostgreSQL 加密與備份

適用 Node 24 node:crypto／PostgreSQL 18；最後核對 2026-09-23。官方資料已核對，Node 24.19.0 的必要 crypto 單元通過；本包真 DB 升級／還原仍待獲准驗收。專案決策及操作看 [架構](../../../docs/ARCHITECTURE.md#section-3-2)、[P1 操作](../../../docs/P1_STORAGE.md)，不在本 Skill 複製產品範圍。

- 使用 raw random 32-byte AES-256 key、每次新 12-byte nonce、明確 16-byte GCM tag；AAD 綁版本及記錄歸屬，不能只加密而不驗證。隨機 IV 不保證絕無碰撞；同 key 呼叫量須受控，不跨長期無限沿用。[Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)、[NIST GCM](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- 先 setAAD，再 update／final；加密 final 後取 tag。解密必須提供相同 AAD／tag，**final 成功前不得把 update 的明文交給業務或還原程序**；損壞、錯 key／context 固定失敗，不 fallback 明文。[Node decipher](https://nodejs.org/docs/latest-v24.x/api/crypto.html#decipherfinaloutputencoding)
- key 與資料、備份分離；POSIX mode 不代表 Windows ACL。秘密不進 argv、bundle、日誌或一般備份。舊資料升級須交易／鎖／回滾及驗證內容一致；新程式拒絕未完成升級，DB 拒絕舊明文寫入。
- pg_dump custom archive 可用 stdout／pg_restore stdin；它是一個 database 的一致快照，不包含 cluster globals。固定相容 major，不能用較舊 pg_dump 備份較新 server，不假定可還原到較舊版本；退出碼及 warnings 都要檢查。[pg_dump 18](https://www.postgresql.org/docs/18/app-pgdump.html)
- 還原使用真正空目標、完整認證後的 archive、single-transaction（含 exit-on-error）；不以 clean/create 覆蓋使用中 DB。stdin 不搭配 parallel jobs。no-owner/no-privileges 改變 owner／ACL，目標權限須另核對。可信加密不消除來源 SQL 的執行風險。[pg_restore 18](https://www.postgresql.org/docs/18/app-pgrestore.html)
- 真 DB 驗收要證明既有內容／關聯不變、新寫入可讀、錯 key／tamper 拒絕、空目標恢復及身份可用；純 crypto 單元或 archive 清單不能代表完整恢復。遵守 AGENTS 的真 DB／高成本驗收批准邊界。
