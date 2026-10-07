# 舊根功能測試前端歸檔

來源 commit：`0a39e018dc138b29a437ab52679866e3bfcc0378`。本目錄保存已被新正式前端取代的23份原始檔案；逐檔原路徑、bytes及hash見同目錄的實際歸檔manifest。`.snapshot` 檔逐byte保留，不參與Router、TypeScript或測試探索，也不聲稱可直接執行。

## 現行入口

正式Web使用 `frontend/app` 和 `frontend/src/production`。共用 `src/client` controller、API、權限及收據仍為現行程式；不能因舊Panel歸檔一併刪除。根legacy Web/build/test指令及預設舊Playwright設定明確停止，不轉跑其他測試冒充舊驗收。

## 保留能力與資料

FamilyPanel及Emergency能力未等價搬入新UI，保留待處理，並非無用功能。舊單份準備的 `/summary?tab=legacy-preparation`、API、資料表、歷史和原操作恢復仍保留；沒有刪除、遷移或自動複製家庭資料。

## 恢復或比較

以指定source commit建立隔離checkout，使用該commit的相容依賴及合成測試資料；或按manifest把snapshot還原到原相對路徑並先核hash，再檢查同版依賴。不要在現行正式工作樹盲目覆蓋或把過去browser pass當現行測試。原相對imports按舊目錄結構解讀；查歷史不代表重新啟用舊入口。
