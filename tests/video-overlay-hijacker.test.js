// tests/video-overlay-hijacker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('cosmetic-filter disarms fake play overlay, prevents popup, removes overlay, and plays real video', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container" style="position: relative; width: 640px; height: 360px;">
          <video id="real-video"></video>
          <div id="fake-play-overlay" class="play-overlay" style="position: absolute; top:0; left:0; width: 100%; height: 100%; z-index: 9999;">
            <div class="play-icon">▶</div>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('real-video');
  let played = false;
  video.play = () => { played = true; return Promise.resolve(); };

  let popupOpened = false;
  dom.window.open = (url) => { popupOpened = true; return null; };

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
        if (msg.type === 'AD_BLOCKED') reportedCount += msg.count;
        return Promise.resolve();
      }
    }
  };

  dom.window.eval(cosmeticFilterCode);

  const overlay = dom.window.document.getElementById('fake-play-overlay');
  // Site script attached click listener to overlay that tries to open ad
  overlay.addEventListener('click', () => {
    dom.window.open('https://popads.net/click?id=123');
  });

  const clickEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  overlay.dispatchEvent(clickEvent);

  // Overlay must be disarmed and removed
  assert.equal(clickEvent.defaultPrevented, true, 'Click event must be intercepted');
  assert.equal(dom.window.document.getElementById('fake-play-overlay'), null, 'Fake overlay must be removed from DOM');
  assert.equal(popupOpened, false, 'Ad popup must NOT be opened');
  assert.equal(played, true, 'Real video.play() should be triggered');
  assert.ok(reportedCount >= 1, 'Blocked popunder must be counted');

  dom.window.close();
});

test('defuser-main wraps window.open to block suspicious ad popups', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously" });

  let nativeOpenCalled = false;
  dom.window.open = (url) => {
    nativeOpenCalled = true;
    return { focus: () => {} };
  };

  dom.window.eval(defuserMainCode);

  // Calling open with ad domain should be blocked and return null
  const res1 = dom.window.open('https://cutt.ly/1xbetgoal');
  assert.equal(res1, null, 'Ad popup url should return null');
  assert.equal(nativeOpenCalled, false, 'Native open must not be called for ad url');

  // Calling open with legitimate same-origin URL should be permitted
  const res2 = dom.window.open('/watch?v=123');
  assert.equal(nativeOpenCalled, true, 'Legitimate navigation should be permitted');

  dom.window.close();
});
