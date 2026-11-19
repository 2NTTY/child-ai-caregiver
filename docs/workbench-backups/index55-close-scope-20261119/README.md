# 選配工作台第 42 題：刪除帳戶前先核對影響

- 帳戶-01 DfE：[2023-04-05 官方設計記錄](https://design-histories.education.gov.uk/early-years-child-development-training/helping-users-to-delete-their-accounts)。入口區分個人資料刪除與匿名學習紀錄保留；確認頁提示永久關閉及個人進度遺失，保留取消。兩頁是一款，不代表現行部署。
- 帳戶-02 Mozilla：[公開假帳戶的 Storybook](https://mozilla.github.io/fxa/storybooks/main/fxa-settings/iframe.html?id=pages-settings-deleteaccount--default&viewMode=story)。觀察到原生第一步、有取消、逐項確認後果及停用的繼續；沒有點按任何帳戶控制。四個勾選框並非選擇哪些資料保留。[官方部署索引](https://mozilla.github.io/fxa/storybooks/main/) 本輪標示 2026-11-18 19:56 UTC 的 a3192dc；[同版假帳戶測試來源](https://github.com/mozilla/fxa/blob/a3192dcffbfd21ee76ed6ee399bcdb78f1bab7ea/packages/fxa-settings/src/components/Settings/PageDeleteAccount/index.stories.tsx#L16-L42) 固定，預覽網址本身會更新。

只備份自寫文字及公開來源連結，不含工作台 HTML、截圖或帳戶資料。新版保留原 41 題及 146 張離線圖；新增兩個外部來源連結，不含刪除操作。靜態與選配邏輯通過，未測任何帳戶操作，未發布。