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

test('forcePlayVideos fast-forwards ad video, clicks skip and custom_play_btn, and does NOT force-play or unmute ad', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="player_content" style="display: block;">
          <div id="a4s" class="jwplayer jw-reset jw-state-playing">
            <div class="jw-media jw-reset">
              <video class="jw-video jw-reset" src="https://flswa.watermelogic.com/assets/we356.mp4"></video>
            </div>
            <div class="afs_ads ad-placement" style="width: 1px; height: 1px;">&nbsp;</div>
          </div>
          <button id="custom_play_btn" aria-label="Play content" class="v0x">Play</button>
          <div class="loading-indicator" id="loading_ind">กำลังโหลด...</div>
          <button id="skip_btn" style="display: block; cursor: pointer;">ข้ามโฆษณา</button>
          <button id="register_btn" style="display: block;">สมัครสมาชิก กด!</button>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.querySelector('video');
  Object.defineProperty(video, 'duration', { value: 30, configurable: true, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;

  let adVideoPlayCalled = false;
  video.play = () => {
    adVideoPlayCalled = true;
    return Promise.resolve();
  };

  let skipClicked = false;
  dom.window.document.getElementById('skip_btn').addEventListener('click', () => {
    skipClicked = true;
  });

  let customPlayClicked = false;
  dom.window.document.getElementById('custom_play_btn').addEventListener('click', () => {
    customPlayClicked = true;
  });

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'Force play must report unlocked');
  assert.equal(adVideoPlayCalled, false, 'Ad video must NOT be force played');
  assert.equal(video.playbackRate, 16, 'Ad video must be fast-forwarded to 16x');
  assert.equal(video.muted, true, 'Ad video must be muted');
  assert.equal(video.currentTime, 30, 'Ad video currentTime must be fast forwarded to end');
  assert.equal(skipClicked, true, 'Skip button must be triggered');
  assert.equal(customPlayClicked, true, 'Custom play button must be triggered');

  dom.window.close();
});

test('forcePlayVideos unlocks and plays the final content video with afs_ads in player', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="player_content" style="display: block;">
          <div id="a4s" class="jwplayer jw-reset jw-state-idle">
            <div class="jw-media jw-reset">
              <video class="jw-video jw-reset" src="https://stream.provider.com/movie/master.m3u8"></video>
            </div>
            <div class="afs_ads ad-placement" style="width: 1px; height: 1px;">&nbsp;</div>
          </div>
          <button id="custom_play_btn" aria-label="Play content" class="v0x">Play</button>
          <div class="loading-indicator" id="loading_ind" style="display:none;">กำลังโหลด...</div>
          <button id="skip_btn" style="display: none;">ข้ามโฆษณา</button>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.querySelector('video');
  Object.defineProperty(video, 'duration', { value: 7200, configurable: true, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = true;

  let playCalled = false;
  video.play = () => {
    playCalled = true;
    return Promise.resolve();
  };

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'Force play must report unlocked');
  assert.equal(playCalled, true, 'Final content video.play() must be called');
  assert.equal(video.playbackRate, 1, 'Final content video must have 1.0 playback rate');
  assert.equal(video.muted, false, 'Final content video must be unmuted');
  assert.equal(video.currentTime, 0, 'Final content video currentTime must remain at start');

  dom.window.close();
});
