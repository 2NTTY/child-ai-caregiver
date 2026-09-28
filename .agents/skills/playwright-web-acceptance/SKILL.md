---
name: playwright-web-acceptance
description: 修改 Playwright Test 的正式 Web／真 API 瀏覽器驗收、隔離資料、網絡故障注入及清理時使用；不適用前端合成預覽、純計算 unit test 或 Android 原生驗收。
---

# Playwright Web 驗收

適用 @playwright/test／playwright／playwright-core 1.63.0、Node 24；最後核對 2026-09-29。官方 API、npm 版本／Apache-2.0 及本機 --list 載入已核對；真瀏覽器尚未執行，不能把列出案例當作通過。

- 優先沿用現有 fixture／locator／Server 入口，只補必要缺口。用一個 worker、零 retry 及有界 timeout；同一串接流程可覆蓋相依邊界，不為覆蓋率增加矩陣。
- 每次用獨立 BrowserContext 與合成帳號；APIRequestContext 可共用該 context cookies 建立前置。storageState 如需傳遞留在記憶體，不把密碼、token、cookie、真家庭資料寫進 repo、trace 或快照。[Fixtures](https://playwright.dev/docs/test-fixtures)
- 以公開 accessible role／label 定位；斷言可見產品結果及真 API 台帳，避免綁實作細節。保存回應遺失可先 route.fetch 讓真 Server 完成，再 abort 回應；須查原 opId 及唯一資料，不能用 fulfill 的假成功證明真保存。[Network](https://playwright.dev/docs/network)
- 測試 runner 的 workers／retries／webServer 是頂層配置，browser 選項放 use；webServer 不重用未知程序。列出案例時不啟動 fixture／Server，實際執行另受專案批准範圍約束。[Configuration](https://playwright.dev/docs/test-configuration)
- 真 API 範圍限已核對的本機合成庫與專用附件目錄；不自動 migration／清庫，不讀原帳號憑據。終止時只清本輪所建資源並關閉自有 contexts；清理失敗如實保留及回報，不擴大刪除。
- 無關模型／通知／外網停用；trace、video、screenshot 預設 off。缺瀏覽器執行檔時先列明所需下載及範圍，不以自動安裝或換瀏覽器掩蓋未驗。
- 瀏覽器版本、API 真接線、故障路徑及人工驗收分開記證據；Web 不等於 React Native APK 真機。

產品權限及最低案例以 [PLAN](../../../PLAN.md#s16-w05)／[驗收操作](../../../docs/P2_BROWSER_ACCEPTANCE.md) 為準；本 Skill 不新增批准、情景數量或發布門檻。
