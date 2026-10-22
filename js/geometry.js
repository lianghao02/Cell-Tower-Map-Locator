/* 基地台扇形的幾何計算：方位角、扇形範圍判斷、凸多邊形裁切與交集、面積與重心。
 * 全部是純函式：不讀寫 DOM、地圖、儲存，也不依賴 app.js 的任何變數。
 * 由 js/app.js 逐字拆出（內容未修改）。以傳統 <script> 載入（離線雙擊 index.html 也能運作），
 * 必須在 js/app.js 之前載入。回歸測試：tests/parser.test.js（扇形交集）。 */

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
