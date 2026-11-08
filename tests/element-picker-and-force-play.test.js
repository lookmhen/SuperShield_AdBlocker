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

test('element picker allows continuous multi-element blocking without exiting until Escape is pressed', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="ad-one" class="ad-item">Ad 1</div>
        <div id="ad-two" class="ad-item">Ad 2</div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let savedStorage = {};
  dom.window.chrome = {
    storage: {
      local: {
        get: (k, cb) => cb(savedStorage),
        set: (items, cb) => {
          Object.assign(savedStorage, items);
          if (cb) cb();
        }
      }
    },
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => {} }
    }
  };

  dom.window.eval(pickerCode);

  dom.window.startElementPicker();
  let banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.ok(banner, 'Picker banner must be present initially');

  const ad1 = dom.window.document.getElementById('ad-one');
  const ad2 = dom.window.document.getElementById('ad-two');

  // Click first element
  ad1.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ad1.style.display, 'none', 'First element must be hidden');

  // Verify picker is STILL ACTIVE
  banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.ok(banner, 'Picker must remain active after blocking the first element');
  assert.ok(banner.textContent.includes('1 blocked'), 'Banner must reflect blocked element count');

  // Click second element continuously
  ad2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ad2.style.display, 'none', 'Second element must be hidden');

  // Verify picker is STILL ACTIVE after second block
  banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.ok(banner, 'Picker must remain active after blocking the second element');
  assert.ok(banner.textContent.includes('2 blocked'), 'Banner must reflect updated blocked count');

  // Now press Escape to exit
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.equal(banner, null, 'Picker banner must be removed when ESC is pressed');

  dom.window.close();
});

test('element picker cancels and removes UI banner when Escape key is pressed', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="target">Content</div></body></html>', { runScripts: "dangerously" });

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {} } }
  };

  dom.window.eval(pickerCode);

  dom.window.startElementPicker();
  let banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.ok(banner, 'Picker banner must be present after starting picker');

  // Trigger Escape keydown on window
  const escEvent = new dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true });
  dom.window.dispatchEvent(escEvent);

  banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.equal(banner, null, 'Picker banner must be removed when ESC is pressed');

  dom.window.close();
});

test('element picker cancels and removes UI banner when clicking Exit button', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="target">Content</div></body></html>', { runScripts: "dangerously" });

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {} } }
  };

  dom.window.eval(pickerCode);

  dom.window.startElementPicker();
  let banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.ok(banner, 'Picker banner must be present');

  const cancelBtn = dom.window.document.getElementById('supershield-cancel-picker');
  assert.ok(cancelBtn, 'Cancel Exit button must exist');

  // Simulate click on Exit button
  const clickEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  cancelBtn.dispatchEvent(clickEvent);

  banner = dom.window.document.getElementById('supershield-picker-banner');
  assert.equal(banner, null, 'Picker banner must be removed when Exit button is clicked');

  dom.window.close();
});

test('element picker does NOT spawn banners inside child iframes', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body><iframe></iframe></body></html>', { runScripts: "dangerously" });

  const iframe = dom.window.document.querySelector('iframe');
  const iframeWin = iframe.contentWindow;

  iframeWin.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {} } }
  };

  iframeWin.eval(pickerCode);
  iframeWin.startElementPicker();

  const banner = iframeWin.document.getElementById('supershield-picker-banner');
  assert.equal(banner, null, 'Picker banner must NOT be created in iframe');

  dom.window.close();
});
