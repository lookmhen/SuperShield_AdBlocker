// tests/custom-blocklists.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlocklist,
  createDnrRules,
  extractCosmeticFilters,
  handleMessage
} from '../background/service-worker-logic.js';

function createMockStorage(initial = {}) {
  const store = {
    enabled: true,
    stats: { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 },
    customRawRulesText: '',
    subscriptions: [],
    ...initial
  };

  return {
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        const res = {};
        for (const k of keys) res[k] = store[k];
        return res;
      }
      return { ...store };
    },
    async set(items) {
      Object.assign(store, items);
    }
  };
}

test('parseBlocklist parses multi-line text with domains, hosts, and AdBlock syntax', () => {
  const input = [
    '! Title: Test Community Blocklist',
    '! Description: A blocklist for testing',
    '[Adblock Plus 2.0]',
    '# Comment line',
    'plain-domain.com',
    '*.wildcard-domain.org',
    '0.0.0.0 hosts-badsite.com',
    '127.0.0.1 tracker.ad',
    '::1 ipv6-tracker.com',
    '0.0.0.0 localhost',
    '127.0.0.1 127.0.0.1',
    '||custom-network.com/banner.gif',
    '@@||whitelisted-domain.com^',
    'script-tracker.net$script,third-party',
    'bad-filter-item.com$badfilter',
    'movie-stream.com##.header-banner',
    'domain-a.com,domain-b.com##div.floating-ad',
    '##.universal-popup-trap',
    'plain-domain.com' // Duplicate should be discarded
  ].join('\n');

  const parsed = parseBlocklist(input);

  assert.equal(parsed.title, 'Test Community Blocklist');

  // Verify network rules
  const networkFilters = parsed.networkRules.map((r) => r.urlFilter);
  assert.ok(networkFilters.includes('||plain-domain.com^'));
  assert.ok(networkFilters.includes('||wildcard-domain.org^'));
  assert.ok(networkFilters.includes('||hosts-badsite.com^'));
  assert.ok(networkFilters.includes('||tracker.ad^'));
  assert.ok(networkFilters.includes('||ipv6-tracker.com^'));
  assert.ok(networkFilters.includes('||custom-network.com/banner.gif'));
  assert.ok(networkFilters.includes('||whitelisted-domain.com^'));
  assert.ok(networkFilters.includes('||script-tracker.net^'));

  // Discarded checks
  assert.equal(networkFilters.includes('||bad-filter-item.com^'), false, '$badfilter should be ignored');
  assert.equal(networkFilters.includes('||localhost^'), false, 'localhost should be ignored');

  // Allow rule check
  const allowRule = parsed.networkRules.find((r) => r.urlFilter === '||whitelisted-domain.com^');
  assert.ok(allowRule);
  assert.equal(allowRule.isAllow, true);

  // Options check
  const optionRule = parsed.networkRules.find((r) => r.urlFilter === '||script-tracker.net^');
  assert.ok(optionRule);
  assert.equal(optionRule.domainType, 'thirdParty');
  assert.deepEqual(optionRule.resourceTypes, ['script']);

  // Cosmetic rules check
  assert.equal(parsed.cosmeticRules.length, 3);
  assert.deepEqual(parsed.cosmeticRules[0], {
    domains: ['movie-stream.com'],
    selector: '.header-banner',
    raw: 'movie-stream.com##.header-banner'
  });
  assert.deepEqual(parsed.cosmeticRules[1], {
    domains: ['domain-a.com', 'domain-b.com'],
    selector: 'div.floating-ad',
    raw: 'domain-a.com,domain-b.com##div.floating-ad'
  });
  assert.deepEqual(parsed.cosmeticRules[2], {
    domains: [],
    selector: '.universal-popup-trap',
    raw: '##.universal-popup-trap'
  });
});

test('createDnrRules converts parsed rules into valid DeclarativeNetRequest dynamic rules', () => {
  const networkRules = [
    { urlFilter: '||bad-domain.com^', isAllow: false },
    { urlFilter: '||safe-domain.com^', isAllow: true },
    { urlFilter: '||tracker.com^', isAllow: false, domainType: 'thirdParty', resourceTypes: ['script', 'xmlhttprequest'] }
  ];

  const dnrRules = createDnrRules(networkRules, 10001);

  assert.equal(dnrRules.length, 3);

  // Rule 1: Standard block
  assert.equal(dnrRules[0].id, 10001);
  assert.equal(dnrRules[0].priority, 1);
  assert.equal(dnrRules[0].action.type, 'block');
  assert.equal(dnrRules[0].condition.urlFilter, '||bad-domain.com^');
  assert.ok(dnrRules[0].condition.resourceTypes.includes('script'));
  assert.ok(dnrRules[0].condition.resourceTypes.includes('image'));

  // Rule 2: Allowlist rule has priority 2
  assert.equal(dnrRules[1].id, 10002);
  assert.equal(dnrRules[1].priority, 2);
  assert.equal(dnrRules[1].action.type, 'allow');
  assert.equal(dnrRules[1].condition.urlFilter, '||safe-domain.com^');

  // Rule 3: Third-party scoped rule
  assert.equal(dnrRules[2].id, 10003);
  assert.equal(dnrRules[2].priority, 1);
  assert.equal(dnrRules[2].condition.domainType, 'thirdParty');
  assert.deepEqual(dnrRules[2].condition.resourceTypes, ['script', 'xmlhttprequest']);
});

