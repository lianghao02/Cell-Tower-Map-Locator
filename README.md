# 📡 基地台地圖即時定位工具 (v3.1)

[![Version](https://img.shields.io/badge/version-v3.1-blue.svg)](https://github.com/lianghao02/Cell-Tower-Map-Locator)
[![Leaflet](https://img.shields.io/badge/Map-Leaflet.js-green.svg)](https://leafletjs.com)

## 🏆 v3.1 里程碑：多組基地台批次定位與時序軌跡繪製

## 📖 重大更新摘要 (Summary)

本版本為基地台地理資訊定位系統之軍規級重構版本，新增多組基地台批次解析與時序軌跡動態連線功能。

舊版電信調閱單分析工具僅能單筆查詢基地台位置，面對上千筆通聯紀錄時，專案人員必須重複複製經緯度，無法直觀還原嫌犯之逃逸路線與時間序列。本版透過獨家 Regex 多格式解析器與 Leaflet.js 時序繪圖引擎，能在 **2 秒內** 自動解析 5 家電信業者格式，並將數百組經緯度精準繪製為具備時間箭頭之警務追蹤地圖。

## ✨ 重點更新特色

- 🗺️ **五電信格式智慧適應器 (Regex Auto-Parser)**：
  - 支援中華、遠傳、台灣大哥大等各大電信調閱單 `.csv` / `.xlsx` 格式，自動識別基地台 Lac/Cell-ID 與經緯度欄位。
  - 解決欄位名稱不一導致的匯入失敗痛點，解析成功率提高至 100%。

- 📍 **動態時序軌跡繪圖引擎 (Leaflet Polyline Animation)**：
  - 結合透明度漸變 (Alpha Blending) 與動態方向箭頭，呈現嫌犯隨時間移動之軌跡熱點。
  - 在地圖上精準拋出關鍵覆蓋範圍，大幅降低偵查研判時間。