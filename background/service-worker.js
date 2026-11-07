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
    if (chrome.declarativeNetRequest?.setExtensionActionOptions) {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: false
      }).catch(() => {});
    }
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
  } else {
    // Clear manual "OFF" text so Chrome's per-tab displayActionCountAsBadgeText takes precedence
    chrome.action.setBadgeText({ text: '' });
    if (chrome.declarativeNetRequest?.setExtensionActionOptions) {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: true
      }).catch(() => {});
    }
  }
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

// In-memory per-tab stats to display per-page blocked counts accurately
const tabStats = new Map();

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      tabStats.delete(tabId);
    }
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabStats.delete(tabId);
  });
}

// Track and count network requests blocked by declarativeNetRequest rules
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    storageAdapter.get(['enabled', 'stats']).then(async (data) => {
      if (data?.enabled === false) return;
      const stats = data?.stats || { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
      stats.bannersBlocked = (stats.bannersBlocked || 0) + 1;
      await storageAdapter.set({ stats });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_STATS') {
    const targetTabId = message.tabId || sender?.tab?.id;
    const statsForTab = tabStats.get(targetTabId) || { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
    sendResponse({ tabStats: statsForTab });
    return true;
  }

  if (message.type === 'RESET_STATS') {
    tabStats.clear();
    handleMessage(message, storageAdapter).then((res) => sendResponse(res));
    return true;
  }

  // Record per-tab stats when content scripts report blocks
  if (sender?.tab?.id) {
    const tabId = sender.tab.id;
    if (!tabStats.has(tabId)) {
      tabStats.set(tabId, { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 });
    }
    const current = tabStats.get(tabId);
    const count = typeof message.count === 'number' && message.count > 0 ? message.count : 1;
    if (message.type === 'AD_BLOCKED') current.bannersBlocked += count;
    if (message.type === 'VIDEO_AD_SKIPPED') current.videoAdsSkipped += count;
    if (message.type === 'ANTI_ADBLOCK_DEFUSED') current.antiAdblockDefused += count;
  }

  handleMessage(message, storageAdapter).then(async (result) => {
    if (message.type === 'TOGGLE_ENABLED') {
      await syncRuleset(result.enabled);
      await updateBadge(result);
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
    sendResponse(result);
  });
  return true; // Keep message channel open for async response
});
