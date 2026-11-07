// tests/mouse-and-contextmenu-hijack.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');

test('cosmetic-filter proactively sweeps and removes fake play overlays and full-page click traps on load', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container" style="position: relative; width: 640px; height: 360px;">
          <video id="real-video"></video>
          <div id="initial-fake-overlay" class="fake-play-button" style="position: absolute; top:0; left:0; width: 100%; height: 100%; z-index: 9999;">
            <div class="play-icon">▶</div>
          </div>
        </div>
        <div id="initial-full-page-trap" style="position: fixed; top: 0px; left: 0px; width: 100%; height: 100%; z-index: 2147483647;"></div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    dom.window.chrome = {
      storage: { local: { get: (k, cb) => cb({ enabled: true }) } },
      runtime: { sendMessage: () => Promise.resolve() }
    };

    dom.window.eval(cosmeticFilterCode);
    dom.window.sweepOverlays();

    // Initial overlays must be proactively removed when sweepOverlays is invoked
    assert.equal(dom.window.document.getElementById('initial-fake-overlay'), null, 'Initial fake overlay must be proactively removed');
    assert.equal(dom.window.document.getElementById('initial-full-page-trap'), null, 'Initial full-page click trap must be proactively removed');
  } finally {
    dom.window.close();
  }
});

test('cosmetic-filter intercepts right-click (contextmenu & mousedown) on dynamically injected fake play overlay', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container" style="position: relative; width: 640px; height: 360px;">
          <video id="real-video"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    let popupOpened = false;
    dom.window.open = () => { popupOpened = true; return null; };

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

    const videoContainer = dom.window.document.querySelector('.video-container');
    const dynamicOverlay = dom.window.document.createElement('div');
    dynamicOverlay.id = 'dynamic-fake-overlay';
    dynamicOverlay.className = 'play-overlay';
    dynamicOverlay.style.position = 'absolute';
    dynamicOverlay.style.top = '0px';
    dynamicOverlay.style.left = '0px';
    dynamicOverlay.style.width = '100%';
    dynamicOverlay.style.height = '100%';
    dynamicOverlay.style.zIndex = '99999';
    videoContainer.appendChild(dynamicOverlay);

    // Ad script attaches right-click triggers
    dynamicOverlay.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        dom.window.open('https://popcash.net/click');
      }
    });
    dynamicOverlay.addEventListener('contextmenu', () => {
      dom.window.open('https://popcash.net/click');
    });

    // Simulate user right-clicking on the overlay
    const mousedownEvent = new dom.window.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2
    });
    dynamicOverlay.dispatchEvent(mousedownEvent);

    const contextmenuEvent = new dom.window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2
    });
    dynamicOverlay.dispatchEvent(contextmenuEvent);

    assert.equal(mousedownEvent.defaultPrevented, true, 'Right-click mousedown must be intercepted');
    assert.equal(contextmenuEvent.defaultPrevented, true, 'Contextmenu must be intercepted');
    assert.equal(popupOpened, false, 'Ad popup must NOT open on right-click');
    assert.equal(dom.window.document.getElementById('dynamic-fake-overlay'), null, 'Dynamic overlay must be removed from DOM');
    assert.ok(reportedCount >= 1, 'Blocked ad counter must be incremented');
  } finally {
    dom.window.close();
  }
});

test('cosmetic-filter intercepts mousedown before click on dynamically injected overlay', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container" style="position: relative; width: 640px; height: 360px;">
          <video id="real-video"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    let popupOpened = false;
    dom.window.open = () => { popupOpened = true; return null; };

    dom.window.chrome = {
      storage: { local: { get: (k, cb) => cb({ enabled: true }) } },
      runtime: { sendMessage: () => Promise.resolve() }
    };

    dom.window.eval(cosmeticFilterCode);

    const videoContainer = dom.window.document.querySelector('.video-container');
    const dynamicOverlay = dom.window.document.createElement('div');
    dynamicOverlay.id = 'dynamic-click-overlay';
    dynamicOverlay.style.position = 'absolute';
    dynamicOverlay.style.top = '0px';
    dynamicOverlay.style.width = '100%';
    dynamicOverlay.style.height = '100%';
    dynamicOverlay.style.zIndex = '9999';
    videoContainer.appendChild(dynamicOverlay);

    dynamicOverlay.addEventListener('mousedown', () => {
      dom.window.open('https://adsterra.com/pop');
    });

    const mousedownEvent = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    dynamicOverlay.dispatchEvent(mousedownEvent);

    assert.equal(mousedownEvent.defaultPrevented, true, 'Mousedown must be intercepted');
    assert.equal(popupOpened, false, 'Ad popup must not be opened by mousedown');
    assert.equal(dom.window.document.getElementById('dynamic-click-overlay'), null, 'Overlay must be removed');
  } finally {
    dom.window.close();
  }
});

