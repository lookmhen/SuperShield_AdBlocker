// tests/review-fixes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('cosmetic-filter does not intercept legitimate links containing track or redirect outside video', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="main-content">
          <a id="spotify-link" href="https://open.spotify.com/track/12345">Spotify Track</a>
          <a id="login-link" href="https://example.com/login?redirect=/dashboard">Login</a>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.eval(cosmeticFilterCode);

  const spotifyLink = dom.window.document.getElementById('spotify-link');
  const event1 = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  spotifyLink.dispatchEvent(event1);
  assert.equal(event1.defaultPrevented, false, 'Spotify track link should not be blocked');

  const loginLink = dom.window.document.getElementById('login-link');
  const event2 = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  loginLink.dispatchEvent(event2);
  assert.equal(event2.defaultPrevented, false, 'Login redirect link should not be blocked');

  dom.window.close();
});

test('video-blocker restores playbackRate to 1 and muted to false when ad finishes', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="movie_player" class="html5-video-player ad-showing">
          <video id="yt-video"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const player = dom.window.document.getElementById('movie_player');
  const video = dom.window.document.getElementById('yt-video');
  Object.defineProperty(video, 'duration', { value: 30, configurable: true, writable: true });
  video.playbackRate = 1;
  video.muted = false;

  dom.window.eval(videoBlockerCode);

  // While ad is showing: 16x and muted
  assert.equal(video.playbackRate, 16);
  assert.equal(video.muted, true);

  // Ad finishes: ad-showing class removed
  player.classList.remove('ad-showing');

  // Trigger update
  dom.window.eval('handleVideoAds()');

  // Playback rate and mute must be restored
  assert.equal(video.playbackRate, 1, 'Playback rate should restore to 1 after ad ends');
  assert.equal(video.muted, false, 'Mute should restore to false after ad ends');

  dom.window.close();
});

test('video-blocker does not treat video-adapter or video-adaptive as an ad', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-adapter-container">
          <video id="stream-video" class="video-adaptive"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('stream-video');
  Object.defineProperty(video, 'duration', { value: 120, configurable: true, writable: true });
  video.playbackRate = 1;
  video.muted = false;

  dom.window.eval(videoBlockerCode);

  assert.equal(video.playbackRate, 1, 'Playback rate must not be sped up on video-adapter');
  assert.equal(video.muted, false, 'Audio must not be muted on video-adapter');

  dom.window.close();
});

test('surrogate stubs: googletag pubads is chainable and pbjs.que executes queued callbacks', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const prebidCode = fs.readFileSync('surrogates/prebid.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously" });

  dom.window.eval(defuserMainCode);
  dom.window.eval(prebidCode);

  // googletag chainability
  assert.doesNotThrow(() => {
    dom.window.googletag.pubads().enableSingleRequest().collapseEmptyDivs();
  });

  // pbjs queue execution
  let executed = false;
  dom.window.pbjs.que.push(() => {
    executed = true;
  });
  assert.equal(executed, true, 'pbjs.que.push must execute callback');

  // adsbygoogle push returns length / truthy
  const pushRes = dom.window.adsbygoogle.push({});
  assert.ok(pushRes > 0, 'adsbygoogle.push must return positive number');

  dom.window.close();
});

test('cosmetic.css does not contain decoy trap for empty .adsbygoogle and uses word boundaries', () => {
  const css = fs.readFileSync('content-scripts/cosmetic.css', 'utf8');
  // Should NOT blanket-hide bare .adsbygoogle
  assert.equal(css.includes('\n.adsbygoogle,'), false, 'Should not blanket-hide bare .adsbygoogle');
  // Should NOT use loose substring [class*="ad-box"] without boundaries
  assert.equal(css.includes('[class*="ad-box"]'), false, 'Should avoid loose substring [class*="ad-box"]');
});