test('extractCosmeticFilters properly splits domain-specific and global selectors', () => {
  const cosmeticRules = [
    { domains: ['example.com'], selector: '.ad-slot' },
    { domains: ['example.com'], selector: '#top-banner' },
    { domains: ['other.org'], selector: '.sponsored-post' },
    { domains: [], selector: '.global-sticky-ad' }
  ];

  const { domainFilters, globalFilters } = extractCosmeticFilters(cosmeticRules);

  assert.deepEqual(domainFilters['example.com'], ['.ad-slot', '#top-banner']);
  assert.deepEqual(domainFilters['other.org'], ['.sponsored-post']);
  assert.deepEqual(globalFilters, ['.global-sticky-ad']);
});

test('handleMessage saves and retrieves custom rules and subscription data', async () => {
  const storage = createMockStorage();

  // 1. Save custom rules
  const saveRes = await handleMessage(
    {
      type: 'SAVE_CUSTOM_RULES',
      rulesText: 'badsite1.com\n0.0.0.0 badsite2.com\nmovie.com##.banner'
    },
    storage
  );
  assert.equal(saveRes.success, true);

  // 2. Add subscription data
  const subRes = await handleMessage(
    {
      type: 'ADD_SUBSCRIPTION_DATA',
      url: 'https://example.com/adlist.txt',
      rawText: '! Title: Example List\n||adserver.org^\nsite.com##.popup'
    },
    storage
  );
  assert.equal(subRes.success, true);
  assert.equal(subRes.subscription.name, 'Example List');
  assert.equal(subRes.subscription.networkRulesCount, 1);
  assert.equal(subRes.subscription.cosmeticRulesCount, 1);

  // 3. Get custom data
  const dataRes = await handleMessage({ type: 'GET_CUSTOM_DATA' }, storage);
  assert.ok(dataRes.customRawRulesText.includes('badsite1.com'));
  assert.equal(dataRes.subscriptions.length, 1);
  assert.equal(dataRes.subscriptions[0].url, 'https://example.com/adlist.txt');

  // 4. Remove subscription
  const remRes = await handleMessage(
    {
      type: 'REMOVE_SUBSCRIPTION',
      url: 'https://example.com/adlist.txt'
    },
    storage
  );
  assert.equal(remRes.success, true);
  assert.equal(remRes.subscriptions.length, 0);

  // 5. Clear custom rules
  const clearRes = await handleMessage({ type: 'CLEAR_CUSTOM_RULES' }, storage);
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.customRawRulesText, '');
});

test('parseBlocklist parses real-world Thai adblock list correctly', () => {
  const sampleThaiList = [
    '[Adblock Plus 3.18]',
    '! Version: 1.3-09032025',
    '! Title: THAIADBLOCK LISTS',
    '! Last modified: 09-03-2025',
    '! Expires: 1 day (update frequency)',
    '! Homepage: https://github.com/PhyschicWinter9/thai-adblock-list',
    '!',
    '||037hdmovie.com/wp-content/uploads/2025/02/banner-037hdmoviez.gif',
    '||037hdmovie.com/wp-content/uploads/2025/02/DEMON-728x180-1.gif',
    '||037hdmovie.com/wp-content/uploads/2025/01/188BET-728x180-1.gif',
    '||037hdmovie.com/wp-content/uploads/2025/01/Godzilla882-728x180-1.gif',
    '||image.cdend.com/wp-content/uploads/2024/03/120x380-Juad888.gif',
    'movie44.com##.full',
    'doomovie-hd.vip##.header-banana_big_tall',
    'doomovie-hd.vip##div[style="width:120px; height:380px; cursor:pointer; background-size: contain;"]'
  ].join('\n');

  const parsed = parseBlocklist(sampleThaiList);

  assert.equal(parsed.title, 'THAIADBLOCK LISTS');
  assert.equal(parsed.networkRules.length, 5);
  assert.equal(parsed.cosmeticRules.length, 3);

  const dnrRules = createDnrRules(parsed.networkRules, 10001);
  assert.equal(dnrRules.length, 5);
  assert.equal(dnrRules[0].condition.urlFilter, '||037hdmovie.com/wp-content/uploads/2025/02/banner-037hdmoviez.gif');

  const { domainFilters } = extractCosmeticFilters(parsed.cosmeticRules);
  assert.deepEqual(domainFilters['movie44.com'], ['.full']);
  assert.ok(domainFilters['doomovie-hd.vip'].includes('.header-banana_big_tall'));
});
