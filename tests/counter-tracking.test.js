// tests/counter-tracking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { handleMessage, DEFAULT_STATE } from '../background/service-worker-logic.js';

test('manifest.json includes declarativeNetRequestFeedback permission for counting network blocks', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.ok(
    manifest.permissions.includes('declarativeNetRequestFeedback'),
    'manifest.json must include declarativeNetRequestFeedback permission'
  );
});

test('service-worker.js listens to onRuleMatchedDebug to count blocked network ad requests', () => {
  const swCode = fs.readFileSync('background/service-worker.js', 'utf8');
  assert.ok(
    swCode.includes('onRuleMatchedDebug'),
    'service-worker.js must register an onRuleMatchedDebug listener'
  );
});

test('popup.js listens to storage onChanged to keep counters synchronized live', () => {
  const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
  assert.ok(
    popupJs.includes('chrome.storage.onChanged.addListener') || popupJs.includes('storage.onChanged'),
    'popup.js must listen to chrome.storage.onChanged'
  );
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
