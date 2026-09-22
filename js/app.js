        // 全域錯誤攔截 (記錄至主控台，避免向使用者洩漏技術細節)
        window.onerror = function (msg, url, lineNo, columnNo, error) {
            console.error(`[AppError] ${msg} (Line: ${lineNo})`, error);
            return false;
        };

        /**
     * 手機門號即時定位 v1.0
     * 已封裝邏輯以確保安全與效能。
     */
        const app = (function () {
            // 私有變數
            let map, marker, sector, addrMarker, relationLine;
            let multiTowerLayers = []; // 多點模式圖層集合 (Markers, Polygons, PathLines)
            let isMapSelectActive = false; // 地圖選點模式狀態
            let currentHistoryId = null; // 當前歷史紀錄 ID 追蹤
            let selectedHistoryIds = new Set(); // 多選歷史紀錄 ID 集合 (用於多筆疊加比對)
            let isHistoryCompareActive = false; // 僅在使用者明確開始後才疊加歷史資料
            let isHistorySingleView = false; // 從歷史檢視單筆時，不自動繪製同批次軌跡
            let isIntersectionOnly = false; // 是否僅高亮顯示扇形交集區
            let lastIntersectionData = null; // 最新計算出的交集資訊 { polygon, area, centroid, towerCount }
            let lastIntersectionStatus = "idle"; // idle | insufficient-sectors | no-intersection | intersection
            let myLocationMarker = null, myLocationCircle = null, myLocationLine = null; // GPS 自身定位圖層
            let myCoords = null; // { lat, lng, accuracy }

            // 歷史比對多色調色盤 (高辨識度莫蘭迪 / 鮮明對比色)
            const COMPARE_COLORS = [
                { border: "#2563eb", fill: "#3b82f6", badge: "#2563eb", name: "寶藍" },
                { border: "#059669", fill: "#10b981", badge: "#059669", name: "翡翠綠" },
                { border: "#d97706", fill: "#f59e0b", badge: "#d97706", name: "琥珀橘" },
                { border: "#7c3aed", fill: "#8b5cf6", badge: "#7c3aed", name: "紫羅蘭" },
                { border: "#db2777", fill: "#ec4899", badge: "#db2777", name: "玫瑰紅" },
                { border: "#0891b2", fill: "#06b6d4", badge: "#0891b2", name: "青藍" },
                { border: "#4b5563", fill: "#6b7280", badge: "#4b5563", name: "石墨灰" }
            ];

            // 資料模型 (包含 reqTime, regTime, 以及目標地址資料與多點 towers)
            let data = {
                lat: null,
                lng: null,
                azi: null,
                phone: "",
                reqTime: "",
                regTime: "",
                addrName: "",
                addrLat: null,
                addrLng: null,
                searchQuery: "",
                towers: [], // 支援最多 5 筆多點軌跡資料陣列 [{lat, lng, azi, phone, reqTime, regTime}, ...]
            };
            let history = [];

            // HTML 特殊字元轉義 (防 XSS)
            function esc(str) {
                if (str == null) return '';
                return String(str)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            function isValidAzimuth(value) {
                const azimuth = Number(value);
                return Number.isFinite(azimuth) && azimuth >= 0 && azimuth <= 360;
            }

            // --- 參數解耦配置 (Config) ---
            const STORAGE_KEY = "cell_locate_v1_config";
            const DEFAULT_CONFIG = {
                sectorRadius: 300,      // 扇形半徑 (米)
                sectorAperture: 60,     // 扇形夾角 (度)
                defaultZoom: 16,        // 預設縮放層級
                historyLimit: 50,       // 歷史紀錄上限
                maxBatchLimit: 5,       // 批量解析最多上限 (筆)
                sectorColor: "#2563eb",  // 扇形統一寶藍色
                sectorFillOpacity: 0.15,// 15% 晶透透明度 (重疊自動加深不蓋圖)
                mapTileUrl: "https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png",
                boundsLatMin: 21,       // 台灣經緯度界線 (Lat Min)
                boundsLatMax: 27,
                boundsLngMin: 118,
                boundsLngMax: 124
            };
            let config = { ...DEFAULT_CONFIG };

            const HISTORY_STORAGE_KEY = "cell_locate_v1_db";

            function isMobileLayout() {
                return window.matchMedia("(max-width: 768px)").matches;
            }

            function getFitBoundsOptions() {
                const consoleEl = document.getElementById("floating-console");
                const isCollapsed = consoleEl && consoleEl.classList.contains("collapsed");
                if (isMobileLayout()) {
                    return {
                        paddingTopLeft: [50, 50],
                        paddingBottomRight: [50, isCollapsed ? 100 : 360],
                        maxZoom: 17
                    };
                }
                return { padding: [50, 50], maxZoom: 17 };
            }

            // 初始化
            function init() {
                loadConfig();
                try {
                    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
                    if (saved) {
                        try {
                            const parsed = JSON.parse(saved);
                            if (Array.isArray(parsed)) history = parsed;
                        } catch (err) {
                            console.error("History parse error, resetting history:", err);
                            history = [];
                        }
                    }
                    renderHistory();

                    // 監聽輸入框變更 (change 與 input 即時響應，確保手動輸入方位角即時繪製)
                    ["lat", "lng", "phone", "azi", "reqTime", "regTime", "addrLat", "addrLng", "targetAddr"].forEach((id) => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener("change", () => updateFromInput(false));
                            if (id === "lat" || id === "lng" || id === "azi") {
                                el.addEventListener("input", () => updateFromInput(false));
                            }
                        }
                    });

                    syncConfigToUI();
                    initDrawer(); // 側邊抽屜事件只綁定一次
                    syncConsoleToggleIcon();
                    window.addEventListener("resize", syncConsoleToggleIcon);

                    // 隔離控制台與 FAB 之 Leaflet 手勢事件冒泡，防止操作表單時拖動地圖
                    const consoleEl = document.getElementById("floating-console");
                    if (consoleEl && typeof L !== "undefined" && L.DomEvent) {
                        L.DomEvent.disableScrollPropagation(consoleEl);
                        L.DomEvent.disableClickPropagation(consoleEl);
                        let resizeDebounce = null;
                        consoleEl.addEventListener("transitionend", (e) => {
                            if (e.propertyName === "max-height" || e.propertyName === "transform" || e.propertyName === "padding") {
                                if (resizeDebounce) clearTimeout(resizeDebounce);
                                resizeDebounce = setTimeout(() => {
                                    if (map) map.invalidateSize();
                                }, 50);
                            }
                        });
                    }
                    const myLocBtn = document.getElementById("btnMyLocation");
                    if (myLocBtn && typeof L !== "undefined" && L.DomEvent) {
                        L.DomEvent.disableClickPropagation(myLocBtn);
                    }
                    const openSheetBtn = document.getElementById("btnOpenSheetFab");
                    if (openSheetBtn && typeof L !== "undefined" && L.DomEvent) {
                        L.DomEvent.disableClickPropagation(openSheetBtn);
                    }

                    // 檢查網址參數 (分享連結開啟)
                    checkUrlParams();

                    // 初始化智慧分頁導航
                    const params = getUrlParams();
                    if (params.has('lat') && params.has('lng')) {
                        if (params.has('addrLat') && params.has('addrLng')) {
                            switchTab('compare');
                        } else {
                            switchTab('base');
                        }
                    } else {
                        switchTab('parse');
                        updateMap(false, "base"); // 乾淨開屏時，強制初始化台灣地圖背景，避免白茫茫一片
                    }

                } catch (e) {
                    console.error("Init error:", e);
                }
            }

            function getUrlParams() {
                const params = new URLSearchParams(window.location.search);
                const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
                hashParams.forEach((value, key) => params.set(key, value));
                return params;
            }

            function checkUrlParams() {
                const params = getUrlParams();
                let hasData = false;

                if (params.has('lat') && params.has('lng')) {
                    data.lat = parseFloat(params.get('lat'));
                    data.lng = parseFloat(params.get('lng'));
                    hasData = true;
                }
                // 分享連結只還原非敏感基地台座標；門號、時間、地址與方位角一律不從 URL 讀取。
                data.azi = null;
                data.phone = "";
                data.reqTime = "";
                data.regTime = "";
                data.addrLat = null;
                data.addrLng = null;
                data.addrName = "";


                if (hasData) {
                    syncUI();
                    updateMap(false, "base"); // 不自動存入歷史，避免污染
                }
            }

            function loadConfig() {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    try {
                        config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
                        // 遷移修正：舊版 OpenStreetMap 官方阻擋 URL、CartoDB 浮水印或法語鏡像，自動升級為 OSM 繁體中文全相容圖資
                        const isOutdatedTile = !config.mapTileUrl ||
                            config.mapTileUrl.includes("tile.openstreetmap.org") ||
                            config.mapTileUrl.includes("cartocdn.com") ||
                            config.mapTileUrl.includes("openstreetmap.fr");
                        if (isOutdatedTile) {
                            config.mapTileUrl = DEFAULT_CONFIG.mapTileUrl;
                        }
                    } catch (e) {
                        console.error("Config parse error:", e);
                    }
                }
            }

            function saveConfig() {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
            }

            // DMS (度分秒) / DMM (度小數分) 轉十進位度數 (DD) 轉換器
            function parseDMSToDD(text) {
                const results = [];
                // 1. 度分秒 (DMS) 匹配模式 (如 23°04'15.2"N 120°23'40.8"E 或 23d04m15.2s N)
                const dmsRegex = /([NSEWnsew])?\s*(\d{1,3})[°度d\s]\s*(\d{1,2})['分m\s]\s*(\d{1,2}(?:\.\d+)?)[″"秒s]?\s*([NSEWnsew])?/g;
                const dmsMatches = [...text.matchAll(dmsRegex)];

                if (dmsMatches.length >= 2) {
                    const coords = [];
                    dmsMatches.forEach(m => {
                        const dir = (m[1] || m[5] || '').toUpperCase();
                        const deg = parseFloat(m[2]);
                        const min = parseFloat(m[3]);
                        const sec = parseFloat(m[4]);
                        let dd = deg + (min / 60) + (sec / 3600);
                        if (dir === 'S' || dir === 'W') dd = -dd;
                        coords.push({ dd, dir });
                    });

                    let lat = null, lng = null;
                    coords.forEach(c => {
                        if (c.dir === 'N' || c.dir === 'S') lat = c.dd;
                        else if (c.dir === 'E' || c.dir === 'W') lng = c.dd;
                        else {
                            if (c.dd >= config.boundsLatMin && c.dd <= config.boundsLatMax && !lat) lat = c.dd;
                            else if (c.dd >= config.boundsLngMin && c.dd <= config.boundsLngMax && !lng) lng = c.dd;
                        }
                    });

                    if (lat !== null && lng !== null) {
                        results.push({ lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) });
                    }
                }

                // 2. 度小數分 (DMM) 匹配模式 (如 23°04.2533'N 120°23.6800'E)
                if (results.length === 0) {
                    const dmmRegex = /([NSEWnsew])?\s*(\d{1,3})[°度d\s]\s*(\d{1,2}(?:\.\d+)?)['分m]?\s*([NSEWnsew])?/g;
                    const dmmMatches = [...text.matchAll(dmmRegex)];
                    if (dmmMatches.length >= 2) {
                        const coords = [];
                        dmmMatches.forEach(m => {
                            const dir = (m[1] || m[4] || '').toUpperCase();
                            const deg = parseFloat(m[2]);
                            const minDec = parseFloat(m[3]);
                            let dd = deg + (minDec / 60);
                            if (dir === 'S' || dir === 'W') dd = -dd;
                            coords.push({ dd, dir });
                        });

                        let lat = null, lng = null;
                        coords.forEach(c => {
                            if (c.dir === 'N' || c.dir === 'S') lat = c.dd;
                            else if (c.dir === 'E' || c.dir === 'W') lng = c.dd;
                            else {
                                if (c.dd >= config.boundsLatMin && c.dd <= config.boundsLatMax && !lat) lat = c.dd;
                                else if (c.dd >= config.boundsLngMin && c.dd <= config.boundsLngMax && !lng) lng = c.dd;
                            }
                        });

                        if (lat !== null && lng !== null) {
                            results.push({ lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) });
                        }
                    }
                }

                return results;
            }

            // 將網頁表格複製出的 <br> 與不換行空白轉為一般文字格式
            function normalizeInputText(text) {
                return String(text || "")
                    .replace(/\r\n?/g, "\n")
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/\u00a0/g, " ");
            }

            // 判斷是否為通訊調閱入口網站的完整定位回覆，避免一般座標文字誤入專用解析流程
            function isPortalResponse(text) {
                const portalRecordPattern = /^\s*\|?\s*\d+\s*\|?\s*(?:\r?\n\s*)?(?:即時定位\s*(?:\||\r?\n)?\s*)?(?:定位完成|定位成功|無法定位)(?=\s|\||$)/m;
                const hasCompleteResponse = /回覆資訊[：:]/.test(text) &&
                    /定位記錄[：:]/.test(text) &&
                    /序號\s+定位類別\s+定位狀態/.test(text) &&
                    portalRecordPattern.test(text);
                const hasPortalRecords = portalRecordPattern.test(text);
                const hasBaseStationSection = /基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\s*Station\s*(?:Coordinates?|Location)/i.test(text);
                const hasLocatorMetadata = /(?:定位請求|註冊基地|最後註冊|定位基地[臺台]方向角|Positioning Request|Base Station Reg|detected\s+at)/i.test(text);
                const hasAzimuth = /(?:定位基地[臺台]方向角|基地[臺台](?:方向角|方位角)|天線方位角|Azimuth|Bearing|Dir)/i.test(text);
                // 單筆來源未必包含「定位完成」，但同時具備基地台段落與定位欄位時可安全視為同一筆。
                const hasSingleRecordFragment = hasBaseStationSection && (hasLocatorMetadata || hasAzimuth);

                return hasCompleteResponse || hasPortalRecords || hasSingleRecordFragment;
            }

            // 將國際格式門號轉為既有介面使用的 09 格式
            function normalizePhone(phone) {
                if (!phone) return "";
                const digits = String(phone).replace(/\D/g, "");
                return digits.startsWith("8869") ? "0" + digits.substring(3) : digits;
            }

            // 日期時間解析器 (支援民國紀年轉西元與 ISO/標準日期，防止 Invalid Date 造成排序失控)
            function parseDateTimeToMs(str) {
                if (!str) return 0;
                let normalized = String(str).trim();
                const rocMatch = normalized.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/);
                if (rocMatch) {
                    const yearNum = parseInt(rocMatch[1], 10);
                    if (yearNum < 1900) {
                        const adYear = yearNum + 1911;
                        const timePart = rocMatch[4] || "00:00:00";
                        normalized = `${adYear}/${rocMatch[2].padStart(2, '0')}/${rocMatch[3].padStart(2, '0')} ${timePart}`;
                    }
                }
                const ms = Date.parse(normalized.replace(/-/g, "/"));
                return isNaN(ms) ? 0 : ms;
            }

            // 從指定標題區段擷取經緯度，避免基地臺與 GMLC 座標互相混用
            function parsePortalCoordinateSection(block, sectionPattern, endPattern) {
                const sectionMatch = block.match(new RegExp(
                    `(?:${sectionPattern})[：:\\s]*([\\s\\S]*?)(?=${endPattern}|$)`,
                    "i"
                ));
                if (!sectionMatch) return null;
                const targetText = sectionMatch[0];

                let lat = null, lng = null;

                // 模式 1: 關鍵字分別搜尋 (支援細胞經緯度/經緯度/Lat/Lng)
                const lngMatch = targetText.match(/(?:細胞經度|經度|Longitude|Lng)\s*[：:]?\s*(-?\d{1,3}(?:\.\d+)?)/i);
                const latMatch = targetText.match(/(?:細胞緯度|緯度|Latitude|Lat)\s*[：:]?\s*(-?\d{1,2}(?:\.\d+)?)/i);
                if (latMatch && lngMatch) {
                    lat = parseFloat(latMatch[1]);
                    lng = parseFloat(lngMatch[1]);
                } else {
                    // 模式 2: 成對座標 (例如: 基地臺經緯度: 25.033, 121.565)
                    const pairMatch = targetText.match(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/) ||
                                      targetText.match(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/);
                    if (pairMatch) {
                        const v1 = parseFloat(pairMatch[1]);
                        const v2 = parseFloat(pairMatch[2]);
                        lat = v1 < 100 ? v1 : v2;
                        lng = v1 < 100 ? v2 : v1;
                    }
                }

                if (lat === null || lng === null) return null;
                if (lat < config.boundsLatMin || lat > config.boundsLatMax ||
                    lng < config.boundsLngMin || lng > config.boundsLngMax) {
                    return null;
                }
                return { lat, lng };
            }

            // 解析入口網站回覆；輸出沿用既有 towers 結構，降低對地圖與歷史功能的影響
            function parsePortalResponse(text, fallbackPhone) {
                let recordStarts = [...text.matchAll(
                    /^\s*(?:\|?\s*(\d+)\s*\|?\s*(?:\r?\n\s*)?)?(?:即時定位\s*(?:\||\r?\n)?\s*)?(定位完成|定位成功|無法定位)(?=\s|\||$)/gm
                )];
                if (recordStarts.length === 0) {
                    const statusMatch = text.match(/(?:即時定位\s+)?(定位完成|定位成功|無法定位)/);
                    if (statusMatch) {
                        recordStarts = [{ index: 0, 1: "1", 2: statusMatch[1] }];
                    } else {
                        const implicitStarts = [...text.matchAll(/(?:定位請求的時間|定位請求時間|請求定位時間|Positioning Request|detected\s+at)\s*[：:]?/gi)];
                        if (implicitStarts.length === 1) {
                            // 英文來源的 detected at 可能位在座標之後；單筆時從全文開始保留完整關聯。
                            recordStarts = [{ index: 0, 1: "1", 2: "定位完成" }];
                        } else if (implicitStarts.length > 1) {
                            recordStarts = implicitStarts.map((match, index) => ({
                                index: match.index,
                                1: String(index + 1),
                                2: "定位完成"
                            }));
                        } else {
                            const towerStarts = [...text.matchAll(/(?:基地[臺台]資訊|基地[臺台]編號|細胞經度)/g)];
                            if (towerStarts.length > 1) {
                                recordStarts = towerStarts.map((match, index) => ({
                                    index: match.index,
                                    1: String(index + 1),
                                    2: "定位完成"
                                }));
                            } else if (/基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\s*Station\s*(?:Coordinates?|Location)/i.test(text)) {
                                recordStarts = [{ index: 0, 1: "1", 2: "定位完成" }];
                            }
                        }
                    }
                }
                const declaredMatch = text.match(/定位紀錄筆數\s*[：:]?\s*(\d+)\s*筆/);
                const targetMatch = text.match(/(?:調閱目標資訊|申請用戶帳號)\s*[：:]?\s*(8869\d{8}|09\d{8})/);
                const globalPhone = normalizePhone(targetMatch ? targetMatch[1] : fallbackPhone);
                const records = [];
                let completedCount = 0;
                let failedCount = 0;
                let missingTowerCount = 0;
                let missingAzimuthCount = 0;
                let invalidAzimuthCount = 0;

                recordStarts.forEach((start, index) => {
                    const end = index + 1 < recordStarts.length ? recordStarts[index + 1].index : text.length;
                    const block = text.slice(start.index, end);
                    const statusText = start[2];
                    const isSuccess = statusText === "定位完成" || statusText === "定位成功";
                    if (isSuccess) completedCount += 1;
                    else failedCount += 1;

                    const reqMatch = block.match(/(?:定位請求的時間|定位請求時間|請求定位時間|Positioning Request|detected\s+at)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/i);
                    const respMatch = block.match(/(?:定位回應的時間|定位回應時間|回應定位時間)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
                    const regMatch = block.match(/(?:註冊基地[臺台]時間|最後註冊時間|基地[臺台]註冊時間)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
                    const towerIdMatch = block.match(/(?:基地[臺台]編號|註冊基地[臺台]編號|Tower[- ]?ID)\s*[：:]?\s*([A-Za-z0-9_-]+)/i);
                    const cellMatch = block.match(/(?:細胞編號|Cell[- ]?ID)\s*[：:]?\s*(\d+)/i);
                    const addrMatch = block.match(/(?:細胞地址|基地[臺台]地址|門牌地址|地址)\s*[：:]?\s*([^\r\n]+)/);
                    const azMatch = block.match(/(?:定位基地[臺台]方向角|基地[臺台](?:方向角|方位角)|天線方位角|Azimuth|Bearing|Dir)\s*[：:]?\s*(-?\d+(?:\.\d+)?)/i);
                    const phoneMatch = block.match(/(?:行動電話號碼|行動電話|門號)\s*[：:]?\s*(8869\d{8}|09\d{8})/);
                    const tower = parsePortalCoordinateSection(
                        block,
                        "基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\\s*Station\\s*(?:Coordinates?|Location)",
                        "三角定位\\s*[（(]?GMLC[）)]?經緯度|行動電話號碼"
                    );
                    const gmlc = parsePortalCoordinateSection(
                        block,
                        "三角定位\\s*[（(]?GMLC[）)]?經緯度",
                        "行動電話號碼|用戶在國內|尚未收到業者回覆"
                    );

                    // 無法定位或缺少有效基地臺座標的紀錄保留於統計，但不送入既有地圖繪製
                    if (!isSuccess) return;
                    if (!tower) {
                        missingTowerCount += 1;
                        return;
                    }

                    const rawAzimuth = azMatch ? parseFloat(azMatch[1]) : null;
                    if (rawAzimuth === null) missingAzimuthCount += 1;
                    else if (!isValidAzimuth(rawAzimuth)) invalidAzimuthCount += 1;

                    records.push({
                        lat: tower.lat,
                        lng: tower.lng,
                        azi: isValidAzimuth(rawAzimuth) ? rawAzimuth : null,
                        phone: normalizePhone(phoneMatch ? phoneMatch[1] : globalPhone),
                        reqTime: reqMatch ? reqMatch[1].replace(/-/g, "/") : "",
                        responseTime: respMatch ? respMatch[1].replace(/-/g, "/") : "",
                        regTime: regMatch ? regMatch[1].replace(/-/g, "/") : "",
                        sequence: (start[1] && !isNaN(parseInt(start[1], 10))) ? parseInt(start[1], 10) : (index + 1),
                        towerId: towerIdMatch ? towerIdMatch[1] : "",
                        cellId: cellMatch ? cellMatch[1] : "",
                        address: addrMatch ? addrMatch[1].trim() : "",
                        status: statusText,
                        gmlcLat: gmlc ? gmlc.lat : null,
                        gmlcLng: gmlc ? gmlc.lng : null
                    });
                });

                // 去重保護：僅當座標、方位角、時間、基地台編號、細胞編號完全一致時才視為重複
                const uniqueRecords = [];
                records.forEach((r) => {
                    const isDup = uniqueRecords.some(item =>
                        Math.abs(item.lat - r.lat) < 0.00001 &&
                        Math.abs(item.lng - r.lng) < 0.00001 &&
                        item.azi === r.azi &&
                        (item.reqTime || item.regTime) === (r.reqTime || r.regTime) &&
                        ((!item.towerId && !r.towerId) || item.towerId === r.towerId) &&
                        ((!item.cellId && !r.cellId) || item.cellId === r.cellId)
                    );
                    if (!isDup) uniqueRecords.push(r);
                });

                return {
                    records: uniqueRecords,
                    declaredCount: declaredMatch ? parseInt(declaredMatch[1], 10) : recordStarts.length,
                    parsedCount: recordStarts.length,
                    completedCount,
                    failedCount,
                    missingTowerCount,
                    missingAzimuthCount,
                    invalidAzimuthCount
                };
            }

            // 核心解析邏輯 (支援多筆段落切割 Block Splitting、全格式 DMS/DMM 座標與 5 筆上限截取)
            function parse() {
                const text = normalizeInputText(document.getElementById("rawInput").value);
                if (!text) return alert("請先貼上內容！");
                const resultActions = document.getElementById("resultActions");
                if (resultActions) resultActions.classList.add("hidden");

                // 1. 全局抓取門號 (作為預設 fallback)
                let globalPhone = "";
                const phMatch = text.match(
                    /(?:行動電話號碼|門號)[：:\s]*\n*([0-9]+)/
                ) || text.match(
                    /(?:[^0-9\.]|^)(09\d{8}|8869\d{8})(?:[^0-9\.]|$)/
                );
                if (phMatch) {
                    let ph = phMatch[1];
                    if (ph.startsWith("886")) ph = "0" + ph.substring(3);
                    if (ph.length >= 8) globalPhone = ph;
                }

                // 2. 完整調閱回覆使用專用解析器；其他內容維持既有解析流程
                const portalResult = isPortalResponse(text) ? parsePortalResponse(text, globalPhone) : null;
                let rawBlocks = portalResult ? [] : text.split(/\n\s*\n+/);
                if (!portalResult && rawBlocks.length <= 1) {
                    rawBlocks = text.split(/(?=(?:行動電話號碼|定位請求|註冊基地|細胞經緯度|基地[臺台]資訊|基地[臺台]編號))/g);
                }
                if (!portalResult && rawBlocks.length <= 1) {
                    rawBlocks = text.split('\n');
                }

                const parsedList = portalResult ? portalResult.records.slice() : [];
                const timePattern = "(\\d{4}[-\\/]\\d{1,2}[-\\/]\\d{1,2}\\s+\\d{1,2}:\\d{1,2}:\\d{1,2})";

                rawBlocks.forEach((block) => {
                    if (!block.trim()) return;

                    // A. 抓門號
                    let blockPhone = globalPhone;
                    const bPh = block.match(/(?:行動電話號碼|門號)[：:\s]*\n*([0-9]+)/) || block.match(/(?:[^0-9\.]|^)(09\d{8}|8869\d{8})(?:[^0-9\.]|$)/);
                    if (bPh) {
                        let p = bPh[1];
                        if (p.startsWith("886")) p = "0" + p.substring(3);
                        if (p.length >= 8) blockPhone = p;
                    }

                    // B. 抓時間
                    const reqM = block.match(new RegExp(`(?:定位請求|Positioning Request|detected\\s+at)[^:：\\d]*[:：]?\\s*${timePattern}`, "i"));
                    const reqTime = reqM ? reqM[1].replace(/-/g, "/") : "";

                    const regM = block.match(new RegExp(`(?:註冊基地|最後註冊|Base Station Reg)[^:：\\d]*[:：]?\\s*${timePattern}`));
                    const regTime = regM ? regM[1].replace(/-/g, "/") : "";

                    // C. 抓方位角
                    const azM = block.match(/(?:方位|方向|Dir|Azimuth|Bearing)[^0-9\n]*([0-9]+(?:\.[0-9]+)?)/i);
                    const rawAzi = azM ? parseFloat(azM[1]) : null;
                    const azi = isValidAzimuth(rawAzi) ? rawAzi : null;

                    // D. 抓基地臺編號、細胞編號、地址與回應時間
                    const towerIdM = block.match(/(?:基地[臺台]編號|註冊基地[臺台]編號|Tower[- ]?ID)\s*[：:]?\s*([A-Za-z0-9_-]+)/i);
                    const cellIdM = block.match(/(?:細胞編號|Cell[- ]?ID)\s*[：:]?\s*(\d+)/i);
                    const addrM = block.match(/(?:細胞地址|基地[臺台]地址|門牌地址|地址)\s*[：:]?\s*([^\r\n]+)/);
                    const respM = block.match(/(?:定位回應的時間|定位回應時間|回應定位時間)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
                    const blockTowerId = towerIdM ? towerIdM[1] : "";
                    const blockCellId = cellIdM ? cellIdM[1] : "";
                    const blockAddr = addrM ? addrM[1].trim() : "";
                    const blockRespTime = respM ? respM[1].replace(/-/g, "/") : "";

                    // E. 抓經緯度 (支援全格式: DMS/DMM 與 DD 成對)
                    let foundCoords = parseDMSToDD(block);

                    if (foundCoords.length === 0) {
                        // 模式 A: 十進位 DD 成對座標 (matchAll)
                        const pairMatches = [
                            ...block.matchAll(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/g),
                            ...block.matchAll(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/g)
                        ];

                        if (pairMatches.length > 0) {
                            pairMatches.forEach(pm => {
                                const v1 = parseFloat(pm[1]);
                                const v2 = parseFloat(pm[2]);
                                const bLat = v1 < 100 ? v1 : v2;
                                const bLng = v1 < 100 ? v2 : v1;
                                foundCoords.push({ lat: bLat, lng: bLng });
                            });
                        } else {
                            // 模式 B: 關鍵字個別搜尋
                            const latM = block.match(/(?:緯度|Latitude|Lat)[^0-9\n]*([0-9]+\.[0-9]+)/i);
                            const lngM = block.match(/(?:經度|Longitude|Lng)[^0-9\n]*([0-9]+\.[0-9]+)/i);
                            if (latM && lngM) {
                                foundCoords.push({ lat: parseFloat(latM[1]), lng: parseFloat(lngM[1]) });
                            }
                        }
                    }

                    foundCoords.forEach(c => {
                        if (c.lat >= config.boundsLatMin && c.lat <= config.boundsLatMax &&
                            c.lng >= config.boundsLngMin && c.lng <= config.boundsLngMax) {

                            const isDup = parsedList.some(item =>
                                Math.abs(item.lat - c.lat) < 0.00001 &&
                                Math.abs(item.lng - c.lng) < 0.00001 &&
                                (item.reqTime || item.regTime) === (reqTime || regTime) &&
                                item.azi === azi &&
                                ((!item.towerId && !blockTowerId) || item.towerId === blockTowerId) &&
                                ((!item.cellId && !blockCellId) || item.cellId === blockCellId)
                            );

                            if (!isDup) {
                                parsedList.push({
                                    lat: c.lat,
                                    lng: c.lng,
                                    azi: azi,
                                    phone: blockPhone,
                                    reqTime: reqTime,
                                    responseTime: blockRespTime,
                                    regTime: regTime,
                                    towerId: blockTowerId,
                                    cellId: blockCellId,
                                    address: blockAddr
                                });
                            }
                        }
                    });
                });

                // 若段落分割未找到，嘗試全文備用成對搜尋 (全域捕捉)
                if (!portalResult && parsedList.length === 0) {
                    const globalPairs = [...text.matchAll(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/g)];
                    globalPairs.forEach(m => {
                        const v1 = parseFloat(m[1]), v2 = parseFloat(m[2]);
                        const lat = v1 < 100 ? v1 : v2;
                        const lng = v1 < 100 ? v2 : v1;
                        if (!parsedList.some(x => x.lat === lat && x.lng === lng)) {
                            parsedList.push({
                                lat, lng, azi: null, phone: globalPhone, reqTime: "", regTime: ""
                            });
                        }
                    });
                }

                if (portalResult && parsedList.length === 0) {
                    return alert(`偵測到 ${portalResult.parsedCount} 筆定位紀錄，但沒有可繪製的有效基地臺座標。`);
                }

                if (parsedList.length === 0) {
                    return alert("找不到有效的台灣座標數值，請確認內容。");
                }

                // 3. 時間排序 (相容西元與民國紀年，防範 Invalid Date 造成排序跳躍)
                parsedList.sort((a, b) => {
                    const timeA = parseDateTimeToMs(a.reqTime || a.regTime);
                    const timeB = parseDateTimeToMs(b.reqTime || b.regTime);
                    if (timeA && timeB) {
                        return timeA - timeB;
                    }
                    return 0;
                });

                // 4. 5 筆上限截取與提示控制
                const originalCount = parsedList.length;
                let finalTowers = parsedList;

                const batchNotice = document.getElementById("batchNotice");
                const batchNoticeText = document.getElementById("batchNoticeText");

                if (portalResult) {
                    if (originalCount > config.maxBatchLimit) {
                        finalTowers = parsedList.slice(-config.maxBatchLimit);
                    }
                    if (batchNotice && batchNoticeText) {
                        batchNotice.classList.remove("hidden");
                        const limitText = originalCount > config.maxBatchLimit
                            ? `，目前依既有上限載入最新 ${config.maxBatchLimit} 筆`
                            : "";
                        const sectorReadyCount = finalTowers.filter(t => isValidAzimuth(t.azi)).length;
                        const qualityNotes = [];
                        if (portalResult.missingTowerCount) qualityNotes.push(`${portalResult.missingTowerCount} 筆缺少有效基地台座標`);
                        if (portalResult.missingAzimuthCount) qualityNotes.push(`${portalResult.missingAzimuthCount} 筆未提供方位角`);
                        if (portalResult.invalidAzimuthCount) qualityNotes.push(`${portalResult.invalidAzimuthCount} 筆方位角無效`);
                        if (originalCount === 1 && qualityNotes.length === 0) {
                            const tower = finalTowers[0];
                            const available = ["基地台", tower.gmlcLat !== null && tower.gmlcLng !== null ? "GMLC" : "", isValidAzimuth(tower.azi) ? "方位角" : ""].filter(Boolean);
                            batchNoticeText.innerText = `已辨識 1 筆定位資料：${available.join("、")}皆可用。`;
                        } else {
                            const qualityText = qualityNotes.length ? `；待確認：${qualityNotes.join('、')}` : "";
                            batchNoticeText.innerText = `已辨識 ${originalCount} 筆定位資料，已依請求時間排序；可進行扇形分析 ${sectorReadyCount} 筆${qualityText}${limitText}。`;
                        }
                    }
                } else if (originalCount > config.maxBatchLimit) {
                    finalTowers = parsedList.slice(-config.maxBatchLimit);
                    if (batchNotice && batchNoticeText) {
                        batchNotice.classList.remove("hidden");
                        batchNoticeText.innerText = `偵測到 ${originalCount} 筆定位資料，已為您載入最新 ${config.maxBatchLimit} 筆軌跡。`;
                    }
                } else if (originalCount > 1) {
                    if (batchNotice && batchNoticeText) {
                        batchNotice.classList.remove("hidden");
                        batchNoticeText.innerText = `成功解析出 ${originalCount} 筆定位軌跡（已按時間順序排列）。`;
                    }
                } else {
                    if (batchNotice) batchNotice.classList.add("hidden");
                }

                // 5. 更新模型與 UI
                data.towers = finalTowers;
                data.lat = finalTowers[0].lat;
                data.lng = finalTowers[0].lng;
                data.azi = finalTowers[0].azi;
                data.phone = finalTowers[0].phone;
                data.reqTime = finalTowers[0].reqTime;
                data.regTime = finalTowers[0].regTime;
                data.responseTime = finalTowers[0].responseTime || "";
                data.towerId = finalTowers[0].towerId || "";
                data.cellId = finalTowers[0].cellId || "";
                data.address = finalTowers[0].address || "";
                selectedHistoryIds.clear();
                isHistoryCompareActive = false;
                isHistorySingleView = false;
                isIntersectionOnly = false;

                if (resultActions) resultActions.classList.remove("hidden");

                // 清除舊目標地址
                data.addrName = "";
                data.addrLat = null;
                data.addrLng = null;

                syncUI();
                updateMap(true, finalTowers.length > 1 ? "bounds" : "base"); // true = 存入歷史
                switchTab('base'); // 自動切換至定位資料分頁

                // 手機端解析成功後，自動收合抽屜以露出全螢幕地圖與動態軌跡
                if (isMobileLayout()) {
                    toggleConsole(true);
                }
            }

            // 從輸入框更新資料 (支援手動輸入方位角角度並即時重繪扇形)
            function updateFromInput(save = false) {
                const latEl = document.getElementById("lat");
                const lngEl = document.getElementById("lng");
                const azEl = document.getElementById("azi");
                const phEl = document.getElementById("phone");
                const reqEl = document.getElementById("reqTime");
                const regEl = document.getElementById("regTime");

                const addrLatEl = document.getElementById("addrLat");
                const addrLngEl = document.getElementById("addrLng");
                const targetAddrEl = document.getElementById("targetAddr");

                const lat = latEl ? parseFloat(latEl.value) : NaN;
                const lng = lngEl ? parseFloat(lngEl.value) : NaN;
                const az = (azEl && azEl.value.trim() !== "") ? parseFloat(azEl.value) : NaN;
                const ph = phEl ? phEl.value : "";
                const req = reqEl ? reqEl.value : "";
                const reg = regEl ? regEl.value : "";

                const addrLatVal = addrLatEl ? parseFloat(addrLatEl.value) : NaN;
                const addrLngVal = addrLngEl ? parseFloat(addrLngEl.value) : NaN;
                const addrNameVal = targetAddrEl ? targetAddrEl.value : "";

                if (!isNaN(lat) && !isNaN(lng)) {
                    data.lat = lat;
                    data.lng = lng;
                    data.azi = isNaN(az) ? null : az;
                    data.phone = ph;
                    data.reqTime = req.replace(/-/g, "/");
                    data.regTime = reg.replace(/-/g, "/");
                    data.addrLat = isNaN(addrLatVal) ? null : addrLatVal;
                    data.addrLng = isNaN(addrLngVal) ? null : addrLngVal;
                    data.addrName = addrNameVal || "";

                    // 核心關鍵修正：手動修改單點時，同步覆寫 data.towers 陣列，確保扇形與點位正確繪製
                    data.towers = [{
                        lat: data.lat,
                        lng: data.lng,
                        azi: data.azi,
                        phone: data.phone,
                        reqTime: data.reqTime,
                        regTime: data.regTime
                    }];

                    // 手動修改後回歸一般單點模式。
                    if (selectedHistoryIds.size > 0 || isHistoryCompareActive) {
                        selectedHistoryIds.clear();
                        isHistoryCompareActive = false;
                        isHistorySingleView = false;
                        isIntersectionOnly = false;
                        renderHistory();
                    }

                    updateMap(save, "base");

                    // 若主動按下「套用變更並重繪」，手機版收合抽屜以露出全螢幕地圖
                    if (save && isMobileLayout()) {
                        toggleConsole(true);
                    }
                }
            }

            // 更新 UI 顯示 (同步資料至輸入框)
            function syncUI() {
                document.getElementById("lat").value = data.lat !== null ? data.lat : "";
                document.getElementById("lng").value = data.lng !== null ? data.lng : "";
                document.getElementById("azi").value = data.azi !== null ? data.azi : "";
                document.getElementById("phone").value = data.phone;
                document.getElementById("reqTime").value = data.reqTime;
                document.getElementById("regTime").value = data.regTime;

                document.getElementById("addrLat").value = data.addrLat !== null ? data.addrLat : "";
                document.getElementById("addrLng").value = data.addrLng !== null ? data.addrLng : "";

                // 只有當輸入框無內容時才以解析名稱覆蓋；保留使用者打字，防止同名地名直接覆蓋使用者輸入
                const addrInput = document.getElementById("targetAddr");
                if (addrInput && (!addrInput.value.trim() || data.addrName === "")) {
                    addrInput.value = data.addrName;
                }

                // 商業級狀態控制：有有效座標時呈現快捷行動列，無資料時平順隱藏
                const resultActions = document.getElementById("resultActions");
                if (resultActions) {
                    if (data.lat !== null && data.lng !== null && !isNaN(data.lat) && !isNaN(data.lng)) {
                        resultActions.classList.remove("hidden");
                    } else {
                        resultActions.classList.add("hidden");
                    }
                }
            }

            // 計算航向角（相對方位角）
            function calculateBearing(lat1, lng1, lat2, lng2) {
                if (Math.abs(lat1 - lat2) < 0.000001 && Math.abs(lng1 - lng2) < 0.000001) {
                    return 0; // 同點位避免 0/0 特殊解
                }
                const dLng = (lng2 - lng1) * Math.PI / 180;
                const rLat1 = lat1 * Math.PI / 180;
                const rLat2 = lat2 * Math.PI / 180;
                const y = Math.sin(dLng) * Math.cos(rLat2);
                const x = Math.cos(rLat1) * Math.sin(rLat2) -
                          Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);
                let brng = Math.atan2(y, x) * 180 / Math.PI;
                return (brng + 360) % 360;
            }

            // 判斷相對角度是否在扇形夾角內 (考慮跨 360 度週期)
            function isAngleWithinSector(angle, center, aperture) {
                const half = aperture / 2;
                let diff = Math.abs(angle - center) % 360;
                if (diff > 180) {
                    diff = 360 - diff;
                }
                return diff <= half;
            }

            // 非同步解析地址 (Geocoding)
            function locateAddress() {
                let addr = document.getElementById("targetAddr").value.trim();
                if (!addr) return alert("請先輸入要定位的地址！");

                data.searchQuery = addr; // 保存使用者輸入的原始查詢字詞

                // 智慧模糊容錯 A：簡繁體轉譯
                addr = addr.replace(/台/g, "臺");

                // 智慧模糊容錯 B：剔除詳細室內樓層或房號字尾，僅保留主建物門牌以增加搜尋命中率
                let cleanAddr = addr.replace(/(?:\d+\s*[樓室Ff].*)$/g, "");
                cleanAddr = cleanAddr.replace(/(?:[0-9一二三四五六七八九十百]+(?:樓|室|f|F|層).*)$/g, "");

                const btn = document.getElementById("btnLocateAddr");
                const origIcon = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i>';

                // 限制在台灣經緯度範圍內搜尋
                const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanAddr)}&format=json&limit=1&viewbox=118,21,124,27&bounded=1`;

                fetch(url, {
                    headers: {
                        "Accept-Language": "zh-TW,zh;q=0.9"
                    }
                })
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP 狀態碼異常 ${res.status}`);
                    }
                    return res.json();
                })
                .then(res => {
                    btn.disabled = false;
                    btn.innerHTML = origIcon;

                    if (res && res.length > 0) {
                        const result = res[0];
                        data.addrLat = parseFloat(parseFloat(result.lat).toFixed(6));
                        data.addrLng = parseFloat(parseFloat(result.lon).toFixed(6));

                        // 智慧擷取地名描述，自動提取縣市、市區鄉鎮與地標名，防止同名誤判
                        const parts = result.display_name.split(',').map(p => p.trim());
                        let formattedName = parts[0];
                        if (parts.length > 2) {
                            const county = parts.find(p => p.endsWith("市") || p.endsWith("縣"));
                            const town = parts.find(p => p.endsWith("區") || p.endsWith("鄉") || p.endsWith("鎮") || p.endsWith("市") && p !== county);
                            if (county && town) {
                                formattedName = `${county}${town} ${parts[0]}`;
                            } else if (county) {
                                formattedName = `${county} ${parts[0]}`;
                            }
                        }
                        data.addrName = formattedName;

                        syncUI();
                        updateMap(false);
                    } else {
                        alert("找不到該地址的定位資訊。如果是偏鄉門牌，建議直接點擊「地圖選點」在地圖上手動點選！");
                    }
                })
                .catch(err => {
                    console.error("Geocoding error:", err);
                    btn.disabled = false;
                    btn.innerHTML = origIcon;
                    alert("地址解析連線失敗，請檢查網路，或直接使用手動輸入座標 / 地圖選點功能。");
                });
            }

            // 一鍵清除目標地址
            function clearAddress() {
                data.addrLat = null;
                data.addrLng = null;
                data.addrName = "";
                data.searchQuery = "";

                syncUI();

                // 若當前對應著某個歷史紀錄，同步清除該歷史紀錄的空間欄位
                if (currentHistoryId !== null) {
                    const idx = history.findIndex(h => h.id === currentHistoryId);
                    if (idx !== -1) {
                        history[idx].addrLat = null;
                        history[idx].addrLng = null;
                        history[idx].addrName = "";
                        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
                        renderHistory();
                    }
                }

                updateMap(false);
            }

            // 切換地圖選點模式
            function toggleMapSelect(e, forceState) {
                if (e) e.preventDefault();

                if (forceState !== undefined) {
                    isMapSelectActive = forceState;
                } else {
                    isMapSelectActive = !isMapSelectActive;
                }

                const btn = document.getElementById("btnMapSelect");
                const statusText = document.getElementById("mapSelectStatus");

                if (isMapSelectActive) {
                    btn.classList.remove("text-accent");
                    btn.classList.add("text-orange-500", "font-bold");
                    statusText.innerText = "請點擊地圖...";
                    if (map) {
                        map.getContainer().style.cursor = 'crosshair';
                    }
                } else {
                    btn.classList.remove("text-orange-500", "font-bold");
                    btn.classList.add("text-accent");
                    statusText.innerText = "地圖選點";
                    if (map) {
                        map.getContainer().style.cursor = '';
                    }
                }
            }

            // 渲染多點時間軸清單 (Tab 2)
            function renderMultiTowerList() {
                const container = document.getElementById("multiTowerContainer");
                const singleForm = document.getElementById("singleTowerForm");
                const listEl = document.getElementById("multiTowerList");
                const countEl = document.getElementById("multiTowerCount");
                const tabLabel = document.getElementById("tab-label-base");

                const towers = data.towers || [];

                if (towers.length <= 1) {
                    if (container) container.classList.add("hidden");
                    if (singleForm) singleForm.classList.remove("hidden");
                    if (tabLabel) tabLabel.innerText = "定位資料";
                    return;
                }

                if (container) container.classList.remove("hidden");
                if (singleForm) singleForm.classList.add("hidden");
                if (countEl) countEl.innerText = towers.length;
                if (tabLabel) tabLabel.innerText = `軌跡資料 (${towers.length})`;

                if (listEl) {
                    listEl.innerHTML = "";
                    towers.forEach((t, i) => {
                        const num = i + 1;
                        const item = document.createElement("div");
                        item.className = "bg-white/90 border border-slate-200 rounded-xl p-2.5 shadow-sm hover:border-accent hover:shadow-md transition-all cursor-pointer space-y-1 text-xs group";
                        item.onclick = () => focusTower(i);

                        item.innerHTML = `
                            <div class="flex justify-between items-center font-bold text-slate-800">
                                <span class="flex items-center gap-1.5">
                                    <span class="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-mono shadow-sm font-bold">${num}</span>
                                    <span class="font-mono text-primary">${esc(t.lat)}, ${esc(t.lng)}</span>
                                </span>
                                ${t.azi !== null && t.azi !== undefined ? `<span class="text-[10px] text-accent font-medium bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">🧭 ${esc(t.azi)}°</span>` : ""}
                            </div>
                            <div class="flex justify-between items-center text-[11px] text-slate-500 font-mono">
                                <span>${t.reqTime ? `🕒 ${esc(t.reqTime)}` : (t.phone ? `📱 ${esc(t.phone)}` : '點位 ' + num)}</span>
                                <span class="text-accent opacity-0 group-hover:opacity-100 transition-opacity">對焦 <i class="fa-solid fa-arrow-right"></i></span>
                            </div>
                        `;
                        listEl.appendChild(item);
                    });
                }
            }

            // 多點點擊平移對焦
            function focusTower(idx) {
                if (!data.towers || !data.towers[idx]) return;
                const t = data.towers[idx];
                if (map) {
                    map.setView([t.lat, t.lng], 18);
                }
            }

            // 更新地圖與歷史紀錄 (支援單點/批次軌跡與多筆歷史疊加比對)
            function updateMap(save, focusType) {
                const mapDiv = document.getElementById("map");
                const mapContainer = document.getElementById("map-container");

                mapDiv.classList.remove("hidden");
                if (mapContainer) mapContainer.classList.remove("hidden");

                // 清除過往多點圖層
                multiTowerLayers.forEach(l => {
                    if (map && l) map.removeLayer(l);
                });
                multiTowerLayers = [];

                if (marker) { map.removeLayer(marker); marker = null; }
                if (sector) { map.removeLayer(sector); sector = null; }

                // 智慧中心點計算
                let centerLat = 23.6978;
                let centerLng = 120.9605;
                let defaultZoom = 8;

                if (!map) {
                    if (data.lat !== null && data.lng !== null) {
                        centerLat = data.lat;
                        centerLng = data.lng;
                        defaultZoom = config.defaultZoom;
                    }
                    map = L.map("map", { maxZoom: 19 }).setView([centerLat, centerLng], defaultZoom);
                    const osmLayer = L.tileLayer(config.mapTileUrl, {
                        maxZoom: 19,
                        maxNativeZoom: 19,
                        subdomains: 'abc',
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    });
                    osmLayer.on('tileerror', function(error, tile) {
                        // 雙層自動容錯：若主圖磚伺服器連線異常，自動備援降級為內政部國土測繪圖資 (100% 繁體中文)
                        const fallbackUrl = `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/${error.coords.z}/${error.coords.y}/${error.coords.x}`;
                        if (tile.src !== fallbackUrl) {
                            tile.src = fallbackUrl;
                        }
                    });
                    osmLayer.addTo(map);

                    const nlscLayer = L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
                        maxZoom: 19,
                        maxNativeZoom: 19,
                        attribution: '&copy; <a href="https://maps.nlsc.gov.tw">國土測繪圖資服務雲</a>'
                    });

                    const satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
                        maxZoom: 18,
                        maxNativeZoom: 18,
                        attribution: '&copy; Esri'
                    });

                    // 支援一鍵快速切換底圖 (繁中 OSM / 臺灣通用電子地圖 / 衛星空照圖)
                    L.control.layers({
                        "🗺️ OpenStreetMap (繁體中文)": osmLayer,
                        "🇹🇼 臺灣通用電子地圖 (國土測繪)": nlscLayer,
                        "🛰️ 高解析衛星空照圖": satLayer
                    }, null, { position: "topright" }).addTo(map);

                    // 底圖切換時動態同步地圖最大縮放層級，各底圖達到自身原生上限即停止放大，避免全白
                    map.on("baselayerchange", function (e) {
                        const targetMax = (e.layer && e.layer.options && e.layer.options.maxZoom) ? e.layer.options.maxZoom : 19;
                        map.setMaxZoom(targetMax);
                        if (map.getZoom() > targetMax) {
                            map.setZoom(targetMax);
                        }
                    });

                    map.on("click", (e) => {
                        if (!isMapSelectActive) return;
                        data.addrLat = parseFloat(e.latlng.lat.toFixed(6));
                        data.addrLng = parseFloat(e.latlng.lng.toFixed(6));
                        data.addrName = "地圖自訂點";
                        data.searchQuery = "";
                        toggleMapSelect(null, false);
                        syncUI();
                        updateMap(false, "addr");
                        switchTab('compare');
                    });

                    const floatingConsole = document.getElementById("floating-console");
                    if (floatingConsole && L.DomEvent) {
                        L.DomEvent.disableClickPropagation(floatingConsole);
                        L.DomEvent.disableScrollPropagation(floatingConsole);
                    }
                } else {
                    if (!focusType) {
                        setTimeout(() => map.invalidateSize(), 100);
                    }
                }

                // --- 模式分支 A：多筆歷史紀錄疊加比對模式 (當選取 >= 2 筆時) ---
                if (isHistoryCompareActive && selectedHistoryIds.size >= 2) {
                    renderMultiHistoryComparison();
                    return;
                }

                // --- 模式分支 B：一般單筆 / 多點軌跡模式 ---
                let towers = data.towers && data.towers.length > 0 ? data.towers : [];
                if (towers.length === 0 && data.lat !== null && data.lng !== null) {
                    towers = [{
                        lat: data.lat, lng: data.lng, azi: data.azi,
                        phone: data.phone, reqTime: data.reqTime, regTime: data.regTime
                    }];
                    data.towers = towers;
                }

                renderMultiTowerList();

                const hasBase = towers.length > 0;
                const hasAddr = data.addrLat !== null && data.addrLng !== null;

                if (hasBase) {
                    centerLat = towers[0].lat;
                    centerLng = towers[0].lng;
                    defaultZoom = config.defaultZoom;
                } else if (hasAddr) {
                    centerLat = data.addrLat;
                    centerLng = data.addrLng;
                    defaultZoom = config.defaultZoom;
                }

                // 收集所有點位計算 Bounds
                const allCoords = [];
                if (hasAddr) allCoords.push([data.addrLat, data.addrLng]);

                // --- 1. 繪製基地台點位與寶藍清透扇形 ---
                if (hasBase) {
                    towers.forEach((t, i) => {
                        allCoords.push([t.lat, t.lng]);

                        let popupText = `<b>📍 基地台點位 #${i + 1}</b><br>${esc(t.lat)}, ${esc(t.lng)}`;
                        if (t.phone) popupText += `<br>門號: ${esc(t.phone)}`;
                        if (t.reqTime) popupText += `<br>🕒 請求: ${esc(t.reqTime)}`;
                        if (t.regTime) popupText += `<br>📡 註冊: ${esc(t.regTime)}`;
                        if (t.towerId || t.cellId) popupText += `<br>🏢 基地台: ${esc(t.towerId || "-")}${t.cellId ? ` / Cell: ${esc(t.cellId)}` : ""}`;
                        if (t.address) popupText += `<br>📍 地址: ${esc(t.address)}`;
                        if (t.azi !== null && t.azi !== undefined && !isNaN(t.azi)) popupText += `<br>🧭 方位: ${esc(t.azi)}°`;

                        let m;
                        if (towers.length > 1) {
                            // 多點模式：使用帶號碼的數字圓圈 Badge Icon
                            const badgeHtml = `<div class="w-6 h-6 rounded-full bg-blue-600 border-2 border-white text-white font-mono font-bold text-xs flex items-center justify-center shadow-md">${i + 1}</div>`;
                            const customIcon = L.divIcon({
                                html: badgeHtml,
                                className: 'custom-badge-icon',
                                iconSize: [24, 24],
                                iconAnchor: [12, 12]
                            });
                            m = L.marker([t.lat, t.lng], { icon: customIcon }).addTo(map).bindPopup(popupText);
                        } else {
                            // 單點模式
                            m = L.marker([t.lat, t.lng]).addTo(map).bindPopup(popupText);
                            if (i === 0 && focusType !== "addr") m.openPopup();
                        }
                        multiTowerLayers.push(m);

                        // GMLC 為業者回傳的裝置定位參考點；基地台位置只用於扇形覆蓋分析。
                        if (t.gmlcLat !== null && t.gmlcLat !== undefined &&
                            t.gmlcLng !== null && t.gmlcLng !== undefined) {
                            allCoords.push([t.gmlcLat, t.gmlcLng]);
                            const gmlcIcon = L.divIcon({
                                html: '<div class="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-md"></div>',
                                className: 'custom-gmlc-icon',
                                iconSize: [16, 16],
                                iconAnchor: [8, 8]
                            });
                            const gmlcPopup = `<b>🎯 GMLC 業者定位參考點 #${i + 1}</b><br>${esc(t.gmlcLat)}, ${esc(t.gmlcLng)}<br><span class="text-[10px] text-slate-500">業者回傳的裝置位置推估；非精確實際位置</span>`;
                            const gmlcMarker = L.marker([t.gmlcLat, t.gmlcLng], { icon: gmlcIcon })
                                .addTo(map)
                                .bindPopup(gmlcPopup);
                            multiTowerLayers.push(gmlcMarker);
                        }

                        // 繪製寶藍色 15% 清透扇形 (Alpha 疊加，重疊區域自動加深色調不蓋圖)
                        if (t.azi !== null && t.azi !== undefined && !isNaN(t.azi)) {
                            const r = config.sectorRadius;
                            const halfApp = config.sectorAperture / 2;
                            const startAngle = (t.azi - halfApp) * (Math.PI / 180);
                            const endAngle = (t.azi + halfApp) * (Math.PI / 180);
                            const points = [[t.lat, t.lng]];

                            for (let k = 0; k <= 20; k++) {
                                const angle = startAngle + (endAngle - startAngle) * (k / 20);
                                const dLat = (r / 111320) * Math.cos(angle);
                                const dLng = (r / (111320 * Math.cos(t.lat * (Math.PI / 180)))) * Math.sin(angle);
                                points.push([t.lat + dLat, t.lng + dLng]);
                            }
                            points.push([t.lat, t.lng]);

                            const secPoly = L.polygon(points, {
                                color: config.sectorColor,       // #2563eb 寶藍色
                                fillColor: config.sectorColor,
                                fillOpacity: config.sectorFillOpacity, // 0.15 清透疊加
                                weight: 1.5,
                                opacity: 0.6
                            }).addTo(map);

                            multiTowerLayers.push(secPoly);
                        }
                    });

                    // 繪製多點軌跡連線 (Polyline Path)
                    if (towers.length > 1 && !isHistorySingleView) {
                        const pathCoords = towers.map(t => [
                            t.gmlcLat !== null && t.gmlcLat !== undefined ? t.gmlcLat : t.lat,
                            t.gmlcLng !== null && t.gmlcLng !== undefined ? t.gmlcLng : t.lng
                        ]);
                        const pathLine = L.polyline(pathCoords, {
                            color: "#2563eb",
                            weight: 3,
                            dashArray: "6, 6",
                            opacity: 0.8
                        }).addTo(map);

                        pathLine.bindTooltip("👣 GMLC 定位移動軌跡線", { permanent: false, direction: "center" });
                        multiTowerLayers.push(pathLine);
                    }
                }

                // 智慧 Focus 對焦引擎
                if (map && focusType) {
                    if (focusType === "base" && hasBase) {
                        map.setView([towers[0].lat, towers[0].lng], 18);
                    } else if (focusType === "addr" && hasAddr) {
                        map.setView([data.addrLat, data.addrLng], 18);
                    } else if (focusType === "bounds" && allCoords.length > 1) {
                        const bounds = L.latLngBounds(allCoords);
                        map.fitBounds(bounds, getFitBoundsOptions());
                    } else {
                        map.setView([centerLat, centerLng], (hasBase || hasAddr) ? 18 : 8);
                    }
                }

                // --- 2. 繪製目標位置 Marker ---
                if (addrMarker) map.removeLayer(addrMarker);
                if (relationLine) map.removeLayer(relationLine);

                const analysisPanel = document.getElementById("analysisPanel");

                if (hasAddr) {
                    addrMarker = L.marker([data.addrLat, data.addrLng], {
                        draggable: true,
                        title: data.addrName || "目標位置"
                    }).addTo(map);

                    addrMarker.on("dragend", function (e) {
                        const latlng = e.target.getLatLng();
                        data.addrLat = parseFloat(latlng.lat.toFixed(6));
                        data.addrLng = parseFloat(latlng.lng.toFixed(6));
                        if (!data.addrName) {
                            data.addrName = "地圖自訂點";
                        }
                        syncUI();
                        updateMap(false);
                    });

                    let addrDesc = `<b>🏠 目標地址 / 位置</b><br>${esc(data.addrName || "自訂位置")}<br>${esc(data.addrLat)}, ${esc(data.addrLng)}`;
                    addrMarker.bindPopup(addrDesc);
                    if (!hasBase) {
                        addrMarker.openPopup();
                    }

                    // --- 3. 繪製兩者關聯 (只有兩者皆定位時才繪製) ---
                    if (hasBase) {
                        const dist = Math.round(map.distance([data.lat, data.lng], [data.addrLat, data.addrLng]));
                        const bearing = Math.round(calculateBearing(data.lat, data.lng, data.addrLat, data.addrLng));

                        let isCovered = false;
                        let coveredText = "⚠️ 未提供發射方位角";
                        let coveredClass = "text-slate-500";
                        let lineColor = "#64748b";

                        if (data.azi !== null) {
                            const isDirectionMatched = isAngleWithinSector(bearing, data.azi, config.sectorAperture);
                            isCovered = isDirectionMatched && dist <= config.sectorRadius;
                            if (isCovered) {
                                coveredText = "🎯 位於發射扇形內";
                                coveredClass = "text-emerald-600";
                                lineColor = "#10b981";
                            } else if (isDirectionMatched) {
                                coveredText = `⚠️ 方向符合，但超出 ${config.sectorRadius} 公尺顯示半徑`;
                                coveredClass = "text-amber-600";
                                lineColor = "#f59e0b";
                            } else {
                                coveredText = "❌ 位於發射扇形外";
                                coveredClass = "text-rose-600";
                                lineColor = "#ef4444";
                            }
                        }

                        relationLine = L.polyline([[data.lat, data.lng], [data.addrLat, data.addrLng]], {
                            color: lineColor,
                            weight: 2,
                            dashArray: "6, 6"
                        }).addTo(map);

                        const tooltipContent = `📏 ${dist}公尺 / 🧭 方位:${bearing}°<br>${isCovered ? "🎯 覆蓋區內" : "❌ 覆蓋區外"}`;
                        relationLine.bindTooltip(tooltipContent, {
                            permanent: true,
                            direction: "center",
                            className: "relation-tooltip text-xs font-bold px-2 py-1 rounded shadow border-none bg-white/95 text-slate-800"
                        }).openTooltip();

                        addrMarker.openPopup();

                        if (save) {
                            const bounds = L.latLngBounds([[data.lat, data.lng], [data.addrLat, data.addrLng]]);
                            map.fitBounds(bounds, getFitBoundsOptions());
                        }

                        // 更新空間關聯分析 UI 面板
                        if (analysisPanel) {
                            analysisPanel.classList.remove("hidden");
                            document.getElementById("analysisDistance").innerText = `${dist} 公尺`;
                            document.getElementById("analysisBearing").innerText = `${bearing}°`;

                            const nameEl = document.getElementById("analysisResultName");
                            if (nameEl) {
                                nameEl.innerText = data.addrName || "自訂位置";
                            }

                            const covEl = document.getElementById("analysisCoverage");
                            covEl.className = "font-bold " + coveredClass;
                            covEl.innerText = coveredText;

                            // 9. 嚴重超距偏離或地名關鍵字不吻合警告
                            const warningPanel = document.getElementById("analysisWarning");
                            const warningText = document.getElementById("analysisWarningText");
                            if (warningPanel && warningText) {
                                let isMismatch = false;
                                let mismatchReason = "";

                                if (dist > 8000) {
                                    isMismatch = true;
                                    mismatchReason = `定位點距離基地台達 ${Math.round(dist/1000)} 公里，已超出合理覆蓋範圍！`;
                                }

                                if (data.searchQuery) {
                                    // 智慧判定：若為純座標數值查詢（如 23.93, 120.52），直接豁免字詞比對校驗
                                    const isCoordinateQuery = /^[0-9\.,\s-]+$/.test(data.searchQuery.trim());

                                    if (!isCoordinateQuery) {
                                        let cleanInput = data.searchQuery.replace(/臺灣|台灣|臺南|台南|台北|臺北|台中|臺中|高雄|新北|桃園|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江/g, "");
                                        let kw = cleanInput.replace(/派出所|分局|警察局|分駐所|局|處|所|科|辦事處|委員會/g, "").trim();
                                        if (kw.length >= 2) {
                                            const core = kw.substring(0, 2);
                                            if (data.addrName && !data.addrName.includes(core)) {
                                                isMismatch = true;
                                                if (mismatchReason) {
                                                    mismatchReason += ` 且解析地名與搜尋詞「${core}」不吻合！`;
                                                } else {
                                                    mismatchReason = `解析地名與您搜尋的關鍵字「${core}」不吻合，疑似模糊搜尋誤判！`;
                                                }
                                            }
                                        }
                                    }
                                }

                                if (isMismatch) {
                                    warningPanel.classList.remove("hidden");
                                    warningText.innerText = `⚠️ ${mismatchReason}\n建議：若找不到特定地標，請使用右上角「地圖選點」手動標記，或搜尋鄰近道路後再拖曳 Pin 針微調。`;
                                } else {
                                    warningPanel.classList.add("hidden");
                                }
                            }
                        }
                    } else {
                        // 僅有目標地址定位，無基地台定位時，將地圖移至目標位置並縮放
                        if (save) {
                            map.setView([data.addrLat, data.addrLng], config.defaultZoom);
                        }
                        if (analysisPanel) {
                            analysisPanel.classList.add("hidden");
                        }
                        const warningPanel = document.getElementById("analysisWarning");
                        if (warningPanel) {
                            warningPanel.classList.add("hidden");
                        }
                    }
                } else {
                    if (analysisPanel) {
                        analysisPanel.classList.add("hidden");
                    }
                    const warningPanel = document.getElementById("analysisWarning");
                    if (warningPanel) {
                        warningPanel.classList.add("hidden");
                    }
                }

                // 實時自動同步空間微調資訊至當前歷史紀錄中
                if (!save && currentHistoryId !== null) {
                    const idx = history.findIndex(h => h.id === currentHistoryId);
                    if (idx !== -1) {
                        history[idx].addrLat = data.addrLat;
                        history[idx].addrLng = data.addrLng;
                        history[idx].addrName = data.addrName;
                        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
                        renderHistory();
                    }
                }

                if (save) addHistory();
            }

            function openMap() {
                if (data.lat !== null && data.lng !== null)
                    window.open(
                        `https://www.google.com/maps?q=${data.lat},${data.lng}`,
                        "_blank"
                    );
                else alert("無座標");
            }

            // 產生應用程式分享連結：僅保留基地台座標，避免傳遞案件關聯或個人資料。
            function getAppLink() {
                const baseUrl = "https://lianghao02.github.io/Cell-Tower-Map-Locator/";
                const params = new URLSearchParams();
                if (data.lat !== null) params.append('lat', data.lat);
                if (data.lng !== null) params.append('lng', data.lng);
                return baseUrl + "#" + params.toString();
            }

            // 取得完整分享文字 (有/無地址動態修正)
            function getFullText() {
                const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
                const appUrl = getAppLink();

                let t = `${mapUrl}\n`;
                if (data.phone) t += `定位門號: ${data.phone}\n`;
                if (data.reqTime) t += `定位時間: ${data.reqTime}\n`;
                if (data.regTime) t += `註冊時間: ${data.regTime}\n`;
t += `定位經緯度: ${data.lat}, ${data.lng}`;
                if (data.azi !== null) t += ` (方位:${data.azi})`;

                // 若有提供地址資訊，修正輸出文字，加上比對結果
                if (data.addrLat !== null && data.addrLng !== null) {
                    const dist = Math.round(map.distance([data.lat, data.lng], [data.addrLat, data.addrLng]));
                    const bearing = Math.round(calculateBearing(data.lat, data.lng, data.addrLat, data.addrLng));
                    let coveredStatus = "未提供發射方位角";
                    if (data.azi !== null) {
                        const isDirectionMatched = isAngleWithinSector(bearing, data.azi, config.sectorAperture);
                        const isCovered = isDirectionMatched && dist <= config.sectorRadius;
                        coveredStatus = isCovered
                            ? "🎯 位於發射扇形範圍內"
                            : (isDirectionMatched
                                ? `⚠️ 方向符合，但超出 ${config.sectorRadius} 公尺顯示半徑`
                                : "❌ 位於發射扇形範圍外");
                    }

                    t += `\n\n🏠 目標關連位置: ${data.addrName || "自訂位置"}`;
                    t += `\n📍 目標經緯度: ${data.addrLat}, ${data.addrLng}`;
                    t += `\n📏 直線距離: 約 ${dist} 公尺`;
                    t += `\n🧭 相對方位角: ${bearing}° (${coveredStatus})`;
                }

                t += `\n\n📌 專用圖台 (含扇形與地址):\n${appUrl}`;
                return t;
            }

            // --- 幾何計算模組：Sutherland-Hodgman 凸多邊形交集與面積計算 ---

            // 將多邊形點序列規範化為逆時針 (Counter-Clockwise, CCW)
            function ensureCCW(points) {
                if (!points || points.length < 3) return points;
                let signedArea = 0;
                const n = points.length;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    signedArea += (points[j][1] - points[i][1]) * (points[j][0] + points[i][0]);
                }
                if (signedArea > 0) {
                    return [...points].reverse();
                }
                return points;
            }

            // 判斷點 P 是否在有向線段 cp1 -> cp2 的左側 (內部)
            function isInsideEdge(cp1, cp2, p) {
                const cross = (cp2[1] - cp1[1]) * (p[0] - cp1[0]) - (cp2[0] - cp1[0]) * (p[1] - cp1[1]);
                return cross >= -1e-10;
            }

            // 計算兩直線交點
            function computeLineIntersection(s, e, cp1, cp2) {
                const dc = [cp1[0] - cp2[0], cp1[1] - cp2[1]];
                const dp = [s[0] - e[0], s[1] - e[1]];
                const n1 = cp1[0] * cp2[1] - cp1[1] * cp2[0];
                const n2 = s[0] * e[1] - s[1] * e[0];
                const denom = dc[0] * dp[1] - dc[1] * dp[0];
                if (Math.abs(denom) < 1e-12) return s;
                const n3 = 1.0 / denom;
                return [
                    (n1 * dp[0] - n2 * dc[0]) * n3,
                    (n1 * dp[1] - n2 * dc[1]) * n3
                ];
            }

            // Sutherland-Hodgman 凸多邊形剪裁求交集
            function clipPolygon(subjectPoly, clipPoly) {
                let outputList = [...subjectPoly];
                const clipPoints = ensureCCW(clipPoly);

                for (let i = 0; i < clipPoints.length; i++) {
                    const cp1 = clipPoints[i];
                    const cp2 = clipPoints[(i + 1) % clipPoints.length];
                    const inputList = [...outputList];
                    outputList = [];

                    if (inputList.length === 0) break;

                    let s = inputList[inputList.length - 1];
                    for (let j = 0; j < inputList.length; j++) {
                        const p = inputList[j];
                        if (isInsideEdge(cp1, cp2, p)) {
                            if (!isInsideEdge(cp1, cp2, s)) {
                                outputList.push(computeLineIntersection(s, p, cp1, cp2));
                            }
                            outputList.push(p);
                        } else if (isInsideEdge(cp1, cp2, s)) {
                            outputList.push(computeLineIntersection(s, p, cp1, cp2));
                        }
                        s = p;
                    }
                }
                return outputList;
            }

            // 求多個凸多邊形的共同交集
            function intersectMultipleConvexPolygons(polygonList) {
                if (!polygonList || polygonList.length === 0) return null;
                if (polygonList.length === 1) return polygonList[0];

                let current = ensureCCW(polygonList[0]);
                for (let i = 1; i < polygonList.length; i++) {
                    current = clipPolygon(current, polygonList[i]);
                    if (!current || current.length < 3) return null;
                }
                return current;
            }

            // 計算多邊形面積 (平方公尺, Shoelace 結合投影比例)
            function computePolygonAreaM2(points) {
                if (!points || points.length < 3) return 0;
                const n = points.length;
                let sumLat = 0;
                points.forEach(p => sumLat += p[0]);
                const avgLat = sumLat / n;
                const phi = avgLat * Math.PI / 180;
                const mPerDegLat = 111320;
                const mPerDegLng = 111320 * Math.cos(phi);

                let area = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    const x1 = points[i][1] * mPerDegLng;
                    const y1 = points[i][0] * mPerDegLat;
                    const x2 = points[j][1] * mPerDegLng;
                    const y2 = points[j][0] * mPerDegLat;
                    area += (x1 * y2 - x2 * y1);
                }
                return Math.abs(area) / 2.0;
            }

            // 計算多邊形幾何中心 (重心)
            function computePolygonCentroid(points) {
                if (!points || points.length < 3) return null;
                const n = points.length;
                let sumLat = 0, sumLng = 0;
                points.forEach(p => {
                    sumLat += p[0];
                    sumLng += p[1];
                });
                return [sumLat / n, sumLng / n];
            }

            // 繪製多筆歷史紀錄疊加比對圖層 (含扇形交集空間分析)
            function renderMultiHistoryComparison() {
                if (addrMarker) { map.removeLayer(addrMarker); addrMarker = null; }
                if (relationLine) { map.removeLayer(relationLine); relationLine = null; }
                const analysisPanel = document.getElementById("analysisPanel");
                if (analysisPanel) analysisPanel.classList.add("hidden");

                const selectedItems = history.filter(h => selectedHistoryIds.has(h.id));
                const allCoords = [];
                const sectorPolygonsList = []; // 收集各扇形頂點以供交集計算

                selectedItems.forEach((item, itemIdx) => {
                    const colorObj = COMPARE_COLORS[itemIdx % COMPARE_COLORS.length];
                    const numLabel = itemIdx + 1;
                    const itemTowers = (item.towers && item.towers.length > 0) ? item.towers : [{
                        lat: item.lat,
                        lng: item.lng,
                        azi: item.azi,
                        phone: item.phone,
                        reqTime: item.reqTime,
                        regTime: item.regTime
                    }];

                    const hasItemAddr = item.addrLat !== null && item.addrLng !== null && item.addrLat !== undefined;
                    if (hasItemAddr) {
                        allCoords.push([item.addrLat, item.addrLng]);

                        const addrBadgeHtml = `<div style="background-color: ${colorObj.fill}; border: 2px solid #ffffff;" class="w-6 h-6 rounded-full text-white font-mono font-bold text-[10px] flex items-center justify-center shadow-md"><i class="fa-solid fa-house"></i></div>`;
                        const addrIcon = L.divIcon({
                            html: addrBadgeHtml,
                            className: 'custom-badge-icon',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        });
                        const aMarker = L.marker([item.addrLat, item.addrLng], { icon: addrIcon }).addTo(map);
                        aMarker.bindPopup(`<b>🏠 歷史 #${numLabel} 目標地址</b><br>${esc(item.addrName || "自訂點")}<br>${esc(item.addrLat)}, ${esc(item.addrLng)}`);
                        multiTowerLayers.push(aMarker);

                        // 基地台與目標地址連線
                        if (item.lat !== null && item.lng !== null) {
                            const dist = Math.round(map.distance([item.lat, item.lng], [item.addrLat, item.addrLng]));
                            const cLine = L.polyline([[item.lat, item.lng], [item.addrLat, item.addrLng]], {
                                color: colorObj.border,
                                weight: 2,
                                dashArray: "5, 5",
                                opacity: 0.8
                            }).addTo(map);
                            cLine.bindTooltip(`[#${numLabel}] 距離: ${dist}m`, { permanent: false, direction: "center" });
                            multiTowerLayers.push(cLine);
                        }
                    }

                    itemTowers.forEach((t, tIdx) => {
                        if (t.lat === null || t.lng === null) return;
                        allCoords.push([t.lat, t.lng]);

                        const badgeHtml = `<div style="background-color: ${colorObj.fill}; border: 2px solid #ffffff;" class="w-7 h-7 rounded-full text-white font-mono font-bold text-xs flex items-center justify-center shadow-lg">#${numLabel}</div>`;
                        const customIcon = L.divIcon({
                            html: badgeHtml,
                            className: 'custom-compare-icon',
                            iconSize: [28, 28],
                            iconAnchor: [14, 14]
                        });

                        let popupText = `<div class="space-y-1">
                            <div class="font-bold flex items-center gap-1.5" style="color: ${colorObj.border}">
                                <span>📍 歷史紀錄 #${numLabel} (${colorObj.name})</span>
                            </div>
                            <div class="font-mono text-slate-700">${esc(t.lat)}, ${esc(t.lng)}</div>
                            ${item.time ? `<div class="text-[11px] text-slate-400">🕒 存檔時間: ${esc(item.time)}</div>` : ''}
                            ${t.phone ? `<div class="text-[11px] text-accent font-semibold">📱 門號: ${esc(t.phone)}</div>` : ''}
                            ${t.reqTime ? `<div class="text-[11px] text-slate-500">⏱️ 定位時間: ${esc(t.reqTime)}</div>` : ''}
                            ${t.azi !== null && t.azi !== undefined && !isNaN(t.azi) ? `<div class="text-[11px] font-semibold" style="color: ${colorObj.border}">🧭 發射方位角: ${esc(t.azi)}°</div>` : ''}
                        </div>`;

                        const m = L.marker([t.lat, t.lng], { icon: customIcon }).addTo(map).bindPopup(popupText);
                        multiTowerLayers.push(m);

                        // 繪製專屬色系扇形
                        if (t.azi !== null && t.azi !== undefined && !isNaN(t.azi)) {
                            const r = config.sectorRadius;
                            const halfApp = config.sectorAperture / 2;
                            const startAngle = (t.azi - halfApp) * (Math.PI / 180);
                            const endAngle = (t.azi + halfApp) * (Math.PI / 180);
                            const points = [[t.lat, t.lng]];

                            for (let k = 0; k <= 20; k++) {
                                const angle = startAngle + (endAngle - startAngle) * (k / 20);
                                const dLat = (r / 111320) * Math.cos(angle);
                                const dLng = (r / (111320 * Math.cos(t.lat * (Math.PI / 180)))) * Math.sin(angle);
                                points.push([t.lat + dLat, t.lng + dLng]);
                            }
                            // points: 圓心 + 21個圓弧點 (閉合凸多邊形頂點序列)
                            sectorPolygonsList.push({
                                numLabel,
                                towerIndex: itemTowers.length > 1 ? tIdx + 1 : null,
                                colorObj,
                                polygon: points.slice()
                            });

                            points.push([t.lat, t.lng]);

                            const isDimmed = isIntersectionOnly && lastIntersectionData && lastIntersectionData.polygon;
                            const secPoly = L.polygon(points, {
                                color: isDimmed ? "#94a3b8" : colorObj.border,
                                fillColor: isDimmed ? "#cbd5e1" : colorObj.fill,
                                fillOpacity: isDimmed ? 0.04 : 0.18,
                                weight: isDimmed ? 1 : 2,
                                opacity: isDimmed ? 0.25 : 0.75
                            }).addTo(map);

                            secPoly.bindTooltip(`[#${numLabel} ${colorObj.name}] 方位: ${t.azi}°`, { permanent: false, direction: "center" });
                            multiTowerLayers.push(secPoly);
                        }
                    });
                });

                // --- 空間交集熱區求解 ---
                lastIntersectionData = null;
                lastIntersectionStatus = sectorPolygonsList.length < 2 ? "insufficient-sectors" : "no-intersection";
                if (sectorPolygonsList.length >= 2) {
                    const rawPolys = sectorPolygonsList.map(s => s.polygon);
                    const intersectionPoints = intersectMultipleConvexPolygons(rawPolys);

                    if (intersectionPoints && intersectionPoints.length >= 3) {
                        const areaM2 = computePolygonAreaM2(intersectionPoints);
                        const centroid = computePolygonCentroid(intersectionPoints);
                        lastIntersectionData = {
                            polygon: intersectionPoints,
                            area: areaM2,
                            centroid: centroid,
                            towerCount: sectorPolygonsList.length,
                            sourceLabels: sectorPolygonsList.map(source => `#${source.numLabel}${source.towerIndex ? `-${source.towerIndex}` : ""}`)
                        };
                        lastIntersectionStatus = "intersection";

                        // 繪製高亮交集熱區 (警戒亮紅網底 + 粗虛線邊框)
                        const intersectPoly = L.polygon(intersectionPoints, {
                            color: "#dc2626",
                            fillColor: "#ef4444",
                            fillOpacity: 0.48,
                            weight: 3.5,
                            dashArray: "6, 4",
                            opacity: 0.95
                        }).addTo(map);

                        const areaText = areaM2 >= 10000
                            ? `${(areaM2 / 10000).toFixed(2)} 公頃`
                            : `${Math.round(areaM2)} 平方公尺`;

                        intersectPoly.bindTooltip(`<div class="font-bold text-xs text-red-700">🎯 訊號交集分析參考範圍<br>面積: ${areaText}<br><span class="text-[10px]">非手機實際位置</span></div>`, { permanent: false, direction: "center" });
                        multiTowerLayers.push(intersectPoly);

                            // 幾何中心僅作為視覺參考，不代表手機位置。
                        if (centroid) {
                            allCoords.push(centroid);
                            const centroidIcon = L.divIcon({
                                html: '<div class="w-6 h-6 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center font-bold text-xs shadow-xl">🎯</div>',
                                className: 'custom-centroid-icon',
                                iconSize: [24, 24],
                                iconAnchor: [12, 12]
                            });
                            const cMarker = L.marker(centroid, { icon: centroidIcon }).addTo(map);
                            cMarker.bindPopup(`
                                <div class="space-y-1 text-xs">
                                    <div class="font-bold text-red-600 flex items-center gap-1">
                                        <i class="fa-solid fa-crosshairs"></i> 訊號交集幾何中心參考點
                                    </div>
                                    <div class="font-mono text-slate-700">${centroid[0].toFixed(6)}, ${centroid[1].toFixed(6)}</div>
                                    <div class="text-[11px] text-slate-600">📏 覆蓋面積: <b>${areaText}</b></div>
                                    <div class="text-[10px] text-slate-400">共 ${sectorPolygonsList.length} 個有效扇區幾何交會；非手機實際位置</div>
                                </div>
                            `);
                            multiTowerLayers.push(cMarker);
                        }
                    }
                }

                updateIntersectionUI();

                if (allCoords.length > 0) {
                    const bounds = L.latLngBounds(allCoords);
                    map.fitBounds(bounds, getFitBoundsOptions());
                }
            }

            // 更新交集分析 UI 卡片
            function updateIntersectionUI() {
                const card = document.getElementById("historyIntersectionCard");
                const badge = document.getElementById("intersectionStatusBadge");
                const text = document.getElementById("intersectionInfoText");
                const btnFocus = document.getElementById("btnFocusIntersection");
                const btnToggle = document.getElementById("btnToggleIntersectionOnly");
                const textToggle = document.getElementById("textIntersectionOnly");
                const iconToggle = document.getElementById("iconIntersectionOnly");

                if (!card) return;

                if (selectedHistoryIds.size < 2) {
                    card.classList.add("hidden");
                    return;
                }

                card.classList.remove("hidden");

                if (lastIntersectionData && lastIntersectionData.polygon) {
                    const areaM2 = lastIntersectionData.area;
                    const areaText = areaM2 >= 10000
                        ? `${(areaM2 / 10000).toFixed(2)} 公頃`
                        : `${Math.round(areaM2)} 平方公尺`;

                    badge.className = "text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-600 text-white shadow-2xs font-mono";
                    badge.innerText = "形成參考範圍";

                    text.innerHTML = `使用 <b>${lastIntersectionData.towerCount}</b> 個有效扇區（${lastIntersectionData.sourceLabels.join('、')}），依基地台座標、方位角與目前扇區設定求交集。<br>結果：形成 1 個訊號交集分析參考範圍，面積約 <b>${areaText}</b>。<br><span class="text-[10px] text-slate-400 font-mono">幾何中心參考點: ${lastIntersectionData.centroid[0].toFixed(5)}, ${lastIntersectionData.centroid[1].toFixed(5)}</span>`;

                    if (btnFocus) btnFocus.disabled = false;
                    if (btnToggle) btnToggle.disabled = false;
                } else {
                    badge.className = "text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-400 text-white shadow-2xs font-mono";
                    if (lastIntersectionStatus === "insufficient-sectors") {
                        badge.innerText = "資料不足";
                        text.innerHTML = `目前僅有不足 <b>2</b> 個有效扇區可供交集計算；請確認來源資料是否含有效方位角。`;
                    } else {
                        badge.innerText = "未形成交集";
                        text.innerHTML = `已完成 <b>${selectedHistoryIds.size}</b> 筆歷史資料的扇區分析，但未形成共同訊號交集分析參考範圍。此為分析結果，不是程式錯誤。`;
                    }

                    if (btnFocus) btnFocus.disabled = true;
                    if (btnToggle) btnToggle.disabled = true;
                }

                if (textToggle && iconToggle) {
                    if (isIntersectionOnly) {
                        textToggle.innerText = "顯示全部";
                        iconToggle.className = "fa-solid fa-eye";
                    } else {
                        textToggle.innerText = "僅看交集";
                        iconToggle.className = "fa-solid fa-eye-slash";
                    }
                }
            }

            // 聚焦對焦至扇形交集熱區
            function focusIntersection() {
                if (!lastIntersectionData || !lastIntersectionData.polygon || !map) return;
                const bounds = L.latLngBounds(lastIntersectionData.polygon);
                map.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
                if (isMobileLayout()) {
                    toggleConsole(true);
                }
            }

            // 切換是否僅高亮交集熱區
            function toggleShowIntersectionOnly() {
                isIntersectionOnly = !isIntersectionOnly;
                updateMap(false);
            }

            // 勾選只建立比對清單；不自動覆蓋目前地圖，需由使用者明確開始比對。
            function toggleHistorySelect(id, e) {
                if (e) e.stopPropagation();
                const wasComparing = isHistoryCompareActive;

                if (selectedHistoryIds.has(id)) {
                    selectedHistoryIds.delete(id);
                } else {
                    selectedHistoryIds.add(id);
                }
                isHistoryCompareActive = false;
                isIntersectionOnly = false;
                if (wasComparing) updateMap(false, "base");
                renderHistory();
            }

            // 全選只建立比對清單；仍需手動開始比對。
            function selectAllHistory() {
                if (!history.length) return;
                history.forEach(item => selectedHistoryIds.add(item.id));
                isHistoryCompareActive = false;
                isIntersectionOnly = false;
                renderHistory();
            }

            // 明確開始多筆空間比對。
            function startHistoryComparison() {
                if (selectedHistoryIds.size < 2) {
                    alert("請先勾選至少 2 筆歷史資料再開始比對。");
                    return;
                }
                isHistoryCompareActive = true;
                isHistorySingleView = false;
                isIntersectionOnly = false;
                updateMap(false, "bounds");
                renderHistory();
                if (isMobileLayout()) toggleConsole(true);
            }

            // 清除歷史比對選取，回到目前單筆地圖。
            function clearHistorySelection() {
                const wasComparing = isHistoryCompareActive;
                selectedHistoryIds.clear();
                isHistoryCompareActive = false;
                isIntersectionOnly = false;
                if (wasComparing) updateMap(false, "base");
                renderHistory();
            }

            function deleteItem(id, e) {
                if (e) e.stopPropagation();
                history = history.filter((x) => x.id !== id);
                if (currentHistoryId === id) currentHistoryId = null;
                selectedHistoryIds.delete(id);
                saveHistory();
            }

            // 清除歷史紀錄
            function clearHistory(e) {
                if (e) e.stopPropagation();
                if (confirm("確定清空紀錄？")) {
                    history = [];
                    currentHistoryId = null;
                    selectedHistoryIds.clear();
                    saveHistory();
                }
            }

            function saveHistory() {
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
                renderHistory();
            }

            function renderHistory() {
                const ul = document.getElementById("list");
                const compareCountEl = document.getElementById("historyCompareCount");
                const compareNoticeEl = document.getElementById("historyCompareNotice");
                const activeCountEl = document.getElementById("historyCompareActiveCount");
                const noticeTextEl = document.getElementById("historyCompareNoticeText");
                const noticeIconEl = document.getElementById("historyCompareNoticeIcon");
                const startButton = document.getElementById("btnStartHistoryComparison");
                const intersectionCard = document.getElementById("historyIntersectionCard");

                const count = selectedHistoryIds.size;
                if (compareCountEl) compareCountEl.innerText = count;

                if (compareNoticeEl) {
                    if (count >= 2) {
                        compareNoticeEl.classList.remove("hidden");
                        if (activeCountEl) activeCountEl.innerText = count;
                        if (noticeTextEl) noticeTextEl.innerText = isHistoryCompareActive ? "正在比較" : "已選取";
                        if (noticeIconEl) noticeIconEl.className = isHistoryCompareActive ? "fa-solid fa-eye text-blue-600" : "fa-solid fa-list-check text-blue-600";
                        if (startButton) {
                            startButton.innerHTML = isHistoryCompareActive
                                ? '看地圖 <i class="fa-solid fa-arrow-right text-[9px]"></i>'
                                : '開始比對 <i class="fa-solid fa-arrow-right text-[9px]"></i>';
                            startButton.onclick = isHistoryCompareActive
                                ? () => toggleConsole(true)
                                : () => startHistoryComparison();
                        }
                    } else {
                        compareNoticeEl.classList.add("hidden");
                    }
                }
                if (!isHistoryCompareActive && intersectionCard) intersectionCard.classList.add("hidden");

                ul.innerHTML = "";
                if (!history.length) {
                    ul.innerHTML = '<li class="text-center p-5 text-[#aaa]">暫無紀錄</li>';
                    return;
                }

                // 建立選中項目的順序色彩映射
                const selectedList = history.filter(h => selectedHistoryIds.has(h.id));
                const colorMap = new Map();
                selectedList.forEach((item, idx) => {
                    colorMap.set(item.id, {
                        idx: idx + 1,
                        color: COMPARE_COLORS[idx % COMPARE_COLORS.length]
                    });
                });

                history.forEach((item) => {
                    const isSelected = selectedHistoryIds.has(item.id);
                    const colorInfo = colorMap.get(item.id);

                    const li = document.createElement("li");
                    li.className = isSelected
                        ? "bg-white rounded-xl p-3 shadow-md border-2 border-blue-500 relative cursor-pointer hover:shadow-lg transition-all ring-2 ring-blue-400/20"
                        : "bg-white/80 rounded-xl p-3 shadow-sm border border-slate-100 relative cursor-pointer hover:bg-white hover:border-accent/40 hover:shadow-md transition-all group";

                    li.innerHTML = `
                    <div class="flex items-start gap-2.5">
                        <!-- 勾選框 -->
                        <div class="pt-0.5" onclick="event.stopPropagation()">
                            <input type="checkbox" ${isSelected ? "checked" : ""} class="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer" onclick="app.toggleHistorySelect(${item.id}, event)" title="勾選進行多筆比對">
                        </div>

                        <!-- 內容本體 -->
                        <div class="flex-1 min-w-0">
                            <div class="history-meta-row flex items-center justify-between gap-1 mb-1">
                                <div class="flex items-center gap-1.5 overflow-hidden">
                                    ${isSelected && colorInfo ? `<span style="background-color: ${colorInfo.color.badge}" class="text-white text-[10px] font-bold px-1.5 py-0.2 rounded font-mono shadow-xs">#${colorInfo.idx} ${colorInfo.color.name}</span>` : ""}
                                    <span class="history-time text-[0.7rem] font-medium text-slate-400 truncate">${esc(item.time)}</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <button class="text-slate-400 hover:text-blue-600 p-0.5 border-none bg-transparent cursor-pointer transition-colors active:scale-90" onclick="app.copyHistoryItem(${item.id}, event)" title="快速複製此筆座標資訊">
                                        <i class="fa-regular fa-copy text-xs"></i>
                                    </button>
                                    <button class="text-slate-400 hover:text-accent p-0.5 border-none bg-transparent cursor-pointer transition-colors" onclick="app.loadToForm(${item.id}, event)" title="載入至表單進行編輯">
                                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                                    </button>
                                    <button class="text-slate-300 hover:text-del p-0.5 border-none bg-transparent cursor-pointer transition-colors" onclick="app.deleteItem(${item.id}, event)" title="刪除紀錄">
                                        <i class="fa-solid fa-xmark text-xs"></i>
                                    </button>
                                </div>
                            </div>

                            <div class="history-primary-row flex items-center gap-2 mb-1">
                                <span class="history-coordinate font-bold text-primary text-[0.95rem] tracking-tight font-mono">${item.lat}, ${item.lng}</span>
                                ${item.phone
                                    ? `<span class="history-phone tag text-[0.7rem] font-medium py-0.5 px-1.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">${esc(item.phone)}</span>`
                                    : ""
                                }
                            </div>

                            <div class="flex flex-col gap-0.5 text-[0.75rem] text-slate-500">
                                ${item.reqTime
                                    ? `<div class="flex items-center gap-1.5"><i class="fa-regular fa-clock text-slate-400 w-3"></i> ${esc(item.reqTime)}</div>`
                                    : ""
                                }
                                ${item.azi !== null && item.azi !== undefined
                                    ? `<div class="flex items-center gap-1.5"><i class="fa-regular fa-compass text-slate-400 w-3"></i> 方位: <span class="text-accent font-bold">${item.azi}°</span></div>`
                                    : ""
                                }
                                ${item.addrLat !== null && item.addrLng !== null && item.addrLat !== undefined
                                    ? `<div class="text-orange-600 flex items-center gap-1.5 truncate"><i class="fa-solid fa-house text-orange-400 w-3 shrink-0"></i> 關聯: <span class="font-medium truncate">${esc(item.addrName || "自訂點")}</span></div>`
                                    : ""
                                }
                            </div>
                        </div>
                    </div>
                    `;

                    // 點擊項目本體：單筆檢視；勾選框才會加入多筆比對清單。
                    li.onclick = (e) => {
                        viewHistoryItem(item.id, e);
                    };
                    ul.appendChild(li);
                });
            }

            function applyHistoryItem(item) {
                data = {
                    lat: item.lat,
                    lng: item.lng,
                    azi: item.azi,
                    phone: item.phone,
                    reqTime: item.reqTime,
                    regTime: item.regTime,
                    responseTime: item.responseTime || "",
                    towerId: item.towerId || "",
                    cellId: item.cellId || "",
                    address: item.address || "",
                    addrLat: item.addrLat !== undefined ? item.addrLat : null,
                    addrLng: item.addrLng !== undefined ? item.addrLng : null,
                    addrName: item.addrName !== undefined ? item.addrName : "",
                    searchQuery: item.searchQuery !== undefined ? item.searchQuery : "",
                    towers: Array.isArray(item.towers) && item.towers.length > 0 ? item.towers.map(tower => ({ ...tower })) : [{
                        lat: item.lat, lng: item.lng, azi: item.azi, phone: item.phone, reqTime: item.reqTime, regTime: item.regTime,
                        towerId: item.towerId || "", cellId: item.cellId || "", address: item.address || "", responseTime: item.responseTime || ""
                    }],
                };
                currentHistoryId = item.id;
            }

            // 點擊歷史卡的預設行為：只檢視單筆，不比較交集也不畫同批次路線。
            function viewHistoryItem(id, e) {
                if (e) e.stopPropagation();
                const item = history.find(h => h.id === id);
                if (!item) return;

                applyHistoryItem(item);
                selectedHistoryIds.clear();
                isHistoryCompareActive = false;
                isHistorySingleView = true;
                isIntersectionOnly = false;
                syncUI();
                const focusType = (data.addrLat !== null && data.addrLng !== null) ? "bounds" : "base";
                updateMap(false, focusType);
                renderHistory();
                switchTab("base");
                if (isMobileLayout()) toggleConsole(true);
            }

            // 編輯按鈕才會載入定位／關聯表單，保留原本可調整資料的流程。
            function loadToForm(id, e) {
                if (e) e.stopPropagation();
                const item = history.find(h => h.id === id);
                if (!item) return;

                applyHistoryItem(item);
                selectedHistoryIds.clear();
                isHistoryCompareActive = false;
                isHistorySingleView = false;
                isIntersectionOnly = false;
                syncUI();
                const focusType = (data.addrLat !== null && data.addrLng !== null) ? "bounds" : "base";
                updateMap(false, focusType);
                if (data.addrLat !== null && data.addrLng !== null) {
                    switchTab('compare');
                } else {
                    switchTab('base');
                }
            }

            // 快速複製單筆歷史紀錄座標與時間資訊
            function copyHistoryItem(id, e) {
                if (e) e.stopPropagation();
                const item = history.find(h => h.id === id);
                if (!item) return;

                let parts = [`${item.lat}, ${item.lng}`];
                if (item.azi !== null && item.azi !== undefined && !isNaN(item.azi)) {
                    parts.push(`方位角 ${item.azi}°`);
                }
                if (item.reqTime) {
                    parts.push(item.reqTime);
                }
                if (item.phone) {
                    parts.push(`門號 ${item.phone}`);
                }
                const text = parts.join(" | ");

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text)
                        .then(() => alert("✅ 座標與時間已複製"))
                        .catch(() => fallbackCopy(text));
                } else {
                    fallbackCopy(text);
                }
            }

            function copy() {
                if (data.lat === null) return alert("無座標");
                const t = getFullText();

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(t)
                        .then(() => alert("✅ 資訊已複製"))
                        .catch((err) => {
                            console.error(err);
                            fallbackCopy(t);
                        });
                } else {
                    fallbackCopy(t);
                }
            }

            function fallbackCopy(text) {
                try {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
                    document.body.appendChild(ta);
                    ta.select();
                    const ok = document.execCommand("copy");
                    document.body.removeChild(ta);
                    if (ok) alert("✅ 資訊已複製");
                    else prompt("請手動複製以下內容 (Ctrl+A → Ctrl+C):", text);
                } catch (err) {
                    prompt("請手動複製以下內容 (Ctrl+A → Ctrl+C):", text);
                }
            }

            function share(type) {
                if (data.lat === null) return alert("無座標");
                const t = getFullText();
                const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
                let url;
                if (type === "line") {
                    url = `https://line.me/R/msg/text/?${encodeURIComponent(t)}`;
                } else {
                    const textBody = t.replace(mapUrl + "\n", "");
                    url = `https://t.me/share/url?url=${encodeURIComponent(mapUrl)}&text=${encodeURIComponent(textBody)}`;
                }
                if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
                    window.location.href = url;
                } else {
                    window.open(url, "_blank");
                }
            }

            function pasteInput() {
                const input = document.getElementById("rawInput");
                const hint = document.getElementById("pasteHint");
                const showManualPasteHint = (message) => {
                    input.focus({ preventScroll: true });
                    hint.textContent = message;
                    hint.classList.remove("hidden");
                };

                if (!navigator.clipboard || !navigator.clipboard.readText) {
                    showManualPasteHint("此瀏覽器無法自動讀取剪貼簿，請長按輸入框後選擇「貼上」。");
                    return;
                }

                navigator.clipboard.readText()
                    .then((text) => {
                        if (!text) {
                            showManualPasteHint("剪貼簿沒有可貼上的文字，請長按輸入框後選擇「貼上」。");
                            return;
                        }
                        input.value = text;
                        hint.classList.add("hidden");
                        input.focus({ preventScroll: true });
                    })
                    .catch(() => showManualPasteHint("瀏覽器禁止自動讀取剪貼簿，請長按輸入框後選擇「貼上」。"));
            }

            function clearInput() {
                document.getElementById("rawInput").value = "";
                document.getElementById("rawInput").focus();
                const hint = document.getElementById("pasteHint");
                const batchNotice = document.getElementById("batchNotice");
                const resultActions = document.getElementById("resultActions");
                if (hint) hint.classList.add("hidden");
                if (batchNotice) batchNotice.classList.add("hidden");
                if (resultActions) resultActions.classList.add("hidden");
            }

            function addHistory() {
                const now = new Date().toLocaleString("zh-TW", { hour12: false });
                const isSameRecord = (h) =>
                    h.lat === data.lat &&
                    h.lng === data.lng &&
                    h.phone === data.phone &&
                    h.reqTime === data.reqTime &&
                    h.regTime === data.regTime &&
                    h.addrLat === data.addrLat &&
                    h.addrLng === data.addrLng;
                const dupItem = history.find(isSameRecord);
                if (dupItem) {
                    currentHistoryId = dupItem.id;
                    return;
                }

                const newId = Date.now();
                history.unshift({
                    id: newId,
                    time: now,
                    ...data,
                });
                currentHistoryId = newId;
                if (history.length > config.historyLimit) history.pop();
                saveHistory();
            }

            // --- 設定面板：同步 config 值至 UI 滑桿 ---
            function syncConfigToUI() {
                const inputs = {
                    'cfg-radius':        'sectorRadius',
                    'cfg-aperture':      'sectorAperture', // 修正拼字
                    'cfg-zoom':          'defaultZoom',
                    'cfg-history-limit': 'historyLimit'
                };

                for (const id in inputs) {
                    const key = inputs[id];
                    const el = document.getElementById(id);
                    if (!el) continue;
                    el.value = config[key];
                    el.oninput = (e) => {
                        const val = parseFloat(e.target.value);
                        config[key] = val;
                        saveConfig();
                        const display = document.getElementById(id + '-val');
                        if (display) display.innerText = val;
                        if (data.lat !== null && data.lng !== null) updateMap(false);
                    };
                }
            }

            // --- 側邊抽屜事件綁定 (僅在 init 時呼叫一次，避免重複綁定) ---
            function initDrawer() {
                const btnToggle = document.getElementById('btnToggleConfig');
                const btnClose  = document.getElementById('btnCloseConfig');
                const panel     = document.getElementById('configPanel');
                const overlay   = document.getElementById('configOverlay');
                const btnReset  = document.getElementById('btnResetConfig');

                const toggleDrawer = (isOpen) => {
                    if (isOpen) {
                        overlay.classList.remove('hidden');
                        void overlay.offsetWidth; // 強制重繪以觸發過渡動畫
                        overlay.classList.add('opacity-100');
                        panel.setAttribute('data-open', 'true');
                        document.body.style.overflow = 'hidden';
                    } else {
                        overlay.classList.remove('opacity-100');
                        panel.removeAttribute('data-open');
                        document.body.style.overflow = '';
                        setTimeout(() => {
                            if (!panel.hasAttribute('data-open')) overlay.classList.add('hidden');
                        }, 300);
                    }
                };

                if (btnToggle) btnToggle.onclick = (e) => { e.preventDefault(); toggleDrawer(true); };
                if (btnClose)  btnClose.onclick  = () => toggleDrawer(false);
                if (overlay)   overlay.onclick   = () => toggleDrawer(false);

                if (btnReset) {
                    btnReset.onclick = () => {
                        if (confirm("確定要恢復所有進階設定為預設值嗎？")) {
                            config = { ...DEFAULT_CONFIG };
                            saveConfig();
                            syncConfigToUI(); // 只更新滑桿值，不重新綁定抽屜事件
                        }
                    };
                }
            }

            // Tab 標籤切換
            function switchTab(tabName) {
                const contents = document.querySelectorAll(".tab-content");
                contents.forEach((el) => el.classList.add("hidden"));

                const targetContent = document.getElementById(`tab-content-${tabName}`);
                if (targetContent) targetContent.classList.remove("hidden");

                const buttons = document.querySelectorAll(".tab-btn");
                buttons.forEach((btn) => btn.classList.remove("active"));

                const targetBtn = document.getElementById(`tab-btn-${tabName}`);
                if (targetBtn) targetBtn.classList.add("active");

                if (tabName === "history") {
                    renderHistory();
                }
            }

            // 手機版底部抽屜摘要更新
            function updateSheetSummary() {
                const summaryTextEl = document.getElementById("sheetSummaryText");
                if (!summaryTextEl) return;

                if (data.towers && data.towers.length > 0) {
                    const count = data.towers.length;
                    const ph = data.phone ? `📱 ${data.phone}` : `📍 ${data.lat}, ${data.lng}`;
                    summaryTextEl.innerText = `${ph}（目前顯示 ${count} 筆）`;
                } else if (data.lat !== null && data.lng !== null) {
                    const ph = data.phone ? `📱 ${data.phone}` : `📍 ${data.lat}, ${data.lng}`;
                    summaryTextEl.innerText = ph;
                } else {
                    summaryTextEl.innerText = "點擊展開智慧解析與定位控制台";
                }
            }

            // 懸浮控制台展開/折疊切換 (桌機向左收合、手機底部抽屜收合)
            function syncConsoleToggleIcon() {
                const el = document.getElementById("floating-console");
                const arrow = document.getElementById("console-arrow");
                if (!el || !arrow) return;

                const isCollapsed = el.classList.contains("collapsed") || el.classList.contains("is-sheet-collapsed");
                ["btnSheetHandle", "btnSheetSummary", "btnOpenSheetFab"].forEach((id) => {
                    const button = document.getElementById(id);
                    if (button) button.setAttribute("aria-expanded", String(!isCollapsed));
                });
                arrow.classList.remove("fa-chevron-left", "fa-chevron-right", "fa-chevron-up", "fa-chevron-down");
                if (isMobileLayout()) {
                    arrow.classList.add(isCollapsed ? "fa-chevron-up" : "fa-chevron-down");
                } else {
                    arrow.classList.add(isCollapsed ? "fa-chevron-right" : "fa-chevron-left");
                }
            }

            function toggleConsole(forceState) {
                const el = document.getElementById("floating-console");
                if (!el) return;

                const isCollapsed = el.classList.contains("collapsed") || el.classList.contains("is-sheet-collapsed");
                const shouldCollapse = (forceState !== undefined) ? forceState : !isCollapsed;

                if (shouldCollapse) {
                    el.classList.add("collapsed", "is-sheet-collapsed");
                    updateSheetSummary();
                } else {
                    el.classList.remove("collapsed", "is-sheet-collapsed");
                }
                syncConsoleToggleIcon();

                if (map) {
                    setTimeout(() => map.invalidateSize(), 320);
                }
            }

            // 自身 GPS 地理定位與戰術距離連線
            function locateMe() {
                if (!navigator.geolocation) {
                    return alert("您的瀏覽器或裝置不支援 GPS 地理定位功能。");
                }

                const btn = document.getElementById("btnMyLocation");
                const icon = document.getElementById("iconMyLocation");
                if (icon) {
                    icon.classList.remove("fa-location-crosshairs");
                    icon.classList.add("fa-spinner", "animate-spin");
                }
                if (btn) btn.disabled = true;

                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        if (icon) {
                            icon.classList.remove("fa-spinner", "animate-spin");
                            icon.classList.add("fa-location-crosshairs");
                        }
                        if (btn) btn.disabled = false;

                        const lat = parseFloat(pos.coords.latitude.toFixed(6));
                        const lng = parseFloat(pos.coords.longitude.toFixed(6));
                        const accuracy = Math.round(pos.coords.accuracy);
                        myCoords = { lat, lng, accuracy };

                        // 移除舊自身定位圖層
                        if (myLocationMarker && map) map.removeLayer(myLocationMarker);
                        if (myLocationCircle && map) map.removeLayer(myLocationCircle);
                        if (myLocationLine && map) map.removeLayer(myLocationLine);

                        // 1. 建立脈衝藍點 Marker
                        const pulseIcon = L.divIcon({
                            html: '<div class="my-location-pulse"><div class="ring"></div><div class="dot"></div></div>',
                            className: 'custom-my-location-marker',
                            iconSize: [22, 22],
                            iconAnchor: [11, 11]
                        });

                        // 計算與基地台之相對距離與方位
                        const hasBase = data.lat !== null && data.lng !== null;
                        let distanceInfo = "";
                        let navUrl = "";

                        if (hasBase && map) {
                            const dist = Math.round(map.distance([lat, lng], [data.lat, data.lng]));
                            const bearing = Math.round(calculateBearing(lat, lng, data.lat, data.lng));
                            const distText = dist >= 1000 ? `${(dist / 1000).toFixed(2)} 公里` : `${dist} 公尺`;
                            distanceInfo = `📏 距離目前基地台: <b>${distText}</b> (🧭 ${bearing}°)`;
                            navUrl = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${data.lat},${data.lng}`;

                            // 繪製青藍色戰術虛線連線
                            myLocationLine = L.polyline([[lat, lng], [data.lat, data.lng]], {
                                color: "#0284c7",
                                weight: 2.5,
                                dashArray: "5, 5",
                                opacity: 0.85
                            }).addTo(map);
                            myLocationLine.bindTooltip(`📍 我的位置 ➔ 基地台: ${distText}`, { permanent: false, direction: "center" });
                        }

                        let popupContent = `
                            <div class="text-xs space-y-1 p-0.5">
                                <div class="font-bold text-accent flex items-center gap-1">
                                    <i class="fa-solid fa-location-crosshairs"></i> 我的目前位置 (GPS)
                                </div>
                                <div class="font-mono text-slate-700">${lat}, ${lng}</div>
                                <div class="text-[11px] text-slate-500">🎯 定位精準度: ±${accuracy} 公尺</div>
                                ${distanceInfo ? `<div class="text-[11px] text-sky-700 font-semibold bg-sky-50 p-1 rounded border border-sky-200 mt-1">${distanceInfo}</div>` : ""}
                                ${navUrl ? `
                                    <div class="pt-2 border-t border-slate-200 mt-1">
                                        <a href="${navUrl}" target="_blank" class="btn-nav-gmap" title="開啟 Google Maps 路線導航">
                                            <i class="fa-solid fa-diamond-turn-right"></i> Google Maps 導航前往基地台
                                        </a>
                                    </div>` : ""}
                            </div>
                        `;

                        if (map) {
                            myLocationMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(map).bindPopup(popupContent);

                            // 2. 建立 GPS 誤差半徑圓圈
                            myLocationCircle = L.circle([lat, lng], {
                                radius: accuracy,
                                color: "#0284c7",
                                fillColor: "#38bdf8",
                                fillOpacity: 0.12,
                                weight: 1
                            }).addTo(map);

                            myLocationMarker.openPopup();

                            // 3. 視角對焦：若有基地台，同時將自身與基地台納入可視範圍
                            if (hasBase) {
                                const bounds = L.latLngBounds([[lat, lng], [data.lat, data.lng]]);
                                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
                            } else {
                                map.setView([lat, lng], 16);
                            }
                        }
                    },
                    (err) => {
                        if (icon) {
                            icon.classList.remove("fa-spinner", "animate-spin");
                            icon.classList.add("fa-location-crosshairs");
                        }
                        if (btn) btn.disabled = false;

                        let msg = "無法取得您的 GPS 位置。";
                        if (err.code === err.PERMISSION_DENIED) {
                            msg = "定位權限已被拒絕。若需使用此功能，請在瀏覽器網址列或系統設定中允許取用位置資訊。";
                        } else if (err.code === err.POSITION_UNAVAILABLE) {
                            msg = "目前無法獲取 GPS 訊號（可能位於室內、地下室或收訊死角）。";
                        } else if (err.code === err.TIMEOUT) {
                            msg = "GPS 定位連線逾時，請至收訊良好處重試。";
                        }
                        alert(msg);
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
                );
            }

            // 公開介面 (Public API)
            return {
                init,
                parse,
                updateMap,
                updateFromInput,
                openMap,
                copy,
                share,
                clearHistory,
                deleteItem,
                pasteInput,
                clearInput,
                locateAddress,
                toggleMapSelect,
                clearAddress,
                switchTab,
                toggleConsole,
                locateMe,
                toggleHistorySelect,
                selectAllHistory,
                startHistoryComparison,
                clearHistorySelection,
                loadToForm,
                viewHistoryItem,
                copyHistoryItem,
                focusIntersection,
                toggleShowIntersectionOnly,
                clipPolygon,
                intersectMultipleConvexPolygons,
                computePolygonAreaM2,
                computePolygonCentroid,
            };
        })();

        // 啟動
        window.onload = app.init;
