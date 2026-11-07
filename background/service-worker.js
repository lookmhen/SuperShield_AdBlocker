// background/service-worker.js
import { DEFAULT_STATE, handleMessage } from './service-worker-logic.js';

const storageAdapter = {
  async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys || null, (res) => resolve(res || {}));
    });
  },
  async set(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }
};

async function updateBadge(state) {
  if (!chrome.action) return;

  if (!state.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
    return;
  }

  const total = (state.stats?.bannersBlocked || 0) +
                (state.stats?.videoAdsSkipped || 0) +
                (state.stats?.antiAdblockDefused || 0);

  const text = total > 9999 ? '9.9k+' : total > 0 ? String(total) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#1E90FF' });
}

async function syncRuleset(enabled) {
  if (!chrome.declarativeNetRequest) return;
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['ad_rules']
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['ad_rules']
      });
    }
  } catch (err) {}
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await storageAdapter.get();
  if (current.enabled === undefined) {
    await storageAdapter.set(DEFAULT_STATE);
  }
  await syncRuleset(current.enabled !== false);
  const state = await storageAdapter.get();
  await updateBadge(state);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, storageAdapter).then(async (result) => {
    if (message.type === 'TOGGLE_ENABLED') {
      await syncRuleset(result.enabled);
    }
    await updateBadge(result);
    sendResponse(result);
  });
  return true; // Keep message channel open for async response
});
