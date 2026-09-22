# 育伴港簡報來源

13 頁、16:9、香港繁體中文。這份簡報介紹未來產品方向，實現現況由獨立 snapshot 提供。所有圖形只是視覺 source，未接入產品。

## 修改入口

| 要修改甚麼 | 改哪裏 |
|---|---|
| 一頁文案／speaker notes | `content.json`，用 `deck.json` 的穩定 slide ID 定位 |
| 目前階段、實現／驗證、Demo URL | **只改 `project-status.json`**；更新查核日期、Git SHA 及證據，不以未合併分支代替現況 |
| 各階段顯示的狀態 | 同一 status 檔的 `phaseLabels`、`mixedPhaseLabel` |
| screenshot | status 檔 `demoScreenshots`，路徑相對 presentation；null 保留明示 placeholder，截圖只用合成資料 |
| 換一張 SVG | `deck.json` 的 `asset`，指向 `../assets/`；SVG 內容在各自 source 修改 |
| 頁序／刪頁／新增頁 | `deck.json` 的 slides；加穩定 ID 及 content，選已有 layout；新排版才修改 `slides/layouts.mjs` |
| 字體／全套字号／留白 | `theme.json` 的 font、fontScale、fontSize、spacing.margin |
| 整套主色 | theme 的 palette；assetPalette 是原 SVG 顏色的映射基準，通常不要改它 |
| 單頁位置或特殊字級 | `slides/layouts.mjs` 對應 layout，文案仍保留在 content |

資訊圖保留完整獨立 SVG。PPT 以原生 picture crop 隱藏圖內標題，避免與可編輯 slide title 重複；`deck.json` 的 crop 可調整或移除，沒有改寫原圖。

`project-status.json` 固定為實際核查的基線，build 不自行讀其他 worktree 或追最新 master。`已確認／已設計` 不等於 `已實現／已驗證／已完成`。階段路線是方向，不能當作現況。

## 重建

需要 Node.js 24+，以及 Codex 提供的 presentation runtime 和 Presentations skill。毋須安裝產品依賴或改 root package／lockfile。

```powershell
npm --prefix presentation run build
npm --prefix presentation run check
npm --prefix presentation run preview
```

預設輸出：`output/yuban-gang-project-deck.pptx`。build 先在 `.build/run-*/` 生成、嵌入 SVG、驗證及重新匯入，全部通過後才替換正式 generated output；失敗保留原成品及可恢復的中間檔。

工具預設解析目前使用者的 bundled runtime 路徑，沒有硬寫 Windows 使用者名稱。若其他機器不同，先由 Codex 呼叫 `load_workspace_dependencies`，設定：

```powershell
$env:RUNTIME_NODE_MODULES = '<bundled node_modules 絕對路徑>'
$env:RUNTIME_PYTHON = '<bundled Python executable 絕對路徑>'
$env:PRESENTATION_SKILL_DIR = '<已安裝 Presentations skill 目錄>'
$env:PRESENTATION_BROWSER = '<可供 headless 預覽的 Chromium 或 Edge executable>'
```

這裏使用 bundled `@oai/artifact-tool`（本輪 2.8.59）、Sharp、Playwright、Python 標準庫及 Presentations finalizer。Artifact Tool 是 Codex 提供的 private package，不承諾可從 public npm 安裝。沒有 API key 或網絡模型請求。預覽使用新的暫存 browser profile，不讀取使用者登入狀態。不要把 desktop LibreOffice 當 fallback；如使用 LibreOffice，只能使用 `load_workspace_dependencies` 明確提供的 bundled executable。

可在不改正式 source 的情況下試驗：

```powershell
node presentation/scripts/build.mjs --status presentation/.build/example-status.json --output presentation/.build/example.pptx
```

另支援 `--content`、`--theme`、`--deck`。所有 output 必須留在 presentation 內。改完後重跑 build、check、preview；不要把只在 PowerPoint 手動修改的成品當成 source of truth。

## 可編輯性與驗證邊界

標題、正文、數字、狀態及 Demo 槽是真正 PowerPoint 文字與 shape。圖像同時嵌入 SVG vector 和 PNG 相容 fallback。插圖及資訊圖內的文字在 SVG source 編輯；不是把整頁做成 screenshot。

本機 Artifact Tool 的 PNG renderer 連空白頁亦退出，未確定根因。因此 preview 從**最終 PPTX**抽取實際文字、圖片、原生 crop 及座標，以 Edge 渲染並逐頁檢查；此 renderer 僅支援本簡報使用的基本文字、矩形和圖片，不是通用 PowerPoint renderer，也不等於桌面 PowerPoint 開啟驗收。新增圖表、旋轉、動畫或複雜形狀時須另加適合的 renderer，不能沿用既有預覽通過結論。

`check` 檢查 SVG 安全／結構、PPTX ZIP/XML、頁數比例、原生文字、notes 和 SVG 嵌入；finalizer 另外檢查 package、版面幾何、指定字體及 Artifact Tool 重新匯入。`preview` 檢查中文字 overflow、SVG 文字 bbox，輸出每頁 PNG 和 contact sheet；仍須目視檢查設計及語義。

## Source 與 generated output

- Source：JSON、`slides/`、`scripts/`、`../assets/*.svg` 及圖片提示詞；都納入版本控制。
- 正式 generated output：`output/*.pptx` 及交付預覽，納入本視覺分支。
- 暫存：`.build/` 的候選、重建試驗、HTML、逐頁 PNG、工具 reports，全部忽略。
- 本輪驗收、6% CRITICAL 停止記錄及主進度交接：`HANDOFF.md`。它只記本視覺工作包，不更新 PLAN／STATUS／WORKLOG。

素材總覽在 `../assets/index.html`。SVG 的 PNG 匯出用 `npm --prefix presentation run export:assets`；執行 preview 後，以 `npm --prefix presentation run catalog` 更新總覽、圖片 manifest 及 `output/previews/`。六張生活插畫在 `../assets/images/`，提示詞獨立保存在 `../assets/image-prompts.json`。
