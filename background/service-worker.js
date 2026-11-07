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
      if (chrome.declarativeNetRequest.setExtensionActionOptions) {
        chrome.declarativeNetRequest.setExtensionActionOptions({
          displayActionCountAsBadgeText: true
        }).catch(() => {});
      }
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['ad_rules']
      });
      if (chrome.declarativeNetRequest.setExtensionActionOptions) {
        chrome.declarativeNetRequest.setExtensionActionOptions({
          displayActionCountAsBadgeText: false
        }).catch(() => {});
      }
    }
  } catch (err) {}
}

async function initServiceWorker() {
  const current = await storageAdapter.get();
  if (current.enabled === undefined) {
    await storageAdapter.set(DEFAULT_STATE);
  }
  const isEnabled = current.enabled !== false;
  await syncRuleset(isEnabled);
  const state = await storageAdapter.get();
  await updateBadge(state);
}

// Initialize on load/wake-up
initServiceWorker();

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(initServiceWorker);
}

if (chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(initServiceWorker);
}

// Track and count network requests blocked by declarativeNetRequest rules
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    storageAdapter.get(['enabled', 'stats']).then(async (data) => {
      if (data?.enabled === false) return;
      const stats = data?.stats || { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
      stats.bannersBlocked = (stats.bannersBlocked || 0) + 1;
      await storageAdapter.set({ stats });
      await updateBadge({ enabled: true, stats });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, storageAdapter).then(async (result) => {
    if (message.type === 'TOGGLE_ENABLED') {
      await syncRuleset(result.enabled);
      if (chrome.tabs?.query) {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs || []) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled: result.enabled }).catch(() => {});
            }
          }
        });
      }
    }
    await updateBadge(result);
    sendResponse(result);
  });
  return true; // Keep message channel open for async response
});
