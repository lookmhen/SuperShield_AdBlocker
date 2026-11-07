// tests/universal-player-support.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('forcePlayVideos handles Video.js and clicks .vjs-big-play-button', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-js vjs-paused vjs-fluid">
          <video id="vjs-player"></video>
          <button class="vjs-big-play-button" aria-label="Play Video"></button>
          <div class="ad-overlay" style="position: absolute; width:100%; height:100%;"></div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let btnClicked = false;
  const btn = dom.window.document.querySelector('.vjs-big-play-button');
  btn.onclick = () => { btnClicked = true; };
  Object.defineProperty(btn, 'click', { value: () => { btnClicked = true; }, configurable: true });

  const video = dom.window.document.querySelector('video');
  video.play = () => Promise.resolve();

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'Video.js player must be unlocked');
  assert.equal(btnClicked, true, 'Video.js big play button must be triggered');
  assert.equal(dom.window.document.querySelector('.ad-overlay'), null, 'Ad overlay must be removed');

  dom.window.close();
});

test('forcePlayVideos handles JW Player and removes .jw-flag-ads overlay', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="jwplayer jw-reset jw-state-idle">
          <div class="jw-media">
            <video id="jw-video"></video>
          </div>
          <div class="jw-display-icon-container jw-display-icon-display">
            <div class="jw-icon jw-icon-display"></div>
          </div>
          <div class="jw-overlays jw-flag-ads" style="position: absolute; top:0; left:0; width:100%; height:100%;">
            <a href="https://1xbet.com" target="_blank" style="display:block; width:100%; height:100%;"></a>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let jwBtnClicked = false;
  const jwBtn = dom.window.document.querySelector('.jw-display-icon-container');
  jwBtn.onclick = () => { jwBtnClicked = true; };
  Object.defineProperty(jwBtn, 'click', { value: () => { jwBtnClicked = true; }, configurable: true });

  const video = dom.window.document.querySelector('video');
  video.play = () => Promise.resolve();

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'JW Player must be unlocked');
  assert.equal(jwBtnClicked, true, 'JW Player play button must be triggered');
  assert.equal(dom.window.document.querySelector('.jw-flag-ads'), null, 'JW ads overlay must be stripped');

  dom.window.close();
});

test('forcePlayVideos unlocks iframe player on parent page and strips click-trap overlay', () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="player-wrapper" style="position: relative; width: 800px; height: 450px;">
          <iframe id="stream-frame" src="https://streamprovider.com/embed/12345" style="width:100%; height:100%;"></iframe>
          <div id="click-trap" class="transparent-click-catcher" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index:999999;">
            <a href="https://cutt.ly/1xbetgoal" target="_blank"></a>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  assert.equal(result.unlocked, true, 'Iframe player must be recognized and unlocked');
  assert.equal(dom.window.document.getElementById('click-trap'), null, 'Click trap covering iframe must be removed');
  const iframe = dom.window.document.getElementById('stream-frame');
  assert.equal(iframe.style.pointerEvents, 'auto', 'Iframe pointer-events must be auto');

  dom.window.close();
});

test('forcePlayVideos falls back to muted play if browser autoplay policy blocks unmuted play', async () => {
  const pickerCode = fs.readFileSync('content-scripts/picker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container">
          <video id="strict-video"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('strict-video');
  let mutedCalled = false;
  video.play = () => {
    if (!video.muted) {
      // Simulate Chrome autoplay policy rejection
      return Promise.reject(new Error('NotAllowedError: play() failed'));
    }
    mutedCalled = true;
    return Promise.resolve();
  };

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(pickerCode);
  const result = dom.window.forcePlayVideos();

  await new Promise(r => setTimeout(r, 20));

  assert.equal(result.unlocked, true, 'Should report unlocked on muted fallback');
  assert.equal(mutedCalled, true, 'Should fallback to muted play when unmuted play is rejected');

  dom.window.close();
});

test('cosmetic-filter disarms fake play click on top of an IFRAME video player', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-player-box" style="position: relative;">
          <iframe id="movie-embed" src="https://embed.stream/v/999" style="width:640px; height:360px;"></iframe>
          <div id="iframe-fake-play" class="fake-play-btn" style="position: absolute; top:0; left:0; width:100%; height:100%;">
            <span>Play Video</span>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  let popupOpened = false;
  dom.window.open = () => { popupOpened = true; return null; };

  dom.window.chrome = {
    storage: { local: { get: (k, cb) => cb({ enabled: true }), set: () => {} } },
    runtime: { sendMessage: () => Promise.resolve() }
  };

  dom.window.eval(cosmeticFilterCode);

  const fakeOverlay = dom.window.document.getElementById('iframe-fake-play');
  fakeOverlay.addEventListener('click', () => {
    dom.window.open('https://popads.net/track');
  });

  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  fakeOverlay.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true, 'Click on fake play overlay over iframe must be prevented');
  assert.equal(popupOpened, false, 'Ad popup must NOT open');
  assert.equal(dom.window.document.getElementById('iframe-fake-play'), null, 'Fake overlay must be removed from DOM');

  dom.window.close();
});
