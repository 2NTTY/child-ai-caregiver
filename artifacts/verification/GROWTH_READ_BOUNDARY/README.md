# Growth 讀取邊界的局部驗證

在 repository root、已有 lockfile 對應依賴及 Node 24.19.0 下，可重跑以下命令。配置已隨本 PR 提交，沒有改根 typecheck 設定。

```sh
node node_modules/typescript/bin/tsc --project artifacts/verification/GROWTH_READ_BOUNDARY/tsconfig.json
node node_modules/typescript/bin/tsc --project frontend/tsconfig.json
node --experimental-transform-types --experimental-test-module-mocks --test tests/growth-read-boundary.test.ts tests/growth-policy.test.ts
node --experimental-transform-types --test frontend/scripts/qa-growth-candidates.test.mjs
```

本次以既有 `yuban-qa-deps:9c088c8` image 的 `/app/node_modules` 執行，Docker network=none；`src`、`server`、`tests`、`knowledge`、`frontend`、根 `tsconfig.server.json` 及本證據目錄均 bind mount 唯讀。沒有下載新依賴、瀏覽器、API／DB／模型或通知呼叫。最後四份 `review-*.log` 記錄確切 Node 命令與 exit code。

`tsconfig.json` extends 根 Server 配置，保持其所有 compilerOptions；只界定 include 為 Server、shared 與 Growth tests。本次通過不代表完整 Server typecheck 通過。

## 完整 Server typecheck 的歷史對照

`typecheck.log` 與 `typecheck-baseline.log` 是首個修復版本（後來提交為 `b31f10f`）的對照。後者沿用同一離線 mount workspace，只用 `01c25a4333ea5f046e29172801fc53e6d507d2b3:server/growth-store.ts` 的 Git blob 覆蓋 container 內該單一檔案；新增 Growth test 等其他檔案仍在。因此這是 **單一檔案替換對照，不是 pristine master checkout 的全量驗證**。兩份輸出的 11 個前端 NodeNext／erasableSyntaxOnly diagnostics 相同；由根 Server 配置納入的 `child-selection.test.ts` 引入前端模組。此限制未修，本次 UI 補正沒有再跑完整 Server typecheck。

`typecheck-initial.log` 保留首次缺 frontend mount 的 harness 失敗；`baseline.log` 保留修復前預期失敗；其餘原始 log 未改寫。所有資料及錯誤均為合成 fixture；shallow UI 測試執行真候選 renderer，但沒有驗瀏覽器布局、焦點或正式接線。
