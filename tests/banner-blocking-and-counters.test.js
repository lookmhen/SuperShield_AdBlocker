// tests/banner-blocking-and-counters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('cosmetic-filter actively detects and hides affiliate/betting banners like cutt.ly/1xbetgoal', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="banner-wrap-1">
          <a id="ad-link-1" href="https://cutt.ly/1xbetgoal">
            <img src="/banners/ad1.gif" alt="Promo">
          </a>
        </div>
        <div id="banner-wrap-2">
          <a id="ad-link-2" href="https://1xbet.com/affiliate">
            <img src="/banners/ad2.gif">
          </a>
        </div>
        <div id="legit-content">
          <a id="normal-link" href="https://example.com/about">Normal Link</a>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let reportedCount = 0;
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ enabled: true }),
        set: () => {}
      }
    },
    runtime: {
      sendMessage: (msg) => {
        if (msg.type === 'AD_BLOCKED') {
          reportedCount += msg.count;
        }
        return Promise.resolve();
      }
    }
  };

  dom.window.eval(cosmeticFilterCode);

  const adLink1 = dom.window.document.getElementById('ad-link-1');
  const adLink2 = dom.window.document.getElementById('ad-link-2');
  const normalLink = dom.window.document.getElementById('normal-link');

  assert.equal(adLink1.style.display, 'none', 'cutt.ly/1xbet link must be hidden');
  assert.equal(adLink2.style.display, 'none', '1xbet link must be hidden');
  assert.notEqual(normalLink.style.display, 'none', 'Normal link must NOT be hidden');
  assert.ok(reportedCount >= 2, `Expected at least 2 blocked banners reported, got ${reportedCount}`);

  dom.window.close();
});

test('cosmetic.css includes selector rules for betting and ad shortener links', () => {
  const css = fs.readFileSync('content-scripts/cosmetic.css', 'utf8');
  assert.ok(css.includes('cutt.ly') || css.includes('1xbet'), 'cosmetic.css must contain rules for 1xbet/cutt.ly');
});

test('rules/ad-rules.json contains block rules for 1xbet and betting ad networks', () => {
  const rules = JSON.parse(fs.readFileSync('rules/ad-rules.json', 'utf8'));
  const has1xbetRule = rules.some(r => r.condition?.urlFilter?.includes('1xbet'));
  assert.ok(has1xbetRule, 'ad-rules.json must block 1xbet network requests');
});
