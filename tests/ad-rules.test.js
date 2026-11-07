// tests/ad-rules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('rules/ad-rules.json contains valid declarativeNetRequest rules', () => {
  const rules = JSON.parse(fs.readFileSync('rules/ad-rules.json', 'utf8'));
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length >= 20, 'Expected at least 20 curated ad rules');
  
  const ids = new Set();
  let hasRedirect = false;
  let hasBlock = false;

  for (const rule of rules) {
    assert.ok(typeof rule.id === 'number', 'Rule id must be a number');
    assert.ok(!ids.has(rule.id), `Duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.condition && typeof rule.condition === 'object');
    assert.ok(rule.action && typeof rule.action === 'object');

    if (rule.action.type === 'redirect') {
      hasRedirect = true;
      assert.ok(rule.action.redirect && rule.action.redirect.extensionPath);
    }
    if (rule.action.type === 'block') {
      hasBlock = true;
    }
  }

  assert.ok(hasBlock, 'Must contain block action rules');
  assert.ok(hasRedirect, 'Must contain redirect surrogate rules');
});
