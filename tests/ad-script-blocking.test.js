// tests/ad-script-blocking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('ad-rules.json contains blocking rules that match /js/pagead.js and /js/widget/ads.js', () => {
  const rules = JSON.parse(fs.readFileSync('rules/ad-rules.json', 'utf8'));

  const matchesPagead = rules.some(r => {
    const filter = r.condition?.urlFilter || '';
    return (filter.includes('pagead.js') && filter.startsWith('*')) || filter === '*pagead.js*';
  });

  const matchesWidgetAds = rules.some(r => {
    const filter = r.condition?.urlFilter || '';
    return filter.includes('widget/ads') || filter.includes('widget/ads.');
  });

  assert.ok(matchesPagead, 'Must contain wildcard rule for *pagead.js* to catch /js/pagead.js');
  assert.ok(matchesWidgetAds, 'Must contain rule for widget/ads to catch /js/widget/ads.js');
});
