// background/service-worker-logic.js

export const DEFAULT_STATE = {
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
export function isValidDnrUrlFilter(filter) {
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

/**
 * Parses multi-line blocklist text (domains, hosts file syntax, AdBlock filter rules, cosmetic rules).
 * @param {string} text
 * @returns {{ title: string, networkRules: Array<{ urlFilter: string, isAllow: boolean, domainType?: string, resourceTypes?: string[], raw: string }>, cosmeticRules: Array<{ domains: string[], selector: string, raw: string }> }}
 */
export function parseBlocklist(text) {
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

/**
 * Creates DeclarativeNetRequest dynamic rules from parsed network rules.
 * @param {Array<{ urlFilter: string, isAllow: boolean, domainType?: string, resourceTypes?: string[] }>} networkRules
 * @param {number} [startId=10001]
 * @param {number} [maxRules=25000]
 * @returns {Array<object>}
 */
export function createDnrRules(networkRules, startId = 10001, maxRules = 25000) {
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

/**
 * Groups cosmetic rules into domain-specific selectors and global selectors.
 * @param {Array<{ domains: string[], selector: string }>} cosmeticRules
 * @returns {{ domainFilters: Record<string, string[]>, globalFilters: string[] }}
 */
export function extractCosmeticFilters(cosmeticRules) {
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

export async function handleMessage(message, storage) {
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
