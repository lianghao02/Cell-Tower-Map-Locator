# 📡 手機門號基地台即時定位工具 (v3.1.4)

[![Version](https://img.shields.io/badge/version-v3.1.4-blue.svg)](https://github.com/lianghao02/Cell-Tower-Map-Locator)
[![Live Demo](https://img.shields.io/badge/Live_Demo-線上即開即用-emerald.svg)](https://lianghao02.github.io/Cell-Tower-Map-Locator/)
[![Leaflet](https://img.shields.io/badge/Map-Leaflet.js-green.svg)](https://leafletjs.com)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Mobile%20%7C%20Desktop-orange.svg)](#)

專為執法人員、刑事鑑識與救難人員打造的現代化基地台定位與空間關聯分析工具。支援各大電信簡訊／調閱文字自動智慧解析、方位角清透扇形繪製、多點動態時序軌跡、自身 GPS 戰術導航，以及**最近歷史多筆疊加空間比對**。

---

## 🚀 快速開始 (2 種使用方式)

### 方式一：線上免安裝直接使用（推薦 🌟）

無須下載任何檔案，在手機、平板或電腦瀏覽器點擊下方網址即可立即使用：

🔗 **[點此開啟線上版：https://lianghao02.github.io/Cell-Tower-Map-Locator/](https://lianghao02.github.io/Cell-Tower-Map-Locator/)**

> 📱 **手機 PWA 秘技**：使用 Safari 或 Chrome 開啟上述網址，點選「分享」➔「加入主畫面」，即可當成獨立 App 秒開全螢幕操作！

---

### 方式二：下載到電腦離線執行 (免安裝、免配置)

如果您的環境無法直接連外網，或是想在本機常駐使用：

1. **下載檔案**：
   - 點擊本專案右上角綠色按鈕 `Code` ➔ 選擇 **`Download ZIP`**（或至 [Releases 最新發布頁面](https://github.com/lianghao02/Cell-Tower-Map-Locator/releases) 下載 `Source code.zip`）。
2. **解壓縮**：
   - 將下載的 `.zip` 壓縮檔解壓縮至電腦任意資料夾。
3. **啟動執行**：
   - **Windows 使用者**：直接滑鼠雙擊 **`啟動工具.bat`** 或 **`index.html`**。
   - **Mac / Linux 使用者**：直接用 Chrome 或 Edge 等瀏覽器開啟 **`index.html`**。
   - **零環境依賴**：完全**不需安裝** Node.js、Python 或任何伺服器軟體，直接開啟即刻運作！

---

## 🏆 v3.1.4 重點特色與核心功能

### 1. 🧭 方位角扇形即時繪製引擎
- **手動自訂角度**：在「定位資料」頁籤輸入 0~360° 方位角，地圖即時以正北為基準順時針繪製寶藍色 15% 晶透扇形。
- **波束與半徑微調**：可至右上角進階設定調整扇形涵蓋半徑（50~1000m）與開口夾角（10~180°）。

### 2. 🗂️ 最近歷史「多筆疊加空間比對 (Multi-History Comparison)」
- **同屏多色疊加**：在「最近歷史」頁籤勾選 2 筆以上紀錄，地圖自動為各歷史項目分配高辨識度專屬對比色（#1 寶藍、#2 翡翠綠、#3 琥珀橘、#4 紫羅蘭、#5 玫瑰紅等）。
- **扇形與關聯線並存**：同時呈現多筆基地台扇形涵蓋面、目標地址連線與距離，快速研判多筆訊號交集重疊熱區。
- **全景自適應視野**：自動計算所有勾選點位的經緯度邊界（FitBounds），一次盡收眼底。

### 3. 🗺️ 五大電信格式智慧適應器 (Regex Auto-Parser)
- 支援中華電信、遠傳電信、台灣大哥大等各大電信簡訊／調閱文字，貼上整段雜亂文字自動識別 Lac/Cell-ID、經緯度、方位角與時間。
- 支援度分秒 (DMS) 與度小數分 (DMM) 自動換算十進位度數 (DD)。

### 4. 📱 行動端戰術底部抽屜 (Bottom Sheet) & GPS 導航
- **響應式抽屜**：頂部拉把流暢收合，留出最大地圖視野；支援收合狀態摘要列。
- **GPS 藍光脈衝定位**：一鍵獲取自身位置與精度半徑圈，自動計算自身與目標基地台直線距離、方位角連線，並提供一鍵 Google Maps 戰術路線導航。

---

## 🔐 隱私與資安防禦

- **零伺服器儲存**：純前端本機運算，所有解析與比對皆在使用者瀏覽器內部執行，案件資料不回傳任何後端伺服器。
- **安全分享機制**：產生之分享連結採用 URL Fragment (`#`)，僅包含地圖定位座標，絕對不攜帶門號、時間或個資。
- **防 XSS 注入**：所有動態匯入與調閱文字均經 HTML 實體逸出轉譯處理。

---

## 🧪 開發與驗證

本專案使用原生 JavaScript 與 Leaflet 開發，提交前可透過下列指令驗證：

```powershell
# 語法正確性檢查
node --check js/app.js

# 專案格式與資安 QA 檢核
powershell -ExecutionPolicy Bypass -File scripts\qa.ps1
```

---

## 📄 版權聲明 (License)

System Version 3.1.4 &copy; 2026 Cell Phone Locator. All rights reserved.
