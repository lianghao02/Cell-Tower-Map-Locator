# 02_Cell-Tower-Map-Locator Agent 開發規範

本專案遵循目前有效之全域開發憲法；本檔僅定義專案專屬規則與例外。

---

## 1. 技術棧與前端架構邊界
- **主力架構**：純靜態 Web (HTML5 / Vanilla JavaScript / CSS / Leaflet.js)。
- **架構純粹性標準**：
  - 本工具核心為零依賴、免伺服器、瀏覽器即開即用之基地台定位與空間分析應用。
  - **嚴禁引入 React、Vue 等 SPA 框架**，維持標準原生 DOM 操作與極致輕巧。
  - 若需桌面封裝，一律採用 Tauri (Rust + WebView2)，嚴禁使用 Electron。

---

## 2. 業務領域與空間幾何分析核心邊界 (嚴格真實性原則)
- **以「地圖核心」為絕對主要畫面**：
  - 工具設計必須以 Leaflet 地圖可視化為中心，**不追求複雜龐大的儀表板 (Dashboard) 堆疊**。
  - 控制項採用行動端戰術抽屜 (Bottom Sheet) 與輕巧浮層，確保地圖最大視野。
- **幾何交集真實性聲明（鑑識法律底線）**：
  - 扇形交集引擎（Sutherland-Hodgman 多邊形剪裁求得之幾何重疊區域）：**只能描述為「信號覆蓋推估之分析參考範圍／訊號交集熱區」**。
  - **嚴格禁止描述為「真實手機位置」、「精確目標座標」或「手機所在點」**，避免在司法調查或搜救中造成誤導。
  - 介面必須透明提示結果依據與信號衰減半徑之可信度限制。

---

## 3. 隱私與資安防衛
- **100% 離線與案件隱私安全**：
  - 基地台簡訊解析、空間座標換算與多點軌跡全數於本機瀏覽器記憶體計算，**絕不傳送至任何遠端伺服器**。
  - 分享連結（URL Hash `#`）嚴格限制僅包含經緯度座標與縮放級別，**嚴禁攜帶涉案門號、時間戳或任何個人機敏資料**。
  - 外部文字輸入強制經過 HTML 實體逸出（Entity Escaping），阻斷 XSS 注入風險。

---

## 4. 核心驗證方式
- 修改 JavaScript 邏輯或樣式後，必須執行語法檢查與品質驗證：
  ```powershell
  node --check js/app.js
  powershell -ExecutionPolicy Bypass -File scripts\qa.ps1
  ```

---

## 5. 共用 Skill 引用與動態解析 (Discovery Rule)
- 本專案遵循 LiangHao 全生態系標準規範 Skill：`lianghao-development`（Canonical Source 位於 `Dev-Control-Center/skills/lianghao-development`，v1.0.0）。
- Agent 開始工作時：
  1. 優先使用目前環境可自動發現的 `lianghao-development` Skill
  2. 若平台未自動載入，使用既有動態解析順序：環境變數 `LIANGHAO_SKILL_HOME` ➜ `%USERPROFILE%\.lianghao\config.json` ➜ 鄰近工作區探索 `..\00_Dev-Control-Center\skills\lianghao-development` 或呼叫其 `skill-resolver.ps1`
  3. 先讀 Shared Skill
  4. 再讀本專案 `AGENTS.md`
  5. 再讀目前 `HANDOFF.md` / `IMPLEMENTATION_PLAN.md`
  6. 專案、Git、測試與建置實際狀態優先於文件歷史
- 跨 Agent HANDOFF 一律使用 `lianghao-development` 標準範本，以 `Repository Full Name`、`Branch`、`Commit SHA`、`Task Type` 為主要識別，嚴禁複製 Skill 到本專案。
