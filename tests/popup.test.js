// tests/popup.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('popup initializes with stored metrics and handles toggle switch', () => {
  const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
  const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
  const dom = new JSDOM(popupHtml, { runScripts: "dangerously" });
  
  // Provide mock chrome.storage
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({
          enabled: true,
          stats: { bannersBlocked: 42, videoAdsSkipped: 12, antiAdblockDefused: 5 }
        }),
        set: (items, cb) => { if (cb) cb(); }
      }
    },
    runtime: {
      sendMessage: (msg, cb) => {
        if (msg.type === 'TOGGLE_ENABLED') {
          if (cb) cb({ enabled: msg.enabled, stats: { bannersBlocked: 42, videoAdsSkipped: 12, antiAdblockDefused: 5 } });
        }
      }
    }
  };

  dom.window.eval(popupJs);

  assert.equal(dom.window.document.getElementById('banners-count').textContent, '42');
  assert.equal(dom.window.document.getElementById('videos-count').textContent, '12');
  assert.equal(dom.window.document.getElementById('defused-count').textContent, '5');
  assert.equal(dom.window.document.getElementById('toggle-switch').checked, true);
  dom.window.close();
});
