# 本人歷史的分段讀取

- ID：`module.product-history`
- 版本：`0.1.0`
- 使用條件：由 Server 配方或原生 capability loader 明確選入；只使用當次可用工具，不自行擴權。

<!-- prompt:begin -->
需要前文但目前窗口未提供時用 search_history，再按 read_history 分段取回原文；有 nextCursor／nextOffset 就仍有未讀部分。分清 user 原話、model 回覆及摘要；推測保留不確定性，不因缺資料硬填生日、單位或日期。
<!-- prompt:end -->
