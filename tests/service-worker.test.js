const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const prefix = 'cell-tower-locator-';

// CacheStorage 由同一來源的所有網站共用，Service Worker 範圍不會隔離它。
test('啟用只移除本專案舊快取，保留其他專案與目前版本', async () => {
    const current = source.match(/const CACHE_NAME = ['"]([^'"]+)/)[1];
    const keys = [current, prefix + 'old', 'other-project-v1',
        'cell-tower-locator-v999', 'calendar-card-app-v999',
        'subscription-manager-v999', 'aromacraft-v999', 'unrelated-' + prefix + 'old'];
    const deleted = [];
    const handlers = {};
    let claimed = false;
    const context = vm.createContext({
        URL,
        self: {
            addEventListener: (name, handler) => { handlers[name] = handler; },
            clients: { claim: async () => { claimed = true; } },
        },
        caches: {
            keys: async () => keys,
            delete: async key => { deleted.push(key); return true; },
        },
    });
    vm.runInContext(source, context);
    let completion;
    handlers.activate({ waitUntil: promise => { completion = promise; } });
    assert.ok(completion, '須等待清理完成後才啟用');
    await completion;
    assert.deepEqual(deleted.sort(), keys.filter(key => key.startsWith(prefix) && key !== current).sort());
    assert.equal(claimed, true);
});
