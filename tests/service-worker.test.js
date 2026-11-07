// tests/service-worker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

// Mock chrome storage
function createMockStorage() {
  return {
    data: {
      enabled: true,
      stats: { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 }
    },
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: this.data[keys] };
      return { ...this.data };
    },
    async set(items) {
      Object.assign(this.data, items);
      if (items.stats) {
        this.data.stats = { ...this.data.stats, ...items.stats };
      }
    }
  };
}

test('service-worker increments counters on content script notifications', async () => {
  const { handleMessage } = await import('../background/service-worker-logic.js');
  const storage = createMockStorage();

  const res1 = await handleMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 }, storage);
  assert.equal(res1.stats.videoAdsSkipped, 1);

  const res2 = await handleMessage({ type: 'AD_BLOCKED', count: 2 }, storage);
  assert.equal(res2.stats.bannersBlocked, 2);

  const res3 = await handleMessage({ type: 'ANTI_ADBLOCK_DEFUSED', count: 3 }, storage);
  assert.equal(res3.stats.antiAdblockDefused, 3);

  const finalData = await storage.get();
  assert.equal(finalData.stats.videoAdsSkipped, 1);
  assert.equal(finalData.stats.bannersBlocked, 2);
  assert.equal(finalData.stats.antiAdblockDefused, 3);
});

test('service-worker toggles extension enabled status', async () => {
  const { handleMessage } = await import('../background/service-worker-logic.js');
  const storage = createMockStorage();

  const toggleRes = await handleMessage({ type: 'TOGGLE_ENABLED', enabled: false }, storage);
  assert.equal(toggleRes.enabled, false);

  const finalData = await storage.get();
  assert.equal(finalData.enabled, false);
});
