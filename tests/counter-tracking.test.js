// tests/counter-tracking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('manifest.json includes declarativeNetRequestFeedback permission for counting network blocks', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.ok(
    manifest.permissions.includes('declarativeNetRequestFeedback'),
    'manifest.json must include declarativeNetRequestFeedback permission'
  );
});

test('service-worker.js sets displayActionCountAsBadgeText for browser-managed badge counts', () => {
  const swCode = fs.readFileSync('background/service-worker.js', 'utf8');
  assert.ok(
    swCode.includes('displayActionCountAsBadgeText'),
    'service-worker.js must enable displayActionCountAsBadgeText'
  );
});

test('popup.js queries declarativeNetRequest.getMatchedRules to show real-time network ad blocks', () => {
  const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
  assert.ok(
    popupJs.includes('getMatchedRules'),
    'popup.js must call chrome.declarativeNetRequest.getMatchedRules'
  );
});

test('popup.js initializes and combines DNR matched rules with stored stats', async () => {
  const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
  const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
  const dom = new JSDOM(popupHtml, { runScripts: "dangerously" });

  let savedStorage = {
    enabled: true,
    stats: { bannersBlocked: 5, videoAdsSkipped: 2, antiAdblockDefused: 1 }
  };

  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(savedStorage),
        set: (items, cb) => {
          Object.assign(savedStorage, items);
          if (cb) cb();
        }
      },
      onChanged: { addListener: () => {} }
    },
    tabs: {
      query: (opts, cb) => cb([{ id: 101, url: 'https://adblock.turtlecute.org/' }])
    },
    declarativeNetRequest: {
      getMatchedRules: (opts) => {
        // Mock 129 rules matched on Turtlecute
        return Promise.resolve({
          rulesMatchedInfo: Array(129).fill({ rule: { ruleId: 1, rulesetId: 'ad_rules' } })
        });
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve()
    }
  };

  dom.window.eval(popupJs);

  // Allow async tasks in popup to settle
  await new Promise(r => setTimeout(r, 50));

  const bannersCount = dom.window.document.getElementById('banners-count').textContent;
  assert.equal(bannersCount, '129', 'Popup should display DNR matched count from turtlecute benchmark');

  dom.window.close();
});

test('video-blocker counts video ads intercepted even when skip button is not clicked', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="movie_player" class="html5-video-player ad-showing">
          <video></video>
        </div>
      </body>
    </html>`, { runScripts: 'dangerously' });

  let sentMessages = [];
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ enabled: true }),
        set: () => {}
      },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        return Promise.resolve();
      }
    }
  };

  const video = dom.window.document.querySelector('video');
  Object.defineProperty(video, 'duration', { value: 15, configurable: true, writable: true });

  dom.window.eval(videoBlockerCode);

  assert.ok(
    sentMessages.some(m => m.type === 'VIDEO_AD_SKIPPED'),
    'VIDEO_AD_SKIPPED message should be sent when ad-showing is active'
  );

  dom.window.close();
});
