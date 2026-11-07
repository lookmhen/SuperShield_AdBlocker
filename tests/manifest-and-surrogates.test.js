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

test('production dist packaging contains only clean runtime files without development clutter', () => {
  // Ensure dist is built
  if (!fs.existsSync('dist/manifest.json')) {
    import('../scripts/build-dist.js');
  }

  assert.ok(fs.existsSync('dist/manifest.json'), 'dist/manifest.json must exist');
  assert.ok(fs.existsSync('dist/background/service-worker.js'), 'dist background worker must exist');
  assert.ok(fs.existsSync('dist/popup/popup.html'), 'dist popup html must exist');
  assert.ok(fs.existsSync('dist/rules/ad-rules.json'), 'dist rules must exist');
  assert.ok(fs.existsSync('dist/icons/icon48.png'), 'dist icons must exist');

  // Verify development files are excluded from dist
  assert.equal(fs.existsSync('dist/tests'), false, 'tests/ must be excluded from dist');
  assert.equal(fs.existsSync('dist/node_modules'), false, 'node_modules/ must be excluded from dist');
  assert.equal(fs.existsSync('dist/package.json'), false, 'package.json must be excluded from dist');
  assert.equal(fs.existsSync('dist/icons/generate-icons.js'), false, 'development scripts must be excluded from dist icons');
});
