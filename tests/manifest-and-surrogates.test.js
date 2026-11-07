// tests/manifest-and-surrogates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('manifest.json has required Manifest V3 fields and correct structure', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.ok(manifest.version);
  assert.ok(manifest.permissions.includes('declarativeNetRequest'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.declarative_net_request.rule_resources.length > 0);
  assert.ok(manifest.web_accessible_resources.length > 0);
});

test('surrogate scripts define required mock structures without error', () => {
  const adsbygoogleCode = fs.readFileSync('surrogates/adsbygoogle.js', 'utf8');
  assert.ok(adsbygoogleCode.includes('window.adsbygoogle'));
  assert.ok(adsbygoogleCode.includes('push'));
  
  const prebidCode = fs.readFileSync('surrogates/prebid.js', 'utf8');
  assert.ok(prebidCode.includes('pbjs'));
});
