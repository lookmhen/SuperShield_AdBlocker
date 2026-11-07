// tests/element-picker-and-force-play.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('forcePlayVideos strips overlays covering the video and calls video.play()', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="player-container" style="position: relative; width: 640px; height: 360px;">
          <video id="test-video"></video>
          <div id="rogue-overlay" class="fake-play-wrapper" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index:99999;">
            <button class="fake-play">Play</button>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('test-video');
  let played = false;
  video.play = () => { played = true; return Promise.resolve(); };

  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ customFilters: {} }),
        set: () => {}
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve()
    }
  };

  dom.window.eval(pickerCode);

  // Trigger FORCE_PLAY_VIDEO
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'Should report video unlocked');
  assert.equal(played, true, 'Real video.play() must be called');
  assert.equal(dom.window.document.getElementById('rogue-overlay'), null, 'Rogue overlay must be removed from DOM');

  dom.window.close();
});

test('element picker generates valid selector and stores custom filter', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="annoying-banner" class="banner-box promo-popup">
          <img src="/ad.jpg">
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let savedStorage = {};
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(savedStorage),
        set: (items, cb) => {
          Object.assign(savedStorage, items);
          if (cb) cb();
        }
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve()
    }
  };

  dom.window.eval(pickerCode);

  const banner = dom.window.document.getElementById('annoying-banner');
  const selector = dom.window.generateSelector(banner);

  assert.ok(selector, 'Selector must not be empty');
  const queried = dom.window.document.querySelector(selector);
  assert.equal(queried, banner, 'Generated selector must accurately match target element');

  // Block and save element
  dom.window.blockAndSaveElement(banner);

  assert.equal(banner.style.display, 'none', 'Element must be hidden immediately');
  const currentHostname = dom.window.location.hostname || 'localhost';
  assert.ok(savedStorage.customFilters, 'Custom filters must be saved to storage');
  assert.ok(savedStorage.customFilters[currentHostname]?.includes(selector), 'Saved filters must contain the selector');

  dom.window.close();
});

test('custom filters are automatically loaded and applied on startup', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="custom-target-ad" class="custom-ad-cls">Ad text</div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const currentHostname = dom.window.location.hostname || 'localhost';
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({
          customFilters: {
            [currentHostname]: ['#custom-target-ad']
          }
        }),
        set: () => {}
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve()
    }
  };

  dom.window.eval(pickerCode);

  const ad = dom.window.document.getElementById('custom-target-ad');
  assert.equal(ad.style.display, 'none', 'Custom filter from storage must be applied on load');

  dom.window.close();
});
