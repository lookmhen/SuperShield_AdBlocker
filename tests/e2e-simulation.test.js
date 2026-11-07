// tests/e2e-simulation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('verify complete project structure for Chrome extension unpack loading', () => {
  const requiredFiles = [
    'manifest.json',
    'rules/ad-rules.json',
    'surrogates/adsbygoogle.js',
    'surrogates/prebid.js',
    'content-scripts/defuser-main.js',
    'content-scripts/defuser-isolated.js',
    'content-scripts/cosmetic-filter.js',
    'content-scripts/cosmetic.css',
    'content-scripts/video-blocker.js',
    'background/service-worker.js',
    'background/service-worker-logic.js',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png'
  ];

  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(file), `Missing required extension file: ${file}`);
  }
});

test('manifest content_scripts and rules match existing files', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  // Verify background script
  assert.ok(fs.existsSync(manifest.background.service_worker));

  // Verify declarativeNetRequest rule files
  for (const ruleResource of manifest.declarative_net_request.rule_resources) {
    assert.ok(fs.existsSync(ruleResource.path), `Rule path not found: ${ruleResource.path}`);
  }

  // Verify content scripts
  for (const cs of manifest.content_scripts) {
    if (cs.js) {
      for (const jsFile of cs.js) {
        assert.ok(fs.existsSync(jsFile), `Content script js file not found: ${jsFile}`);
      }
    }
    if (cs.css) {
      for (const cssFile of cs.css) {
        assert.ok(fs.existsSync(cssFile), `Content script css file not found: ${cssFile}`);
      }
    }
  }

  // Verify web accessible resources
  for (const war of manifest.web_accessible_resources) {
    for (const res of war.resources) {
      assert.ok(fs.existsSync(res), `Web accessible resource not found: ${res}`);
    }
  }

  // Verify action popup and icons
  assert.ok(fs.existsSync(manifest.action.default_popup));
  for (const iconSize of Object.keys(manifest.icons)) {
    assert.ok(fs.existsSync(manifest.icons[iconSize]));
  }
});
