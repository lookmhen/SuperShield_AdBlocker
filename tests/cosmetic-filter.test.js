// tests/cosmetic-filter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('cosmetic-filter intercepts suspicious popunder links on video containers', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-player-container">
          <video id="player"></video>
          <a id="fake-overlay" href="https://malicious-tracker.ad/click" target="_blank" style="position:absolute; width:100%; height:100%"></a>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.eval(cosmeticFilterCode);
  
  const link = dom.window.document.getElementById('fake-overlay');
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  
  // The script should intercept and disarm the click
  assert.equal(event.defaultPrevented, true);
});

test('cosmetic.css contains valid hiding rules for common ad banners', () => {
  const css = fs.readFileSync('content-scripts/cosmetic.css', 'utf8');
  assert.ok(css.includes('display: none !important'));
  assert.ok(css.includes('.ad-banner') || css.includes('[id^="google_ads"]'));
});
