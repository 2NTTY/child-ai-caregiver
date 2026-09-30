# 育伴港配色策略

核對日期：2026-09-30。這份文件記錄使用者參考圖的策略及前端採用理由；色值唯一實作入口是 [theme.ts](src/theme.ts)，品牌來源是 [原有美術簡要](../assets/BRIEF.md)，沒有改動正式品牌素材。

## 研究結論

先復用品牌色，再按用途派生色階，適合本項目。現有八個種子是 ink #203E3A、teal #287568、paper #FAF7EF、sage #DDE8DB、amber #D99A3D、coral #C86D52、white #FFFFFF、muted #60756E。先前問題主要是背景過多淡綠、浮層留下 Paper 預設紫色，以及部分淺底上的次要文字對比不足。

OKLCH 的 L／C／h 分別描述感知明度、彩度及色相，方便有規則地建立色階；「保持 L／C、旋轉 h」只是一種候選色探索方式。它不保證 WCAG 對比、不保證仍在 sRGB 色域，也不決定成功／警告／失敗的語義。補色、圖表分類色或狀態色須先有用途，再檢查實際組合。[W3C CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab)

育伴港本次保持種子色相，調整明度及必要彩度；超出 sRGB 時沿 Culori 的 OKLCH chroma clamp，將結果存成 HEX。React Native 和 Web 共用這些常量，沒有把 CSS oklch() 字串送進原生控制項。[Culori API](https://culorijs.org/api/)、[React Native 顏色格式](https://reactnative.dev/docs/colors)

## 色彩角色與使用範圍

| 角色 | 本次規則 | 原因 |
|---|---|---|
| 畫布 | paper 派生的 neutralSurface #F9F7F3 | 作為內容的中性底，不與主操作爭注意力 |
| 左導覽／頂部欄／右資訊欄 | paper 派生的 quietSurface／sidebar #F6F4EC | 同一常駐導覽區沿用相同底色；品牌暖白 #FAF7EF 留在首頁品牌／海旁美術區 |
| 卡片／彈窗 | 白色；暖灰裝飾分隔 | 讓內容層次來自留白、邊界及字級 |
| 主要操作 | teal；強調入口用同色相較深的 deepTeal | 集中使用綠色標示可操作入口 |
| 文字 | ink 作主要文字；muted 種子降低 L 得到可讀的次要文字 | 小字在暖白及淡色容器上仍可辨讀 |
| 選中／提示底 | 同品牌色的低彩度淺色階 | 選中不靠大面積飽和色或顏色單獨表達 |
| 待確認／結果未知 | amber 淺底配深 warningInk 及明確文案 | 保留兩種狀態的操作差別 |
| 明確失敗 | coral 淺底配深 errorInk 及文案 | 原 coral 作小字時對比不足，需要深色階 |
| 輸入邊界／控制圖標 | controlOutline；一般 SVG 用 muted，選中／主要操作才用 teal | 保留辨識度，減少每個圖標都在強調的感覺 |

深綠、琥珀、珊瑚的種子不互換用途。一般內容維持中性暖白；新增畫面只用既有語義 token，新增色階須有缺口及來源。這與 Material 按語義分配 primary／surface／container 等角色的做法相符。[Google Material 配色指引](https://codelabs.developers.google.com/customizing-material-color)

## 顏色放置與視覺主次

使用者認為色階已改善，但放置仍不順眼。本次保留同一組 OKLCH 派生值，重新分配用途。成熟方案的共通點是讓大部分內容、導航和次要操作使用中性色，再以品牌色及狀態色表達少量明確意義；不是把每張卡片、每個圖標或每個連結都染成品牌色。[Atlassian 色彩角色及強度](https://atlassian.design/foundations/color)、[Carbon 層次與色彩角色](https://carbondesignsystem.com/elements/color/overview/)

- 常駐側欄採較安靜的中性暖灰，主畫布稍亮，資料卡片和彈窗採白色。各區靠留白、邊界及字級區分；不將「增加色塊」當作增加層次。這是沿成熟方案的角色分工作本項目映射，沒有照搬它們的品牌色。[Atlassian elevation](https://atlassian.design/foundations/elevation)、[Material 3 surface／container](https://developer.android.com/codelabs/m3-design-theming?hl=en)
- 頂部欄、窄屏孩子摘要列及原生頂部沿用左導覽的 sidebar 色；內容卡片保持白色，讓常駐導航、主畫布、內容形成穩定層次。Carbon 的淺色主題可交替使用白與 Gray 10，深色主題才逐層變亮；本項目按表面用途映射，不把層次誤當成所有主題都必須單向變亮。[Carbon layering](https://carbondesignsystem.com/elements/color/overview/)
- 主要提交／對話入口使用 teal／deepTeal；次要按鈕、一般連結及孩子摘要用 ink，普通圖標用 muted。選中的導航和有效焦點才用淡青綠容器。
- 首頁品牌美術區保留 paper；手機「今日重點」用 paleTeal，讓其位置有清楚視覺主次。內頁說明、記憶內容、預覽工具維持中性。
- 琥珀只對應待確認／結果未知，珊瑚只對應明確失敗。不同狀態仍須文案與操作區分；「結果未知」不能靠改色變成已知失敗。

以上規則落在 theme 和共用控件；少量內容容器按用途選用現有 token。各頁不新增獨立色盤，也不改業務回調。

## 本次派生參數

以 Culori 4.0.2 轉為 OKLCH，保留種子 h；下表 C「原值」表示沿種子彩度。數值是本次設計記錄，執行中的值仍讀 theme.ts。

| token | 種子 | L | C |
|---|---|---|---|
| deepTeal | teal | 0.43 | 原值 |
| muted | 原 muted | 0.52 | 原值 |
| paleTeal／selectedNav | teal | 0.965／0.94 | 0.016／0.024 |
| neutralSurface／quietSurface | paper | 0.976／0.966 | 0.006／0.010 |
| line／softLine | paper | 0.88／0.942 | 0.010／0.008 |
| controlOutline | 原 muted | 0.60 | 0.018 |
| paleAmber／warningInk | amber | 0.962／0.43 | 0.028／0.08 |
| paleCoral／errorInk | coral | 0.965／0.48 | 0.018／原值 |

mintSurface、previewSurface 和操作狀態容器沿上述色階作語義別名，沒有逐頁加新顏色。

## 驗證與限制

在 frontend 執行 npm run verify:colors。Culori 只屬 devDependency；檢查程式讀 theme.ts，核對已列明的文字／背景、按鈕及控制圖標組合，記錄未四捨五入的對比及 source hash。FE-W06 首輪核對 16 組；FE-W07 補查狀態容器內的兩組文字，共 18 組，沒有新增色值。

一般文字至少 4.5:1；辨識控制項／狀態所需的非文字視覺至少 3:1。裝飾分隔線、未啟用項目和整個產品的其他可存取要求不由這份 token 檢查代替。[WCAG 文字對比](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[非文字對比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Paper 採完整 MD3 色彩角色，包含 elevation、backdrop、on* 和 disabled；只覆蓋 primary 不會重新產生其他預設色。roundness 是元件倍率基數，採 4；AppDialog 另用共用卡片的 22 px 圓角，防止再次放大。[Paper 主題](https://oss.callstack.com/react-native-paper/docs/guides/theming)

這是待使用者比較的前端配色修訂。視覺滿意與否由實際畫面決定；token 對比通過不代表整套 WCAG、正式 API 或 Android 實機驗收通過。
