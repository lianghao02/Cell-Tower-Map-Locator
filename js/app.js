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
            let isMapSelectActive = false; // 地圖選點模式狀態
            let currentHistoryId = null; // 當前歷史紀錄 ID 追蹤
            // 資料模型 (包含 reqTime, regTime, 以及目標地址資料)
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
                    updateMap(false); // 不自動存入歷史，避免污染
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

            // 核心解析邏輯
            function parse() {
                const text = document.getElementById("rawInput").value;
                if (!text) return alert("請先貼上內容！");

                // 1. 抓門號 (09xx 或 8869xx)
                // 增加對 "行動電話號碼：" 後換行的支援，以及一般格式
                const phMatch = text.match(
                    /(?:行動電話號碼|門號)[：:\s]*\n*([0-9]+)/
                ) || text.match(
                    /(?:[^0-9\.]|^)(09\d{8}|8869\d{8})(?:[^0-9\.]|$)/
                );

                if (phMatch) {
                    let ph = phMatch[1];
                    // 如果是抓到 886 開頭，轉 09
                    if (ph.startsWith("886")) ph = "0" + ph.substring(3);
                    // 簡單驗證長度 (至少8碼)
                    if (ph.length >= 8) data.phone = ph;
                }

                // 2. 抓時間 (定位請求 & 註冊基地台)
                // 格式支援：yyyy/MM/dd 或 yyyy-MM-dd
                const timePattern =
                    "(\\d{4}[-\\/]\\d{1,2}[-\\/]\\d{1,2}\\s+\\d{1,2}:\\d{1,2}:\\d{1,2})";

                // 定位請求時間 (增加 "定位請求的時間")
                const reqMatch = text.match(
                    new RegExp(
                        `(?:定位請求|Positioning Request)[^:：\\d]*[:：]?\\s*${timePattern}`
                    )
                );
                data.reqTime = reqMatch ? reqMatch[1].replace(/-/g, "/") : "";

                // 註冊基地台時間 (增加 "註冊基地臺時間", "最後註冊時間")
                const regMatch = text.match(
                    new RegExp(
                        `(?:註冊基地|最後註冊|Base Station Reg)[^:：\\d]*[:：]?\\s*${timePattern}`
                    )
                );
                data.regTime = regMatch ? regMatch[1].replace(/-/g, "/") : "";

                // 3. 抓方位角 (增加 "方向角", "天線方位角")
                const azMatch = text.match(
                    /(?:方位|方向|Dir|Azimuth)[^0-9\n]*([0-9]+(?:\.[0-9]+)?)/i
                );
                data.azi = azMatch ? parseFloat(azMatch[1]) : null;

                // 4. 抓座標 (優化版：優先匹配成對座標)
                // 支援 "細胞經度", "細胞緯度"
                // 台灣範圍：Lat 21-27, Lng 118-124

                // 模式 A: 嘗試抓取成對的座標
                const pairMatch =
                    text.match(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/) ||
                    text.match(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/);

                if (pairMatch) {
                    const v1 = parseFloat(pairMatch[1]);
                    const v2 = parseFloat(pairMatch[2]);
                    if (v1 < 100) {
                        data.lat = v1; data.lng = v2;
                    } else {
                        data.lng = v1; data.lat = v2;
                    }
                } else {
                    // 模式 B: 個別關鍵字搜尋 (細胞經度/緯度)
                    const latKeyMatch = text.match(/(?:緯度|Lat)[^0-9\n]*([0-9]+\.[0-9]+)/i);
                    const lngKeyMatch = text.match(/(?:經度|Lng)[^0-9\n]*([0-9]+\.[0-9]+)/i);

                    if (latKeyMatch && lngKeyMatch) {
                        data.lat = parseFloat(latKeyMatch[1]);
                        data.lng = parseFloat(lngKeyMatch[1]);
                    } else {
                        // 模式 C: 暴力搜尋符合範圍的數字
                        const allNums = text.match(/[0-9]+\.[0-9]+/g);
                        if (allNums) {
                            for (let n of allNums) {
                                const val = parseFloat(n);
                                if (val >= config.boundsLatMin && val <= config.boundsLatMax && !data.lat) data.lat = val;
                                else if (val >= config.boundsLngMin && val <= config.boundsLngMax && !data.lng) data.lng = val;
                            }
                        }
                    }
                }

                if (data.lat !== null && data.lng !== null) {
                    // 重新解析新簡訊時，清除舊有的地址資料以防混淆
                    data.addrName = "";
                    data.addrLat = null;
                    data.addrLng = null;
                    syncUI();
                    updateMap(true); // true = 存入歷史
                } else {
                    alert("找不到有效的台灣座標數值，請確認內容。");
                }
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
                    
                    updateMap(save);
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
                document.getElementById("targetAddr").value = data.addrName;
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
                        
                        // 擷取簡化地名 (避免過長)
                        data.addrName = result.display_name.split(',')[0] || addr;
                        
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

            // 更新地圖與歷史紀錄
            function updateMap(save) {
                const mapDiv = document.getElementById("map");
                const mapContainer = document.getElementById("map-container");

                // 使用 Tailwind 類別控制顯示
                mapDiv.classList.remove("hidden");
                if (mapContainer) mapContainer.classList.remove("hidden");

                if (!map) {
                    map = L.map("map").setView([data.lat, data.lng], config.defaultZoom);
                    L.tileLayer(config.mapTileUrl, {
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    }).addTo(map);

                    // 綁定地圖點擊事件 (選點模式)
                    map.on("click", (e) => {
                        if (!isMapSelectActive) return;
                        
                        data.addrLat = parseFloat(e.latlng.lat.toFixed(6));
                        data.addrLng = parseFloat(e.latlng.lng.toFixed(6));
                        data.addrName = "地圖自訂點";
                        
                        toggleMapSelect(null, false);
                        syncUI();
                        updateMap(false);
                    });
                } else {
                    map.panTo([data.lat, data.lng]); // 保留使用者縮放層級
                    // 確保地圖正確重繪 (需等待容器顯示後)
                    setTimeout(() => map.invalidateSize(), 100);
                }

                if (marker) map.removeLayer(marker);
                if (sector) map.removeLayer(sector);

                // 地圖 Popup 顯示內容
                let desc = `<b>📍 基地台定位點</b><br>${data.lat}, ${data.lng}`;
                if (data.phone) desc += `<br>定位門號: ${data.phone}`;
                if (data.reqTime) desc += `<br>🕒 請求: ${data.reqTime}`;
                if (data.regTime) desc += `<br>📡 註冊: ${data.regTime}`;
                if (data.azi !== null) desc += `<br>🧭 方位: ${data.azi}°`;

                marker = L.marker([data.lat, data.lng])
                    .addTo(map)
                    .bindPopup(desc)
                    .openPopup();

                // 繪製扇形 (若有方位角)
                if (data.azi !== null) {
                    const r = config.sectorRadius; // 半徑 (米)
                    const halfApp = config.sectorAperture / 2;
                    const startAngle = (data.azi - halfApp) * (Math.PI / 180);
                    const endAngle = (data.azi + halfApp) * (Math.PI / 180);
                    const points = [[data.lat, data.lng]];

                    for (let i = 0; i <= 20; i++) {
                        const angle = startAngle + (endAngle - startAngle) * (i / 20);
                        // 簡易經緯度換算
                        const dLat = (r / 111320) * Math.cos(angle);
                        const dLng =
                            (r / (111320 * Math.cos(data.lat * (Math.PI / 180)))) *
                            Math.sin(angle);
                        points.push([data.lat + dLat, data.lng + dLng]);
                    }
                    points.push([data.lat, data.lng]);

                    sector = L.polygon(points, {
                        color: "red",
                        fillOpacity: 0.1,
                        weight: 1,
                    }).addTo(map);
                }

                // --- 目標地址 / 位置關聯繪製 ---
                if (addrMarker) map.removeLayer(addrMarker);
                if (relationLine) map.removeLayer(relationLine);

                const hasAddr = data.addrLat !== null && data.addrLng !== null;
                const analysisPanel = document.getElementById("analysisPanel");

                if (hasAddr) {
                    // 1. 建立目標地址標記 (🏠 Pin)
                    addrMarker = L.marker([data.addrLat, data.addrLng], {
                        draggable: true,
                        title: data.addrName || "目標位置"
                    }).addTo(map);

                    // 綁定拖曳結束事件
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

                    // 2. 計算距離與相對方位角
                    const dist = Math.round(map.distance([data.lat, data.lng], [data.addrLat, data.addrLng]));
                    const bearing = Math.round(calculateBearing(data.lat, data.lng, data.addrLat, data.addrLng));

                    // 3. 判斷是否在發射扇形範圍內
                    let isCovered = false;
                    let coveredText = "⚠️ 未提供發射方位角";
                    let coveredClass = "text-slate-500";
                    let lineColor = "#64748b"; // 預設灰藍色

                    if (data.azi !== null) {
                        isCovered = isAngleWithinSector(bearing, data.azi, config.sectorAperture);
                        if (isCovered) {
                            coveredText = "🎯 位於發射扇形內";
                            coveredClass = "text-emerald-600";
                            lineColor = "#10b981"; // 翠綠色
                        } else {
                            coveredText = "❌ 位於發射扇形外";
                            coveredClass = "text-rose-600";
                            lineColor = "#ef4444"; // 亮紅色
                        }
                    }

                    // 4. 繪製虛線連線與動態 Tooltip
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

                    // 5. 更新 Popup
                    let addrDesc = `<b>🏠 目標地址 / 位置</b><br>${data.addrName || "自訂位置"}<br>${data.addrLat}, ${data.addrLng}`;
                    addrMarker.bindPopup(addrDesc).openPopup();

                    // 7. 智慧視野自動調焦 (僅在載入新定位時觸發，拖拽微調時不干擾)
                    if (save) {
                        const bounds = L.latLngBounds([[data.lat, data.lng], [data.addrLat, data.addrLng]]);
                        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
                    }

                    // 8. 更新空間關聯分析 UI 面板
                    if (analysisPanel) {
                        analysisPanel.classList.remove("hidden");
                        document.getElementById("analysisDistance").innerText = `${dist} 公尺`;
                        document.getElementById("analysisBearing").innerText = `${bearing}°`;
                        
                        const covEl = document.getElementById("analysisCoverage");
                        covEl.className = "font-bold " + coveredClass;
                        covEl.innerText = coveredText;
                    }
                } else {
                    if (analysisPanel) {
                        analysisPanel.classList.add("hidden");
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
                        updateMap(false);
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

            // 折疊控制台區塊切換
            function toggleSection(id, btn) {
                const el = document.getElementById(id);
                if (!el) return;

                const isExpanded = el.classList.contains("expanded");
                if (isExpanded) {
                    el.classList.remove("expanded");
                    btn.classList.remove("active");
                } else {
                    el.classList.add("expanded");
                    btn.classList.add("active");
                    if (id === 'secHistory') {
                        renderHistory();
                    }
                }
            }

            // 摺疊/展開左側懸浮控制台
            function toggleConsoleSide() {
                const el = document.getElementById("consolePanel");
                const arrow = document.getElementById("consoleToggleArrow");
                if (!el || !arrow) return;

                const isCollapsed = el.classList.contains("collapsed");
                if (isCollapsed) {
                    el.classList.remove("collapsed");
                    arrow.classList.remove("fa-chevron-right");
                    arrow.classList.add("fa-chevron-left");
                } else {
                    el.classList.add("collapsed");
                    arrow.classList.remove("fa-chevron-left");
                    arrow.classList.add("fa-chevron-right");
                }

                if (map) {
                    setTimeout(() => {
                        map.invalidateSize();
                    }, 350);
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
                toggleSection,
                toggleConsoleSide,
            };
        })();

        // 啟動
        window.onload = app.init;
