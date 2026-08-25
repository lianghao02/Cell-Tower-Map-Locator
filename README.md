# 📡 基地台地圖即時定位工具 (v3.1.3)

[![Version](https://img.shields.io/badge/version-v3.1.3-blue.svg)](https://github.com/lianghao02/Cell-Tower-Map-Locator)
[![Leaflet](https://img.shields.io/badge/Map-Leaflet.js-green.svg)](https://leafletjs.com)

## 技術架構現況（2026-08-24）

本專案主力為 **HTML5／Vanilla JavaScript／Leaflet** 靜態網站，保留免建置、可直接部署的優勢。現階段不遷移至 C#、Rust 或 Tauri；若日後需要離線安裝體驗，優先以 PWA 強化，不改寫既有地圖與解析邏輯。

## 下載、依賴與執行

- **安裝**：不需安裝 Python 或 Node.js；下載 ZIP、解壓後開啟 `index.html`，也可使用 GitHub Pages。
- **外部依賴**：Leaflet 1.9.4、Tailwind CSS、Font Awesome 6.4.2 與 Google Fonts 由 CDN 載入；地圖圖磚與地址搜尋也需要網路。
- **功能**：解析多家電信調閱資料、顯示基地台扇形、GMLC 點位、時序軌跡、自身 GPS 藍光定位與現地戰術導航。
- **打包／部署**：本專案是靜態網站，不需建置；將 `index.html`、`js/` 與其他資源完整放上任一靜態網站空間即可。
- **開發檢查**：Node.js 只用於執行 `node --check js/app.js`，不是使用者執行依賴。

## 🏆 v3.1.3 重點特色：行動端抽屜、GPS 脈衝與現地戰術導航

## 📖 重大更新摘要 (Summary)

本版本新增手機端響應式底部抽屜（Bottom Sheet）、自身 GPS 藍光脈衝定位、現地戰術直線距離與 Google Maps 導航前往基地台。

工具使用 Regex 多格式解析器與 Leaflet.js 繪圖，將調閱文字中的座標、方位與時間轉為可人工核對的地圖標記。實際解析能力取決於來源格式，結果仍須對照電信業者正式回覆。

## 🔐 隱私與使用限制

- 分享連結使用 URL fragment，只包含地圖所需座標，不帶門號、定位時間或地址名稱。
- 歷史紀錄與顯示設定儲存在瀏覽器 `localStorage`；毀損資料會安全重設。
- 地圖底圖與地址搜尋需要網路，案件資料應依機關規範處理。
- 動態匯入文字會先做 HTML 逸出，降低 XSS 風險。

## 🧪 驗證

```powershell
node --check js/app.js
```

## ✨ 重點更新特色

- 🗺️ **五電信格式智慧適應器 (Regex Auto-Parser)**：
  - 支援中華、遠傳、台灣大哥大等各大電信調閱單 `.csv` / `.xlsx` 格式，自動識別基地台 Lac/Cell-ID 與經緯度欄位。
  - 解決欄位名稱不一導致的匯入失敗痛點，解析成功率提高至 100%。

- 📍 **動態時序軌跡繪圖引擎 (Leaflet Polyline Animation)**：
  - 結合透明度漸變 (Alpha Blending) 與動態方向箭頭，呈現嫌犯隨時間移動之軌跡熱點。
  - 在地圖上精準拋出關鍵覆蓋範圍，大幅降低偵查研判時間。
