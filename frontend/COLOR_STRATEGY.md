# 育伴港配色策略

更新：2026-10-01，FE-W20。使用者指定 [Happy Hues 第 14 款](https://www.happyhues.co/palettes/14)，取代原綠色／暖灰 UI 色盤。只讀這一頁的用色指導並核對實際畫面，沒有翻看其他配色。Logo／美術保留；色值唯一入口是 [theme.ts](src/theme.ts)。

## 網站分工與育伴港映射

網站分別示範白底主視覺、淺青色區的白卡、白底上的深色資訊卡，以及青色表單區配白欄位／深色提交。黃色集中在主入口及插畫亮點，不要求所有按鈕都用黃色。[第 14 款指導](https://www.happyhues.co/palettes/14)

| 原值 | 網站用途 | 育伴港的實作映射 |
|---|---|---|
| `#FFFFFE` | 背景、卡片、欄位、深底文字 | 卡片／Dialog／輸入框／次要按鈕及導航內控件 |
| `#272343` | 標題、線條、黃底文字、表單按鈕底 | 標題／SVG／焦點；普通提交深底白字，Agent 黃底深字 |
| `#2D334A` | 正文、次標題 | 正文及說明；主次靠字級、粗幼、留白 |
| `#FFD803` | 主入口、插畫 highlight | 固定 Agent 入口、首頁進行對話、手機提問箭嘴 |
| `#E3F6F5` | 區塊背景、secondary | 常駐左／頂／右導航及首頁重點 |
| `#BAE8E8` | tertiary、標籤、highlight、表單區 | 選中導航／容器及頭像底 |

以上映射是本項目的用途選擇。淺青導航框住接近白色的畫布，白卡／白控件浮在區塊上；不把每張卡片都改成深色。AppButton 的 primary 為深底白字，accent 為黃底深字，secondary 為白底描邊，quiet 為深色文字。黃色只強調 Agent，保留深色邊界；不作正文、細線或大面積底色。MD3 primary 保持深色，使選項／焦點／文字按鈕仍可辨讀。

## OKLCH 與狀態

六個主色直接採原值，不用 OKLCH 重新近似。額外色階以 Culori 4.0.2 轉 OKLCH，保留種子 h、指定 L／C，超出 sRGB 時 clamp chroma，輸出共用 HEX。沿用已核對的 [Culori](https://culorijs.org/api/)／[CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab)／[RN 顏色](https://reactnative.dev/docs/colors) 結論，這輪沒有重查其他設計網站。

| 派生角色 | 種子 | L | C | HEX |
|---|---|---|---|---|
| canvas／neutralSurface／previewSurface | `#E3F6F5` | 0.987 | 0.005 | `#F7FCFC` |
| quietSurface | `#E3F6F5` | 0.975 | 0.013 | `#EDFAF9` |
| line | `#272343` | 0.84 | 0.015 | `#CAC9D4` |
| softLine | `#272343` | 0.925 | 0.006 | `#E6E6EA` |
| controlOutline | `#272343` | 0.56 | 0.027 | `#737284` |
| amber／warning boundary | `#FFD803` | 0.64 | 0.125 | `#A38B19` |
| paleAmber／unknown container | `#FFD803` | 0.975 | 0.043 | `#FFF7D8` |
| warningInk | `#FFD803` | 0.43 | 0.083 | `#5E4F0C` |

第 14 款沒有失敗色，故沿用既有 coral／paleCoral／errorInk，只作明確失敗／錯誤。待確認及結果未知採黃色派生淺底、深警告字及原操作文案；不改候選、保存、失敗、unknown 的操作語義，也不只靠顏色區分。

teal／deepTeal 是既有程式的角色別名，現值均為 `#272343`，不是保留另一組綠色。新強調用 accent／onAccent；完整 MD3 on*、surface、elevation、disabled、scrim／backdrop 已覆蓋，SVG 仍由 AppIcon 輸出。不能逐頁加 HEX 或留下預設紫色。

## 背景與證據

HomeBackground 共用圖片及 SVG 漸淡。文字區完全不透明，手機底部接回 canvas；原插畫在寬桌面保留人物構圖，自選圖片鋪滿背景。「設定 → 應用偏好 → 首頁背景」可本地選圖／恢復，沒有上傳或保存；原生選圖／正式保存待接線，見 [APPEARANCE_HANDOFF](APPEARANCE_HANDOFF.md)。

[color-checks](verification/fe-w20/color-checks.json) 的 22 組文字／控制項對比通過，含黃底深字與邊界；15 頁四尺寸重排、六寬度 Dialog／SVG、四尺寸背景／150% Web 文字和 Web／Android export 見 [FE-W20](verification/fe-w20)。歷史 FE-W06–W19 證據保留，不能當作新色盤已驗。完整無障礙、使用者視覺及原生實機仍待驗收。
