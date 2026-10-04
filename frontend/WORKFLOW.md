# 前端逐屏工作流程

只管工作次序；領域邊界見 [AGENTS](AGENTS.md)，文件更新目的地見 [根職責表](../AGENTS.md#document-updates)，技術方法見 [Web Skill](.agents/skills/web-screen-delivery/SKILL.md)。

1. 沿 [PLAN#active](PLAN.md#active) 確認包、下一步、版本、範圍及 gate。開工／整合／交付前核對 master、相關 PR／head 與現場差異，不修改其他聊天 checkout。
2. 按功能沿 [P2 UI 清單](../docs/P2_UI_HANDOFF.md)／[專項交接](HANDOFF.md#p2-coverage) 讀必要契約與 client 接點；固定實際核對 commit。本機已同步的原文可用；版本不符時取得固定遠端原文，不默認掃描整套後端。
3. 呈現改動依 DESIGN_SYSTEM；圖片／研究只作輸入，採納取捨才更新規範。用既有元件與 Skill 實作，不複製未有契約的假功能。
4. 只驗本次受影響的畫面／狀態，方法依 Skill；授權、成本及首次失敗停批統一依 [根驗收規則](../AGENTS.md#finish)，不沿用已過時的「全部等 P2 集中」。
5. 交付更新 PLAN 中該包的結果／未驗與證據；只有摘要改變才改 STATUS、接點差異改變才改相關 HANDOFF。不機械更新三件套，不把整段驗收再貼三次。Web 預覽、正式 API、Android bundle／真機分開；merge 按有效使用者授權。

<a id="preview"></a>
## 預覽與既有檢查入口

在 frontend/ 執行：

```powershell
npm ci --cache .npm-cache --no-audit --no-fund
$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path (Get-Location) '.expo-home'
$env:EXPO_NO_TELEMETRY = '1'
npm run web -- --port 8082
```

開啟 http://localhost:8082。檢查命令以 [package.json](package.json) 為準；只選當前必需項，不因本頁列有入口就全跑。固定 export 用既有 Expo CLI serve；本機合成 verify-ui 可選 care／profile／family／tasks／memory／shell／settings／shared／login／deletion／design 群組。用 FRONTEND_VERIFICATION_DIR 指向既有 verification/ 下的本包新 run，保留舊 run；其他瀏覽器／埠依 BROWSER_EXECUTABLE／FRONTEND_PREVIEW_URL。驗證方法及畫面條件見 Skill，不將工具限制當通過。
