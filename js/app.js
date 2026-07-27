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
                mapTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                boundsLatMin: 21,       // 台灣經緯度界線 (Lat Min)
                boundsLatMax: 27,
                boundsLngMin: 118,
                boundsLngMax: 124
            };
            let config = { ...DEFAULT_CONFIG };

            const HISTORY_STORAGE_KEY = "cell_locate_v1_db";

            // 初始化
            function init() {
                loadConfig();
                try {
                    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
                    if (saved) history = JSON.parse(saved);
                    renderHistory();

                    // 監聽輸入框變更
                    ["lat", "lng", "phone", "azi", "reqTime", "regTime", "addrLat", "addrLng", "targetAddr"].forEach((id) => {
                        const el = document.getElementById(id);
                        if (el) el.addEventListener("change", () => updateFromInput(false));
                    });

                    syncConfigToUI();
                    initDrawer(); // 側邊抽屜事件只綁定一次

                    // 檢查網址參數 (分享連結開啟)
                    checkUrlParams();

                    // 初始化智慧分頁導航
                    const params = new URLSearchParams(window.location.search);
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

            function checkUrlParams() {
                const params = new URLSearchParams(window.location.search);
                let hasData = false;

                if (params.has('lat') && params.has('lng')) {
                    data.lat = parseFloat(params.get('lat'));
                    data.lng = parseFloat(params.get('lng'));
                    hasData = true;
                }
                if (params.has('azi')) data.azi = parseFloat(params.get('azi'));
                if (params.has('phone')) data.phone = params.get('phone');
                if (params.has('reqTime')) data.reqTime = params.get('reqTime');
                if (params.has('regTime')) data.regTime = params.get('regTime');

                // 解析目標地址關聯參數
                if (params.has('addrLat') && params.has('addrLng')) {
                    data.addrLat = parseFloat(params.get('addrLat'));
                    data.addrLng = parseFloat(params.get('addrLng'));
                } else {
                    data.addrLat = null;
                    data.addrLng = null;
                }
                if (params.has('addrName')) data.addrName = params.get('addrName');
                else data.addrName = "";

                if (hasData) {
                    syncUI();
                    const focusType = (data.addrLat !== null && data.addrLng !== null) ? "bounds" : "base";
                    updateMap(false, focusType); // 不自動存入歷史，避免污染
                }
            }

            function loadConfig() {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    try {
                        config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
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

            // 核心解析邏輯 (支援多筆段落切割 Block Splitting、全格式 DMS/DMM 座標與 5 筆上限截取)
            function parse() {
                const text = document.getElementById("rawInput").value;
                if (!text) return alert("請先貼上內容！");

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

                // 2. 段落與行層級多座標全域解析 (Block & Line Multi-Pair Parsing)
                let rawBlocks = text.split(/\n\s*\n+/);
                if (rawBlocks.length <= 1) {
                    rawBlocks = text.split(/(?=(?:行動電話號碼|定位請求|註冊基地|細胞經緯度|細胞緯度))/g);
                }
                if (rawBlocks.length <= 1) {
                    rawBlocks = text.split('\n');
                }

                const parsedList = [];
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
                    const reqM = block.match(new RegExp(`(?:定位請求|Positioning Request)[^:：\\d]*[:：]?\\s*${timePattern}`));
                    const reqTime = reqM ? reqM[1].replace(/-/g, "/") : "";

                    const regM = block.match(new RegExp(`(?:註冊基地|最後註冊|Base Station Reg)[^:：\\d]*[:：]?\\s*${timePattern}`));
                    const regTime = regM ? regM[1].replace(/-/g, "/") : "";

                    // C. 抓方位角
                    const azM = block.match(/(?:方位|方向|Dir|Azimuth)[^0-9\n]*([0-9]+(?:\.[0-9]+)?)/i);
                    const azi = azM ? parseFloat(azM[1]) : null;

                    // D. 抓經緯度 (支援全格式: DMS/DMM 與 DD 成對)
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
                            const latM = block.match(/(?:緯度|Lat)[^0-9\n]*([0-9]+\.[0-9]+)/i);
                            const lngM = block.match(/(?:經度|Lng)[^0-9\n]*([0-9]+\.[0-9]+)/i);
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
                                item.reqTime === reqTime
                            );
                            
                            if (!isDup) {
                                parsedList.push({
                                    lat: c.lat,
                                    lng: c.lng,
                                    azi: azi,
                                    phone: blockPhone,
                                    reqTime: reqTime,
                                    regTime: regTime
                                });
                            }
                        }
                    });
                });

                // 若段落分割未找到，嘗試全文備用成對搜尋 (全域捕捉)
                if (parsedList.length === 0) {
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

                if (parsedList.length === 0) {
                    return alert("找不到有效的台灣座標數值，請確認內容。");
                }

                // 3. 時間排序 (如果有時間資訊，依請求時間由舊到新排序)
                parsedList.sort((a, b) => {
                    if (a.reqTime && b.reqTime) {
                        return new Date(a.reqTime) - new Date(b.reqTime);
                    }
                    return 0;
                });

                // 4. 5 筆上限截取與提示控制
                const originalCount = parsedList.length;
                let finalTowers = parsedList;

                const batchNotice = document.getElementById("batchNotice");
                const batchNoticeText = document.getElementById("batchNoticeText");

                if (originalCount > config.maxBatchLimit) {
                    finalTowers = parsedList.slice(0, config.maxBatchLimit);
                    if (batchNotice && batchNoticeText) {
                        batchNotice.classList.remove("hidden");
                        batchNoticeText.innerText = `偵測到 ${originalCount} 筆定位資料，已為您載入前 ${config.maxBatchLimit} 筆軌跡。`;
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

                // 清除舊目標地址
                data.addrName = "";
                data.addrLat = null;
                data.addrLng = null;

                syncUI();
                updateMap(true, finalTowers.length > 1 ? "bounds" : "base"); // true = 存入歷史
                switchTab('base'); // 自動切換至定位資料分頁
            }

            // 從輸入框更新資料
            function updateFromInput(save = false) {
                const lat = parseFloat(document.getElementById("lat").value);
                const lng = parseFloat(document.getElementById("lng").value);
                const az = parseFloat(document.getElementById("azi").value);
                const ph = document.getElementById("phone").value;
                const req = document.getElementById("reqTime").value;
                const reg = document.getElementById("regTime").value;
                
                const addrLatVal = parseFloat(document.getElementById("addrLat").value);
                const addrLngVal = parseFloat(document.getElementById("addrLng").value);
                const addrNameVal = document.getElementById("targetAddr").value;

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
                    
                    updateMap(save, "base");
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
            }

            // 計算航向角（相對方位角）
            function calculateBearing(lat1, lng1, lat2, lng2) {
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
                .then(res => res.json())
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
                                    <span class="font-mono text-primary">${t.lat}, ${t.lng}</span>
                                </span>
                                ${t.azi !== null && t.azi !== undefined ? `<span class="text-[10px] text-accent font-medium bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">🧭 ${t.azi}°</span>` : ""}
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

            // 更新地圖與歷史紀錄 (v3.1 多點軌跡與寶藍清透扇形疊加)
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

                // 確保相容 single / multi towers
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

                // 智慧中心點計算
                let centerLat = 23.6978;
                let centerLng = 120.9605;
                let defaultZoom = 8;

                if (hasBase) {
                    centerLat = towers[0].lat;
                    centerLng = towers[0].lng;
                    defaultZoom = config.defaultZoom;
                } else if (hasAddr) {
                    centerLat = data.addrLat;
                    centerLng = data.addrLng;
                    defaultZoom = config.defaultZoom;
                }

                if (!map) {
                    map = L.map("map", { maxZoom: 22 }).setView([centerLat, centerLng], defaultZoom);
                    L.tileLayer(config.mapTileUrl, {
                        maxZoom: 22,
                        maxNativeZoom: 19,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    }).addTo(map);

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
                } else {
                    if (!focusType) {
                        setTimeout(() => map.invalidateSize(), 100);
                    }
                }

                // 收集所有點位計算 Bounds
                const allCoords = [];
                if (hasAddr) allCoords.push([data.addrLat, data.addrLng]);

                // --- 1. 繪製基地台點位與寶藍清透扇形 ---
                if (hasBase) {
                    towers.forEach((t, i) => {
                        allCoords.push([t.lat, t.lng]);

                        let popupText = `<b>📍 基地台點位 #${i + 1}</b><br>${t.lat}, ${t.lng}`;
                        if (t.phone) popupText += `<br>門號: ${t.phone}`;
                        if (t.reqTime) popupText += `<br>🕒 請求: ${t.reqTime}`;
                        if (t.regTime) popupText += `<br>📡 註冊: ${t.regTime}`;
                        if (t.azi !== null) popupText += `<br>🧭 方位: ${t.azi}°`;

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
                            if (i === 0) m.openPopup();
                        }
                        multiTowerLayers.push(m);

                        // 繪製寶藍色 15% 清透扇形 (Alpha 疊加，重疊區域自動加深色調不蓋圖)
                        if (t.azi !== null && t.azi !== undefined) {
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
                    if (towers.length > 1) {
                        const pathCoords = towers.map(t => [t.lat, t.lng]);
                        const pathLine = L.polyline(pathCoords, {
                            color: "#2563eb",
                            weight: 3,
                            dashArray: "6, 6",
                            opacity: 0.8
                        }).addTo(map);

                        pathLine.bindTooltip("👣 定位移動軌跡線", { permanent: false, direction: "center" });
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
                        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
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

                    let addrDesc = `<b>🏠 目標地址 / 位置</b><br>${data.addrName || "自訂位置"}<br>${data.addrLat}, ${data.addrLng}`;
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
                            isCovered = isAngleWithinSector(bearing, data.azi, config.sectorAperture);
                            if (isCovered) {
                                coveredText = "🎯 位於發射扇形內";
                                coveredClass = "text-emerald-600";
                                lineColor = "#10b981";
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
                            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
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

            // 產生應用程式分享連結 (支援目標地址參數)
            function getAppLink() {
                const baseUrl = "https://lianghao02.github.io/Cell-Tower-Map-Locator/";
                const params = new URLSearchParams();
                if (data.lat !== null) params.append('lat', data.lat);
                if (data.lng !== null) params.append('lng', data.lng);
                if (data.azi !== null) params.append('azi', data.azi);
                if (data.phone) params.append('phone', data.phone);
                if (data.reqTime) params.append('reqTime', data.reqTime);
                if (data.regTime) params.append('regTime', data.regTime);
                
                if (data.addrLat !== null) params.append('addrLat', data.addrLat);
                if (data.addrLng !== null) params.append('addrLng', data.addrLng);
                if (data.addrName) params.append('addrName', data.addrName);
                
                return baseUrl + "?" + params.toString();
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
                        const isCovered = isAngleWithinSector(bearing, data.azi, config.sectorAperture);
                        coveredStatus = isCovered ? "🎯 位於發射扇形範圍內" : "❌ 位於發射扇形範圍外";
                    }

                    t += `\n\n🏠 目標關連位置: ${data.addrName || "自訂位置"}`;
                    t += `\n📍 目標經緯度: ${data.addrLat}, ${data.addrLng}`;
                    t += `\n📏 直線距離: 約 ${dist} 公尺`;
                    t += `\n🧭 相對方位角: ${bearing}° (${coveredStatus})`;
                }

                // 加上專用連結
                t += `\n\n📌 專用圖台 (含扇形與地址):\n${appUrl}`;

                return t;
            }

            function copy() {
                if (data.lat === null) return alert("無座標");
                const t = getFullText();

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard
                        .writeText(t)
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
                    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    const ok = document.execCommand("copy");
                    document.body.removeChild(ta);
                    if (ok) { alert("✅ 資訊已複製"); }
                    else { prompt("請手動複製以下內容 (Ctrl+A → Ctrl+C):", text); }
                } catch (e) {
                    prompt("請手動複製以下內容 (Ctrl+A → Ctrl+C):", text);
                }
            }

            // LINE & Telegram 分享
            function share(type) {
                if (data.lat === null) return alert("無座標");
                const t = getFullText();
                const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`; // 用於 Telegram 按鈕連結

                let url = "";
                if (type === "line") {
                    url = `https://line.me/R/msg/text/?${encodeURIComponent(t)}`;
                }
                else {
                    const textBody = t.replace(mapUrl + "\n", "");
                    url = `https://t.me/share/url?url=${encodeURIComponent(
                        mapUrl
                    )}&text=${encodeURIComponent(textBody)}`;
                }

                const isMobile =
                    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                        navigator.userAgent
                    );

                if (isMobile) {
                    window.location.href = url;
                } else {
                    window.open(url, "_blank");
                }
            }

            // 貼上功能
            function pasteInput() {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    navigator.clipboard
                        .readText()
                        .then((text) => {
                            document.getElementById("rawInput").value = text;
                        })
                        .catch((err) => {
                            alert("無法讀取剪貼簿，請手動貼上 (需允許瀏覽器權限)");
                        });
                } else {
                    alert("您的瀏覽器不支援自動貼上，請長按輸入框手動貼上。");
                }
            }

            // 清空功能
            function clearInput() {
                document.getElementById("rawInput").value = "";
                document.getElementById("rawInput").focus();
            }

            // 歷史紀錄管理
            function addHistory() {
                const now = new Date().toLocaleString("zh-TW", { hour12: false });
                const isDup = history.some(
                    (h) =>
                        h.lat === data.lat &&
                        h.lng === data.lng &&
                        h.phone === data.phone &&
                        h.reqTime === data.reqTime &&
                        h.regTime === data.regTime &&
                        h.addrLat === data.addrLat &&
                        h.addrLng === data.addrLng
                );
                if (isDup) {
                    const dupItem = history.find(
                        (h) =>
                            h.lat === data.lat &&
                            h.lng === data.lng &&
                            h.phone === data.phone &&
                            h.reqTime === data.reqTime &&
                            h.regTime === data.regTime &&
                            h.addrLat === data.addrLat &&
                            h.addrLng === data.addrLng
                    );
                    if (dupItem) currentHistoryId = dupItem.id;
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

            function deleteItem(id, e) {
                e.stopPropagation();
                history = history.filter((x) => x.id !== id);
                if (currentHistoryId === id) currentHistoryId = null;
                saveHistory();
            }

            // 清除歷史紀錄
            function clearHistory(e) {
                if (e) e.stopPropagation();
                if (confirm("確定清空紀錄？")) {
                    history = [];
                    currentHistoryId = null;
                    saveHistory();
                }
            }

            function saveHistory() {
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
                renderHistory();
            }

            function renderHistory() {
                const ul = document.getElementById("list");
                ul.innerHTML = "";
                if (!history.length) {
                    ul.innerHTML = '<li class="text-center p-5 text-[#aaa]">暫無紀錄</li>';
                    return;
                }

                history.forEach((item) => {
                    const li = document.createElement("li");
                    li.className =
                        "bg-white/80 rounded-xl p-4 mb-3 shadow-sm border border-slate-100 relative cursor-pointer hover:bg-white hover:border-accent/40 hover:shadow-md hover:-translate-y-0.5 transition-all group";
                    li.innerHTML = `
                    <div class="text-[0.75rem] font-medium text-slate-400 mb-[6px]">${esc(item.time)}</div>
                    <div class="flex items-center gap-2 mb-[6px]">
                        <span class="font-bold text-primary text-[1.05rem] tracking-tight">${item.lat}, ${item.lng}</span>
                        ${item.phone
                            ? `<span class="tag text-[0.75rem] font-medium py-0.5 px-2 rounded-md bg-accent/10 text-accent border border-accent/20">${esc(item.phone)}</span>`
                            : ""
                        }
                    </div>
                    <div class="flex flex-col gap-1 mt-2">
                        ${item.reqTime
                                ? `<div class="text-[0.8rem] text-slate-500 flex items-center gap-1.5"><i class="fa-regular fa-clock text-slate-400 w-3"></i> ${esc(item.reqTime)}</div>`
                                : ""
                            }
                        ${item.azi !== null && item.azi !== undefined
                                ? `<div class="text-[0.8rem] text-slate-500 flex items-center gap-1.5"><i class="fa-regular fa-compass text-slate-400 w-3"></i> 方位: <span class="text-accent font-medium">${item.azi}°</span></div>`
                                : ""
                            }
                        ${item.addrLat !== null && item.addrLng !== null && item.addrLat !== undefined
                                ? `<div class="text-[0.8rem] text-orange-600 flex items-center gap-1.5"><i class="fa-solid fa-house text-orange-400 w-3"></i> 關聯: <span class="font-medium">${esc(item.addrName || "自訂點")}</span></div>`
                                : ""
                            }
                    </div>
                    <button class="absolute top-[14px] right-[14px] text-slate-300 p-1 hover:text-del hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100" onclick="app.deleteItem(${item.id}, event)" title="刪除紀錄">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                `;
                    li.onclick = () => {
                        data = {
                            lat: item.lat,
                            lng: item.lng,
                            azi: item.azi,
                            phone: item.phone,
                            reqTime: item.reqTime,
                            regTime: item.regTime,
                            addrLat: item.addrLat !== undefined ? item.addrLat : null,
                            addrLng: item.addrLng !== undefined ? item.addrLng : null,
                            addrName: item.addrName !== undefined ? item.addrName : "",
                        };
                        currentHistoryId = item.id;
                        syncUI();
                        const focusType = (data.addrLat !== null && data.addrLng !== null) ? "bounds" : "base";
                        updateMap(false, focusType);
                        if (data.addrLat !== null && data.addrLng !== null) {
                            switchTab('compare');
                        } else {
                            switchTab('base');
                        }
                    };
                    ul.appendChild(li);
                });
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

            // 懸浮控制台展開/折疊切換
            function toggleConsole(forceState) {
                const el = document.getElementById("floating-console");
                const arrow = document.getElementById("console-arrow");
                if (!el) return;

                const isCollapsed = el.classList.contains("collapsed");
                const shouldCollapse = (forceState !== undefined) ? forceState : !isCollapsed;

                if (shouldCollapse) {
                    el.classList.add("collapsed");
                    if (arrow) {
                        arrow.classList.remove("fa-chevron-left");
                        arrow.classList.add("fa-chevron-right");
                    }
                } else {
                    el.classList.remove("collapsed");
                    if (arrow) {
                        arrow.classList.remove("fa-chevron-right");
                        arrow.classList.add("fa-chevron-left");
                    }
                }
            }

            // 公開介面 (Public API)
            return {
                init,
                parse,
                updateMap,
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
            };
        })();

        // 啟動
        window.onload = app.init;
