// 全域錯誤攔截 (用於除錯)
window.onerror = function (msg, url, lineNo, columnNo, error) {
  alert("系統錯誤: " + msg + "\nLine: " + lineNo);
  return false;
};

/**
 * 警用定位助手 v50.0 (正式發布版)
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

  // --- 參數解耦配置 (Config) ---
  const STORAGE_KEY = "police_locate_v50_config";
  const DEFAULT_CONFIG = {
    sectorRadius: 300,      // 扇形半徑 (米)
    sectorApperture: 60,    // 扇形夾角 (度)
    defaultZoom: 16,        // 預設縮放層級
    historyLimit: 50,       // 歷史紀錄上限
    mapTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    boundsLatMin: 21,       // 台灣經緯度界線 (Lat Min)
    boundsLatMax: 27,
    boundsLngMin: 118,
    boundsLngMax: 124
  };
  let config = { ...DEFAULT_CONFIG };

  const HISTORY_STORAGE_KEY = "police_locate_v50_db";

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
    } catch (e) {
      console.error("Init error:", e);
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
    const phMatch = text.match(
      /(?:[^0-9\.]|^)(09\d{8}|8869\d{8})(?:[^0-9\.]|$)/
    );
    if (phMatch) {
      let ph = phMatch[1];
      if (ph.startsWith("886")) ph = "0" + ph.substring(3);
      data.phone = ph;
    }

    // 2. 抓時間 (定位請求 & 註冊基地台)
    // 格式：yyyy/MM/dd HH:mm:ss
    const timePattern =
      "(\\d{4}[-\\/]\\d{1,2}[-\\/]\\d{1,2}\\s+\\d{1,2}:\\d{1,2}:\\d{1,2})";

    // 定位請求時間
    const reqMatch = text.match(
      new RegExp(
        `(?:定位請求|Positioning Request)[^:：\\d]*[:：]?\\s*${timePattern}`
      )
    );
    data.reqTime = reqMatch ? reqMatch[1].replace(/\//g, "-") : "";

    // 註冊基地台時間
    const regMatch = text.match(
      new RegExp(
        `(?:註冊基地|最後註冊|Base Station Reg)[^:：\\d]*[:：]?\\s*${timePattern}`
      )
    );
    data.regTime = regMatch ? regMatch[1].replace(/\//g, "-") : "";

    // 3. 抓方位角
    const azMatch = text.match(
      /(?:方位|Dir|Azimuth)[^0-9\n]*([0-9]+(?:\.[0-9]+)?)/i
    );
    data.azi = azMatch ? parseFloat(azMatch[1]) : null;

    // 4. 抓座標 (優化版：優先匹配成對座標)
    // 台灣範圍：Lat 21-27, Lng 118-124
    // 使用更嚴謹的正規式以避免誤判

    // 嘗試抓取成對的座標 (Lat, Lng 或 Lng, Lat)，中間允許逗號或空白
    const pairMatch =
      text.match(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/) ||
      text.match(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/);

    if (pairMatch) {
      // 判斷哪個是 Lat 哪個是 Lng
      const v1 = parseFloat(pairMatch[1]);
      const v2 = parseFloat(pairMatch[2]);
      if (v1 < 100) {
        data.lat = v1;
        data.lng = v2;
      } else {
        data.lng = v1;
        data.lat = v2;
      }
    } else {
      // 備用方案：個別搜尋
      const latPattern = new RegExp(`${config.boundsLatMin.toString().substring(0,1)}[1-7]\\.[0-9]+`);
      const lngPattern = new RegExp(`${config.boundsLngMin.toString().substring(0,3)}\\.[0-9]+`);

      const allNums = text.match(/[0-9]+\.[0-9]+/g);
      if (allNums) {
        for (let n of allNums) {
          const val = parseFloat(n);
          if (val >= config.boundsLatMin && val <= config.boundsLatMax && !data.lat) data.lat = val;
          else if (val >= config.boundsLngMin && val <= config.boundsLngMax && !data.lng) data.lng = val;
        }
      }
    }

    if (data.lat && data.lng) {
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

    if (!isNaN(lat) && !isNaN(lng)) {
      data = {
        lat,
        lng,
        azi: isNaN(az) ? null : az,
        phone: ph,
        reqTime: req,
        regTime: reg,
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
        attribution: "&copy; OSM",
      }).addTo(map);
    } else {
      map.setView([data.lat, data.lng], config.defaultZoom);
      // 確保地圖正確重繪 (需等待容器顯示後)
      setTimeout(() => map.invalidateSize(), 100);
    }

    if (marker) map.removeLayer(marker);
    if (sector) map.removeLayer(sector);

    // 地圖 Popup 顯示內容
    let desc = `<b>📍 定位點</b><br>${data.lat}, ${data.lng}`;
    if (data.phone) desc += `<br>📞 ${data.phone}`;
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
      const halfApp = config.sectorApperture / 2;
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
    if (data.lat)
      window.open(
        `https://www.google.com/maps?q=${data.lat},${data.lng}`,
        "_blank"
      );
    else alert("無座標");
  }

  // 取得完整分享文字 (符合使用者要求的格式)
  function getFullText() {
    const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
    let t = `${mapUrl}\n`;
    if (data.phone) t += `門號: ${data.phone}\n`;
    if (data.reqTime) t += `定位時間: ${data.reqTime}\n`;
    if (data.regTime) t += `註冊時間: ${data.regTime}\n`;
    t += `定位經緯度: ${data.lat}, ${data.lng}`;
    if (data.azi) t += ` (方位:${data.azi})`;
    return t;
  }

  function copy() {
    if (!data.lat) return alert("無座標");
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
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("✅ 資訊已複製");
  }

  function share(type) {
    if (!data.lat) return alert("無座標");
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
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
      // 使用 Tailwind 樣式
      li.className =
        "bg-white rounded-xl p-[15px] mb-[10px] shadow-[0_2px_5px_rgba(0,0,0,0.03)] border border-[#eee] relative cursor-pointer hover:bg-[#f8f9fa] hover:border-accent transition-colors";
      li.innerHTML = `
                <div class="text-[0.8rem] text-[#999] mb-[4px]">${
                  item.time
                }</div>
                <div class="flex items-center gap-[8px] mb-[4px]">
                    <span class="font-bold text-primary text-[1.05rem]">${
                      item.lat
                    }, ${item.lng}</span>
                    ${
                      item.phone
                        ? `<span class="tag text-[0.8rem] py-[2px] px-[6px] rounded bg-[#e3f2fd] text-[#2980b9]">${item.phone}</span>`
                        : ""
                    }
                </div>
                ${
                  item.reqTime
                    ? `<div class="text-[0.85rem] text-[#555]">🕒 ${item.reqTime}</div>`
                    : ""
                }
                ${
                  item.azi
                    ? `<div class="text-[0.85rem] text-[#d35400]">🧭 方位: ${item.azi}°</div>`
                    : ""
                }
                <i class="fa-solid fa-xmark del-icon absolute top-[15px] right-[15px] text-del p-[5px] hover:scale-110 transition-transform" onclick="app.deleteItem(${
                  item.id
                }, event)"></i>
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


  // --- 設定面板互動邏輯 (側邊抽屜控制) ---
  function syncConfigToUI() {
    const inputs = {
      'cfg-radius': 'sectorRadius',
      'cfg-aperture': 'sectorApperture',
      'cfg-zoom': 'defaultZoom',
      'cfg-history-limit': 'historyLimit'
    };

    for (let id in inputs) {
      const el = document.getElementById(id);
      if (el) {
        el.value = config[inputs[id]];
        el.oninput = (e) => {
          let val = parseFloat(e.target.value);
          config[inputs[id]] = val;
          saveConfig();
          const display = document.getElementById(id + '-val');
          if (display) display.innerText = val;
        };
      }
    }

    // --- 側邊抽屜控制邏輯 ---
    const btnToggle = document.getElementById('btnToggleConfig');
    const btnClose = document.getElementById('btnCloseConfig');
    const panel = document.getElementById('configPanel');
    const overlay = document.getElementById('configOverlay');

    const toggleDrawer = (isOpen) => {
      if (isOpen) {
        overlay.classList.remove('hidden');
        // 強制重繪以觸發動畫
        void overlay.offsetWidth;
        overlay.classList.add('opacity-100');
        panel.setAttribute('data-open', 'true');
        document.body.style.overflow = 'hidden';
      } else {
        overlay.classList.remove('opacity-100');
        panel.removeAttribute('data-open');
        document.body.style.overflow = '';
        setTimeout(() => {
          if (!panel.hasAttribute('data-open')) {
            overlay.classList.add('hidden');
          }
        }, 300);
      }
    };

    if (btnToggle) {
      btnToggle.onclick = (e) => {
        e.preventDefault();
        toggleDrawer(true);
      };
    }

    if (btnClose) {
      btnClose.onclick = () => toggleDrawer(false);
    }

    if (overlay) {
      overlay.onclick = () => toggleDrawer(false);
    }

    // 恢復預設值
    const btnReset = document.getElementById('btnResetConfig');
    if (btnReset) {
      btnReset.onclick = () => {
        if (confirm("確定要恢復所有進階設定為預設值嗎？")) {
          config = { ...DEFAULT_CONFIG };
          saveConfig();
          syncConfigToUI();
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
if (typeof app !== "undefined") {
  window.onload = app.init;
} else {
  alert("嚴重錯誤：程式初始化失敗，請檢查瀏覽器控制台。");
}
