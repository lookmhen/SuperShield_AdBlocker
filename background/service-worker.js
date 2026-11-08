// background/service-worker.js
import {
  DEFAULT_STATE,
  handleMessage,
  parseBlocklist,
  createDnrRules,
  extractCosmeticFilters
} from './service-worker-logic.js';

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

/**
 * Synchronizes custom user rules and list subscriptions with DeclarativeNetRequest dynamic rules
 * and cosmetic filters stored in local storage.
 */
async function syncAllRules() {
  if (!chrome.declarativeNetRequest) return;

  const current = await storageAdapter.get();
  const isEnabled = current.enabled !== false;

  // If extension is disabled, purge all dynamic rules and clear custom cosmetic filters
  if (!isEnabled) {
    try {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      if (existing && existing.length > 0) {
        const removeRuleIds = existing.map((r) => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
      }
      await storageAdapter.set({
        customCosmeticFilters: {},
        customGlobalFilters: []
      });
    } catch (err) {}
    return;
  }

  const customText = current.customRawRulesText || '';
  const subscriptions = Array.isArray(current.subscriptions) ? current.subscriptions : [];

  // Parse all user rules and subscriptions
  const allTexts = [customText, ...subscriptions.map((s) => s.rawText || '')];
  const combinedNetwork = [];
  const combinedCosmetic = [];
  const seenNetworkKeys = new Set();

  for (const text of allTexts) {
    if (!text || typeof text !== 'string') continue;
    const parsed = parseBlocklist(text);

    for (const rule of parsed.networkRules) {
      const key = `${rule.isAllow ? 'allow:' : 'block:'}${rule.urlFilter}:${rule.domainType || ''}`;
      if (!seenNetworkKeys.has(key)) {
        seenNetworkKeys.add(key);
        combinedNetwork.push(rule);
      }
    }

    combinedCosmetic.push(...parsed.cosmeticRules);
  }

  // Update dynamic DNR rules in Chromium
  try {
    const dnrRules = createDnrRules(combinedNetwork, 10001, 25000);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: dnrRules
    });
  } catch (err) {
    console.error('Failed to update declarativeNetRequest dynamic rules:', err);
  }

  // Update cosmetic filters for content scripts
  try {
    const { domainFilters, globalFilters } = extractCosmeticFilters(combinedCosmetic);
    await storageAdapter.set({
      customCosmeticFilters: domainFilters,
      customGlobalFilters: globalFilters
    });
  } catch (err) {
    console.error('Failed to update cosmetic filters:', err);
  }
}

async function initServiceWorker() {
  const current = await storageAdapter.get();
  if (current.enabled === undefined) {
    await storageAdapter.set(DEFAULT_STATE);
  }
  const isEnabled = current.enabled !== false;
  await syncRuleset(isEnabled);
  await syncAllRules();
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

  // Custom Rules & Subscription messages
  if (message.type === 'GET_CUSTOM_DATA') {
    storageAdapter.get().then(async (current) => {
      let dynamicCount = 0;
      if (chrome.declarativeNetRequest?.getDynamicRules) {
        try {
          const rules = await chrome.declarativeNetRequest.getDynamicRules();
          dynamicCount = rules?.length || 0;
        } catch (e) {}
      }
      sendResponse({
        customRawRulesText: current.customRawRulesText || '',
        subscriptions: current.subscriptions || [],
        dynamicRulesCount: dynamicCount
      });
    });
    return true;
  }

  if (message.type === 'SAVE_CUSTOM_RULES') {
    const rulesText = typeof message.rulesText === 'string' ? message.rulesText : '';
    storageAdapter.set({ customRawRulesText: rulesText }).then(async () => {
      await syncAllRules();
      sendResponse({ success: true, customRawRulesText: rulesText });
    });
    return true;
  }

  if (message.type === 'CLEAR_CUSTOM_RULES') {
    storageAdapter.set({ customRawRulesText: '' }).then(async () => {
      await syncAllRules();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'ADD_SUBSCRIPTION') {
    const url = (message.url || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      sendResponse({ success: false, error: 'URL must start with http:// or https://' });
      return true;
    }

    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          sendResponse({ success: false, error: `Failed to download: HTTP ${res.status}` });
          return;
        }

        const rawText = await res.text();
        const parsed = parseBlocklist(rawText);
        const subName = parsed.title || message.name || url.split('/').pop().split('?')[0] || 'Blocklist';

        const current = await storageAdapter.get();
        const subs = Array.isArray(current.subscriptions) ? [...current.subscriptions] : [];
        const existingIdx = subs.findIndex((s) => s.url === url || s.id === url);

        const newSub = {
          id: url,
          url,
          name: subName,
          networkRulesCount: parsed.networkRules.length,
          cosmeticRulesCount: parsed.cosmeticRules.length,
          totalCount: parsed.networkRules.length + parsed.cosmeticRules.length,
          rawText,
          updatedAt: Date.now()
        };

        if (existingIdx >= 0) {
          subs[existingIdx] = newSub;
        } else {
          subs.push(newSub);
        }

        await storageAdapter.set({ subscriptions: subs });
        await syncAllRules();
        sendResponse({ success: true, subscription: newSub, subscriptions: subs });
      } catch (err) {
        sendResponse({
          success: false,
          error: err.name === 'AbortError' ? 'Request timed out after 20s' : (err.message || 'Download failed')
        });
      }
    })();
    return true;
  }

  if (message.type === 'REMOVE_SUBSCRIPTION') {
    const targetUrl = message.url || message.id;
    storageAdapter.get().then(async (current) => {
      const subs = (current.subscriptions || []).filter((s) => s.url !== targetUrl && s.id !== targetUrl);
      await storageAdapter.set({ subscriptions: subs });
      await syncAllRules();
      sendResponse({ success: true, subscriptions: subs });
    });
    return true;
  }

  if (message.type === 'REFRESH_SUBSCRIPTIONS') {
    (async () => {
      try {
        const current = await storageAdapter.get();
        const subs = Array.isArray(current.subscriptions) ? [...current.subscriptions] : [];

        for (let i = 0; i < subs.length; i++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(subs[i].url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              const text = await res.text();
              const parsed = parseBlocklist(text);
              subs[i].rawText = text;
              subs[i].networkRulesCount = parsed.networkRules.length;
              subs[i].cosmeticRulesCount = parsed.cosmeticRules.length;
              subs[i].totalCount = parsed.networkRules.length + parsed.cosmeticRules.length;
              subs[i].updatedAt = Date.now();
            }
          } catch (e) {}
        }

        await storageAdapter.set({ subscriptions: subs });
        await syncAllRules();
        sendResponse({ success: true, subscriptions: subs });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  handleMessage(message, storageAdapter).then(async (result) => {
    if (message.type === 'TOGGLE_ENABLED') {
      await syncRuleset(result.enabled);
      await syncAllRules();
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
