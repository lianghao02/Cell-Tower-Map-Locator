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
            let map, marker, sector;
            // 資料模型 (包含 reqTime, regTime)
            let data = {
                lat: null,
                lng: null,
                azi: null,
                phone: "",
                reqTime: "",
                regTime: "",
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
                    ["lat", "lng", "phone", "azi", "reqTime", "regTime"].forEach((id) => {
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
                const req = document.getElementById("reqTime").value; // UI上已經是更動後的
                const reg = document.getElementById("regTime").value;

                if (!isNaN(lat) && !isNaN(lng)) {
                    data = {
                        lat,
                        lng,
                        azi: isNaN(az) ? null : az,
                        phone: ph,
                        reqTime: req.replace(/-/g, "/"),
                        regTime: reg.replace(/-/g, "/"),
                    };
                    updateMap(save);
                }
            }

            // 更新 UI 顯示 (同步資料至輸入框)
            function syncUI() {
                document.getElementById("lat").value = data.lat;
                document.getElementById("lng").value = data.lng;
                document.getElementById("azi").value = data.azi !== null ? data.azi : "";
                document.getElementById("phone").value = data.phone;
                document.getElementById("reqTime").value = data.reqTime;
                document.getElementById("regTime").value = data.regTime;
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
                } else {
                    map.panTo([data.lat, data.lng]); // 保留使用者縮放層級
                    // 確保地圖正確重繪 (需等待容器顯示後)
                    setTimeout(() => map.invalidateSize(), 100);
                }

                if (marker) map.removeLayer(marker);
                if (sector) map.removeLayer(sector);

                // 地圖 Popup 顯示內容
                let desc = `<b>📍 定位點</b><br>${data.lat}, ${data.lng}`;
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

            // 產生應用程式分享連結
            function getAppLink() {
                // 固定使用此 Github Pages 網址 (需配合 Repository 名稱)
                const baseUrl = "https://lianghao02.github.io/Cell-Tower-Map-Locator/";
                const params = new URLSearchParams();
                if (data.lat !== null) params.append('lat', data.lat);
                if (data.lng !== null) params.append('lng', data.lng);
                if (data.azi !== null) params.append('azi', data.azi); // 修正：azi=0 也需帶入
                if (data.phone) params.append('phone', data.phone);
                if (data.reqTime) params.append('reqTime', data.reqTime);
                if (data.regTime) params.append('regTime', data.regTime);
                return baseUrl + "?" + params.toString();
            }

            // 取得完整分享文字 (符合使用者要求的格式)
            function getFullText() {
                const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
                const appUrl = getAppLink();

                let t = `${mapUrl}\n`;
                if (data.phone) t += `定位門號: ${data.phone}\n`;
                if (data.reqTime) t += `定位時間: ${data.reqTime}\n`;
                if (data.regTime) t += `註冊時間: ${data.regTime}\n`;
                t += `定位經緯度: ${data.lat}, ${data.lng}`;
                if (data.azi !== null) t += ` (方位:${data.azi})`; // 修正：azi=0 不應被忽略

                // 加上專用連結
                t += `\n\n📌 專用圖台 (含扇形):\n${appUrl}`;

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
                // 嘗試使用 execCommand (legacy)，若失敗則提示手動複製
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

            function share(type) {
                if (data.lat === null) return alert("無座標");
                const t = getFullText();
                const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`; // 用於 Telegram 按鈕連結

                let url = "";
                // LINE: 傳送完整文字
                if (type === "line") {
                    url = `https://line.me/R/msg/text/?${encodeURIComponent(t)}`;
                }
                // Telegram: url 參數放地圖連結，text 放其餘資訊 (避免重複)
                else {
                    const textBody = t.replace(mapUrl + "\n", "");
                    url = `https://t.me/share/url?url=${encodeURIComponent(
                        mapUrl
                    )}&text=${encodeURIComponent(textBody)}`;
                }

                // 檢測是否為行動裝置
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

            // 貼上功能 (使用 Promise)
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
                // 避免重複存入完全相同的資料
                const isDup = history.some(
                    (h) =>
                        h.lat === data.lat &&
                        h.lng === data.lng &&
                        h.phone === data.phone &&
                        h.reqTime === data.reqTime &&
                        h.regTime === data.regTime
                );
                if (isDup) return;

                history.unshift({
                    id: Date.now(),
                    time: now,
                    ...data,
                });
                if (history.length > config.historyLimit) history.pop(); // 使用配置上限
                saveHistory();
            }

            function deleteItem(id, e) {
                e.stopPropagation();
                history = history.filter((x) => x.id !== id);
                saveHistory();
            }

            function clearHistory() {
                if (confirm("確定清空紀錄？")) {
                    history = [];
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
                    // 使用 esc() 對使用者輸入資料做 HTML 轉義 (防 XSS)
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
                        };
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
            };
        })();

        // 啟動
        window.onload = app.init;
