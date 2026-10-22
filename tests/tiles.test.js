'use strict';
// 地圖圖磚備援：Leaflet 的 tileerror 只傳一個事件物件，備援網址由純函式決定（js/tiles.js）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'tiles.js'), 'utf8');
const t = vm.runInNewContext(code + '\n({ NLSC_TILE_URL, buildTileUrl, tileFallbackUrl })');

test('備援網址依事件裡的圖磚座標組出', () => {
    const tile = { src: 'https://a.tile.openstreetmap.de/16/54800/28100.png' };
    const url = t.tileFallbackUrl({ tile, coords: { x: 54800, y: 28100, z: 16 } });
    assert.equal(url, 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/16/28100/54800');
});

test('這塊已經是備援來源時不再重試，避免無限迴圈', () => {
    const coords = { x: 1, y: 2, z: 3 };
    const tile = { src: t.buildTileUrl(t.NLSC_TILE_URL, coords) };
    assert.equal(t.tileFallbackUrl({ tile, coords }), null);
});

test('事件資料不全或座標不合法時不丟錯，只是不備援', () => {
    // 舊寫法 function (error, tile) 的第二個參數永遠是 undefined，會在每塊失敗的圖磚上丟 TypeError。
    for (const event of [undefined, null, {}, { tile: {} }, { coords: { x: 1, y: 2, z: 3 } },
        { tile: {}, coords: { x: 'a', y: 2, z: 3 } }, { tile: {}, coords: { x: -1, y: 2, z: 3 } },
        { tile: {}, coords: { x: 1.5, y: 2, z: 3 } }]) {
        assert.doesNotThrow(() => t.tileFallbackUrl(event));
        assert.equal(t.tileFallbackUrl(event), null);
    }
});
