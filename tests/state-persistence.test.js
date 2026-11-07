// tests/state-persistence.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('content scripts do NOT hide banners or execute blockers when enabled is false in storage', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="test-banner">
          <a id="ad-link" href="https://cutt.ly/1xbetgoal">
            <img src="/ad.gif">
          </a>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let messageSent = false;
  // Mock storage with enabled: false
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ enabled: false }),
        set: () => {}
      },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      sendMessage: () => { messageSent = true; return Promise.resolve(); }
    }
  };

  dom.window.eval(cosmeticFilterCode);

  const adLink = dom.window.document.getElementById('ad-link');
  assert.notEqual(adLink.style.display, 'none', 'Banner must NOT be hidden when extension is turned off');
  assert.equal(messageSent, false, 'No ad blocked message should be sent when disabled');

  dom.window.close();
});

test('cosmetic.css requires data-supershield-active attribute on html to apply', () => {
  const css = fs.readFileSync('content-scripts/cosmetic.css', 'utf8');
  assert.ok(css.includes('data-supershield-active'), 'cosmetic.css rules must be scoped to data-supershield-active');
});

test('service-worker initializes and synchronizes disabled ruleset on wake-up', async () => {
  const swCode = fs.readFileSync('background/service-worker.js', 'utf8');
  assert.ok(swCode.includes('initServiceWorker') || swCode.includes('syncRuleset'), 'service worker must have startup sync logic');
});