test('cosmetic-filter intercepts full-page transparent fixed overlay on body when player is present', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="player-box">
          <iframe src="https://stream.host/embed/video123" style="width: 800px; height: 450px;"></iframe>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    let popupOpened = false;
    dom.window.open = () => { popupOpened = true; return null; };

    dom.window.chrome = {
      storage: { local: { get: (k, cb) => cb({ enabled: true }) } },
      runtime: { sendMessage: () => Promise.resolve() }
    };

    dom.window.eval(cosmeticFilterCode);

    // Ad script injects a full page trap after page load
    const trap = dom.window.document.createElement('div');
    trap.id = 'dynamic-full-trap';
    trap.style.position = 'fixed';
    trap.style.top = '0px';
    trap.style.left = '0px';
    trap.style.width = '100%';
    trap.style.height = '100%';
    trap.style.zIndex = '2147483647';
    dom.window.document.body.appendChild(trap);

    trap.addEventListener('click', () => {
      dom.window.open('https://propellerads.com/zone');
    });

    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    trap.dispatchEvent(clickEvent);

    assert.equal(clickEvent.defaultPrevented, true, 'Full page click trap must be intercepted');
    assert.equal(popupOpened, false, 'Popup must not open');
    assert.equal(dom.window.document.getElementById('dynamic-full-trap'), null, 'Full page trap must be removed');
  } finally {
    dom.window.close();
  }
});

test('defuser-main neutralizes blank window.open popunders (about:blank and empty URL)', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously" });

  try {
    let nativeOpenCalled = false;
    dom.window.open = (url) => {
      nativeOpenCalled = true;
      return { closed: false, focus: () => {} };
    };

    dom.window.eval(defuserMainCode);

    // Call window.open('about:blank') or window.open('')
    const win1 = dom.window.open('about:blank', '_blank');
    assert.ok(win1 !== null, 'Should return a dummy window object so scripts do not crash');
    assert.equal(nativeOpenCalled, false, 'Native open must not be called for about:blank popunder');

    // Attempting to set dummy window location to ad URL should be neutralized
    win1.location.href = 'https://adsterra.com/redirect';
    assert.equal(win1.location.href, '', 'Dummy window href redirection must be neutralized');

    // Call window.open('')
    const win2 = dom.window.open('');
    assert.equal(nativeOpenCalled, false, 'Native open must not be called for empty string');
  } finally {
    dom.window.close();
  }
});

test('defuser-main blocks cross-origin window.open triggered during player interaction', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container">
          <video id="player"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    let nativeOpenCalls = [];
    dom.window.open = (url) => {
      nativeOpenCalls.push(url);
      return { closed: false, focus: () => {} };
    };

    dom.window.eval(defuserMainCode);

    const video = dom.window.document.getElementById('player');
    
    // Simulate user clicking on player
    const mousedown = new dom.window.MouseEvent('mousedown', { bubbles: true });
    video.dispatchEvent(mousedown);

    // Ad script tries to open unknown rotating ad domain immediately after click
    const res = dom.window.open('https://random-rotating-ad-network99.biz/in?id=99');
    assert.equal(nativeOpenCalls.length, 0, 'Cross-origin window.open during player action must be blocked');
  } finally {
    dom.window.close();
  }
});

test('defuser-main disarms programmatic anchor.click() targeting ad networks or cross-origin URLs during player interaction', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-container">
          <video id="player"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    dom.window.eval(defuserMainCode);

    const video = dom.window.document.getElementById('player');
    const mousedown = new dom.window.MouseEvent('mousedown', { bubbles: true });
    video.dispatchEvent(mousedown);

    // Ad script creates an anchor and tries to click it programmatically
    const adLink = dom.window.document.createElement('a');
    adLink.href = 'https://adsterra.com/traffic';
    adLink.target = '_blank';
    dom.window.document.body.appendChild(adLink);

    let anchorFollowed = false;
    adLink.addEventListener('click', (e) => {
      anchorFollowed = true;
    });

    adLink.click();
    assert.equal(anchorFollowed, false, 'Programmatic ad click must be disarmed and canceled');
  } finally {
    dom.window.close();
  }
});
