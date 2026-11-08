// background/service-worker.js
// Standalone Service Worker for SuperShield AdBlocker Manifest V3
// Fully self-contained to run seamlessly in both classic and module environments without import errors.

const DEFAULT_STATE = {
  enabled: true,
  stats: {
    bannersBlocked: 0,
    videoAdsSkipped: 0,
    antiAdblockDefused: 0
  },
  customRawRulesText: '',
  subscriptions: []
};

const DEFAULT_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other'
];

/**
 * Validates whether a urlFilter string adheres strictly to Chromium's DeclarativeNetRequest specification.
 * Discards malformed rules (e.g. XPath fragments ||/html/..., JS code tokens, brackets, semicolons).
 * @param {string} filter
 * @returns {boolean}
 */
function isValidDnrUrlFilter(filter) {
  if (!filter || typeof filter !== 'string') return false;
  // Printable ASCII only, no spaces
  if (!/^[\x21-\x7E]+$/.test(filter)) return false;
  // Cannot start with ||* or ||/
  if (filter.startsWith('||*') || filter.startsWith('||/')) return false;
  // Cannot contain illegal characters: comma, semicolon, quotes, braces, parens, brackets, angle brackets
  if (/[;,\\'"\`{}()\[\]<>]/.test(filter)) return false;

  // If starts with ||, the domain part must look like a valid domain/hostname
  if (filter.startsWith('||')) {
    const rest = filter.slice(2);
    // Domain part is everything before /, ^, ?, or :
    const domainMatch = rest.match(/^([a-zA-Z0-9_.*-]+)/);
    if (!domainMatch) return false;
    const domain = domainMatch[1];
    // Domain must contain at least one dot or wildcard, and not be pure numbers
    if (!domain.includes('.') && !domain.includes('*')) return false;
    if (/^\d+$/.test(domain)) return false;
    return true;
  }

  // If starts with http:// or https://
  if (filter.startsWith('http://') || filter.startsWith('https://')) {
    const afterProto = filter.replace(/^https?:\/\//, '');
    const domainMatch = afterProto.match(/^([a-zA-Z0-9_.*-]+)/);
    if (!domainMatch) return false;
    const domain = domainMatch[1];
    if (!domain.includes('.') && !domain.includes('*')) return false;
    if (/^\d+$/.test(domain)) return false;
    return true;
  }

  // Plain domains must have at least one dot and valid domain format
  if (/^[a-zA-Z0-9_.*-]+\.[a-zA-Z0-9_.*-]+/.test(filter)) {
    return true;
  }

  return false;
}

function parseBlocklist(text) {
  if (!text || typeof text !== 'string') {
    return { title: '', networkRules: [], cosmeticRules: [] };
  }

  const lines = text.split(/\r?\n/);
  const networkRules = [];
  const cosmeticRules = [];
  const seenNetwork = new Set();
  const seenCosmetic = new Set();
  let title = '';

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;

    // Check title in comments
    if (line.startsWith('!')) {
      const titleMatch = line.match(/^!\s*Title:\s*(.+)$/i);
      if (titleMatch && !title) {
        title = titleMatch[1].trim();
      }
      continue;
    }

    // Skip Adblock headers like [Adblock Plus 2.0]
    if (line.startsWith('[')) continue;

    // Skip hash comments unless it's a cosmetic hiding rule starting with ##
    if (line.startsWith('#') && !line.startsWith('##')) continue;

    // Cosmetic element hiding rules (e.g. "example.com##.banner", "##.ad-box")
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) {
      if (line.includes('##')) {
        const idx = line.indexOf('##');
        const domainPart = line.slice(0, idx).trim();
        const selector = line.slice(idx + 2).trim();
        if (selector) {
          const domains = domainPart
            ? domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
            : [];
          const key = `${domains.join(',')}:${selector}`;
          if (!seenCosmetic.has(key)) {
            seenCosmetic.add(key);
            cosmeticRules.push({
              domains,
              selector,
              raw: line
            });
          }
        }
      }
      continue;
    }

    // Network rules
    // 1. Strip trailing comment (e.g., "bad.com # tracker")
    line = line.replace(/\s+#.*$/, '').trim();
    if (!line) continue;

    // 2. Hosts file format: "0.0.0.0 bad.com", "127.0.0.1 bad.com", "::1 bad.com"
    const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+([^\s#]+)/);
    if (hostsMatch) {
      line = hostsMatch[1].trim();
    }

    // Skip localhost and broadcast IPs
    if (
      line === 'localhost' ||
      line === '0.0.0.0' ||
      line === '127.0.0.1' ||
      line === 'broadcasthost' ||
      line === 'local'
    ) {
      continue;
    }

    // 3. Allowlist rule check (starts with @@)
    let isAllow = false;
    if (line.startsWith('@@')) {
      isAllow = true;
      line = line.slice(2).trim();
    }

    // 4. Options check (e.g. pattern$script,third-party)
    let domainType = undefined;
    let resourceTypes = undefined;
    if (line.includes('$')) {
      const dollarIndex = line.lastIndexOf('$');
      const patternPart = line.slice(0, dollarIndex).trim();
      const optionsPart = line.slice(dollarIndex + 1).trim();

      const options = optionsPart.split(',').map((opt) => opt.trim().toLowerCase());
      // Skip if explicitly marked with $badfilter
      if (options.includes('badfilter')) {
        continue;
      }

      if (options.includes('third-party') || options.includes('3p')) {
        domainType = 'thirdParty';
      } else if (options.includes('first-party') || options.includes('1p') || options.includes('~third-party')) {
        domainType = 'firstParty';
      }

      // Map resource types
      const typeMap = {
        script: 'script',
        image: 'image',
        stylesheet: 'stylesheet',
        css: 'stylesheet',
        xmlhttprequest: 'xmlhttprequest',
        xhr: 'xmlhttprequest',
        subdocument: 'sub_frame',
        sub_frame: 'sub_frame',
        font: 'font',
        media: 'media',
        websocket: 'websocket',
        ping: 'ping',
        other: 'other'
      };

      const matchedTypes = [];
      for (const opt of options) {
        if (typeMap[opt] && !matchedTypes.includes(typeMap[opt])) {
          matchedTypes.push(typeMap[opt]);
        }
      }
      if (matchedTypes.length > 0) {
        resourceTypes = matchedTypes;
      }

      line = patternPart;
    }

    if (!line) continue;

    // 5. Normalization for DeclarativeNetRequest urlFilter
    let urlFilter = line;
    // Strip leading wildcard *. (e.g. *.adserver.com -> adserver.com)
    if (urlFilter.startsWith('*.')) {
      urlFilter = urlFilter.slice(2);
    }

    // Strip leading protocol anchor |http:// or |https://
    if (urlFilter.startsWith('|http://')) {
      urlFilter = urlFilter.slice(1);
    } else if (urlFilter.startsWith('|https://')) {
      urlFilter = urlFilter.slice(1);
    }

    // Wrap plain domain in ||domain^ for exact domain and subdomain boundary matching
    if (!urlFilter.startsWith('||') && !urlFilter.startsWith('http://') && !urlFilter.startsWith('https://')) {
      if (!urlFilter.includes('/') && !urlFilter.endsWith('^')) {
        urlFilter = `||${urlFilter}^`;
      } else if (!urlFilter.startsWith('||')) {
        urlFilter = `||${urlFilter}`;
      }
    }

    // Validate that the filter conforms to Chromium's DeclarativeNetRequest specifications
    if (!isValidDnrUrlFilter(urlFilter)) continue;

    const key = `${isAllow ? 'allow:' : 'block:'}${urlFilter}:${domainType || ''}:${resourceTypes?.join(',') || ''}`;
    if (!seenNetwork.has(key)) {
      seenNetwork.add(key);
      networkRules.push({
        urlFilter,
        isAllow,
        ...(domainType ? { domainType } : {}),
        ...(resourceTypes ? { resourceTypes } : {}),
        raw: raw.trim()
      });
    }
  }

  return {
    title,
    networkRules,
    cosmeticRules
  };
}

function createDnrRules(networkRules, startId = 10001, maxRules = 25000) {
  if (!Array.isArray(networkRules)) return [];

  const rules = [];
  let allocated = 0;

  for (let i = 0; i < networkRules.length && allocated < maxRules; i++) {
    const item = networkRules[i];
    if (!isValidDnrUrlFilter(item.urlFilter)) continue;

    const id = startId + allocated;
    allocated++;

    const rule = {
      id,
      priority: item.isAllow ? 2 : 1,
      action: {
        type: item.isAllow ? 'allow' : 'block'
      },
      condition: {
        urlFilter: item.urlFilter,
        resourceTypes: item.resourceTypes || DEFAULT_RESOURCE_TYPES
      }
    };

    if (item.domainType) {
      rule.condition.domainType = item.domainType;
    }

    rules.push(rule);
  }

  return rules;
}

function extractCosmeticFilters(cosmeticRules) {
  const domainFilters = {};
  const globalFilters = [];
  const seenGlobal = new Set();

  if (!Array.isArray(cosmeticRules)) {
    return { domainFilters, globalFilters };
  }

  for (const item of cosmeticRules) {
    if (!item || !item.selector) continue;
    const selector = item.selector.trim();
    if (!selector) continue;

    if (!Array.isArray(item.domains) || item.domains.length === 0) {
      if (!seenGlobal.has(selector)) {
        seenGlobal.add(selector);
        globalFilters.push(selector);
      }
    } else {
      for (const domain of item.domains) {
        const d = domain.trim().toLowerCase();
        if (!d) continue;
        if (!domainFilters[d]) {
          domainFilters[d] = [];
        }
        if (!domainFilters[d].includes(selector)) {
          domainFilters[d].push(selector);
        }
      }
    }
  }

  return { domainFilters, globalFilters };
}

async function handleMessage(message, storage) {
  if (!message || !message.type) {
    return await storage.get();
  }

  const current = await storage.get();
  const enabled = current.enabled !== undefined ? current.enabled : DEFAULT_STATE.enabled;
  const stats = {
    bannersBlocked: current.stats?.bannersBlocked || 0,
    videoAdsSkipped: current.stats?.videoAdsSkipped || 0,
    antiAdblockDefused: current.stats?.antiAdblockDefused || 0
  };
  const customRawRulesText = current.customRawRulesText || '';
  const subscriptions = Array.isArray(current.subscriptions) ? current.subscriptions : [];

  const count = typeof message.count === 'number' && message.count > 0 ? message.count : 1;

  switch (message.type) {
    case 'AD_BLOCKED':
      stats.bannersBlocked += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'VIDEO_AD_SKIPPED':
      stats.videoAdsSkipped += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'ANTI_ADBLOCK_DEFUSED':
      stats.antiAdblockDefused += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'RESET_STATS':
      stats.bannersBlocked = 0;
      stats.videoAdsSkipped = 0;
      stats.antiAdblockDefused = 0;
      await storage.set({ stats });
      return { enabled, stats };

    case 'TOGGLE_ENABLED':
      const newEnabled = typeof message.enabled === 'boolean' ? message.enabled : !enabled;
      await storage.set({ enabled: newEnabled });
      return { enabled: newEnabled, stats };

    case 'GET_CUSTOM_DATA':
      return {
        customRawRulesText,
        subscriptions
      };

    case 'SAVE_CUSTOM_RULES':
      const nextRulesText = typeof message.rulesText === 'string' ? message.rulesText : '';
      await storage.set({ customRawRulesText: nextRulesText });
      return { success: true, customRawRulesText: nextRulesText };

    case 'CLEAR_CUSTOM_RULES':
      await storage.set({ customRawRulesText: '' });
      return { success: true, customRawRulesText: '' };

    case 'ADD_SUBSCRIPTION_DATA': {
      const url = (message.url || '').trim();
      if (!url) return { success: false, error: 'URL is required' };

      const rawText = message.rawText || '';
      const parsed = parseBlocklist(rawText);
      const subName = parsed.title || message.name || url.split('/').pop().split('?')[0] || 'Blocklist';

      const subs = [...subscriptions];
      const existingIdx = subs.findIndex((s) => s.url === url || s.id === url);
      const subData = {
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
        subs[existingIdx] = subData;
      } else {
        subs.push(subData);
      }

      await storage.set({ subscriptions: subs });
      return { success: true, subscription: subData, subscriptions: subs };
    }

    case 'REMOVE_SUBSCRIPTION': {
      const targetUrl = message.url || message.id;
      const updatedSubs = subscriptions.filter((s) => s.url !== targetUrl && s.id !== targetUrl);
      await storage.set({ subscriptions: updatedSubs });
      return { success: true, subscriptions: updatedSubs };
    }

    case 'GET_STATE':
    default:
      return { enabled, stats, customRawRulesText, subscriptions };
  }
}

const storageAdapter = {
  async get(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys || null, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  },
  async set(items) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(items, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }
};

async function updateBadge(state) {
  if (!chrome.action) return;

  try {
    if (!state || !state.enabled) {
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
  } catch (err) {}
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
 * Robustly updates dynamic DNR rules with automatic fallback and filtering of malformed rules.
 * @param {Array<object>} rulesToAdd
 */
async function safeUpdateDynamicRules(rulesToAdd) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  let currentRules = Array.isArray(rulesToAdd)
    ? rulesToAdd.filter((r) => isValidDnrUrlFilter(r?.condition?.urlFilter))
    : [];

  let removeRuleIds = [];
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    removeRuleIds = existing.map((r) => r.id);
  } catch (e) {}

  // Attempt update with automatic extraction and removal of any rule rejected by Chrome
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: currentRules
      });
      return; // Cleanly succeeded!
    } catch (err) {
      const errMsg = String(err && err.message ? err.message : err);
      const match = errMsg.match(/Rule with id (\d+)/i);
      if (match && match[1]) {
        const badId = parseInt(match[1], 10);
        console.warn(`SuperShield: Automatically filtered malformed rule ${badId}:`, errMsg);
        currentRules = currentRules.filter((r) => r.id !== badId);
      } else {
        console.warn('SuperShield: Dynamic rule sync note:', errMsg);
        return;
      }
    }
  }
}

/**
 * Synchronizes custom user rules and list subscriptions with DeclarativeNetRequest dynamic rules
 * and cosmetic filters stored in local storage.
 */
async function syncAllRules() {
  if (!chrome.declarativeNetRequest) return;

  try {
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

    // Update dynamic DNR rules in Chromium safely with auto-filtering
    const dnrRules = createDnrRules(combinedNetwork, 10001, 25000);
    await safeUpdateDynamicRules(dnrRules);

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
  } catch (err) {
    console.warn('syncAllRules error:', err);
  }
}

async function initServiceWorker() {
  try {
    const current = await storageAdapter.get();
    if (current.enabled === undefined) {
      await storageAdapter.set(DEFAULT_STATE);
    }
    const isEnabled = current.enabled !== false;
    await syncRuleset(isEnabled);
    await syncAllRules();
    const state = await storageAdapter.get();
    await updateBadge(state);
  } catch (err) {
    console.warn('initServiceWorker error:', err);
  }
}

// Initialize on load/wake-up
initServiceWorker().catch(() => {});

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    initServiceWorker().catch(() => {});
  });
}

if (chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    initServiceWorker().catch(() => {});
  });
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
  if (!message || typeof message !== 'object') {
    sendResponse({});
    return false;
  }

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
