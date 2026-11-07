// tests/player-controls-safety.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');

test('clicking speaker, mute, volume, and fullscreen buttons does NOT remove video or controls', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="main-player" class="video-player video-container" style="position: relative; width: 800px; height: 450px;">
          <video id="html5-video"></video>
          <div class="player-controls control-bar" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 40px;">
            <button id="mute-button" class="vjs-mute-control mute-btn" type="button">
              <svg class="volume-icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"></path></svg>
            </button>
            <div id="volume-slider" class="volume-slider vjs-volume-bar" style="width: 50px;"></div>
            <button id="fullscreen-button" class="fullscreen-btn vjs-fullscreen-control" type="button">
              <svg class="fs-icon" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3z"></path></svg>
            </button>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    dom.window.chrome = {
      storage: { local: { get: (k, cb) => cb({ enabled: true }) } },
      runtime: { sendMessage: () => Promise.resolve() }
    };

    dom.window.eval(cosmeticFilterCode);

    // 1. Test clicking the mute button (both button and SVG icon inside)
    const muteBtn = dom.window.document.getElementById('mute-button');
    const volumeIcon = muteBtn.querySelector('svg');
    const path = volumeIcon.querySelector('path');

    let muteEventDefaultPrevented = false;
    let muteClicked = false;
    muteBtn.addEventListener('click', (e) => {
      muteClicked = true;
      muteEventDefaultPrevented = e.defaultPrevented;
    });

    const clickMute = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    path.dispatchEvent(clickMute);

    assert.equal(muteClicked, true, 'Mute button click listener should execute');
    assert.equal(clickMute.defaultPrevented, false, 'Mute click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('main-player'), null, 'Video player container must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('html5-video'), null, 'Video element must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('mute-button'), null, 'Mute button must NOT be removed');

    // 2. Test clicking the volume slider
    const volumeSlider = dom.window.document.getElementById('volume-slider');
    let volumeClicked = false;
    volumeSlider.addEventListener('click', () => { volumeClicked = true; });

    const clickVol = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    volumeSlider.dispatchEvent(clickVol);

    assert.equal(volumeClicked, true, 'Volume slider click should execute');
    assert.equal(clickVol.defaultPrevented, false, 'Volume slider click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('volume-slider'), null, 'Volume slider must NOT be removed');

    // 3. Test clicking the fullscreen button (both button and path inside)
    const fsBtn = dom.window.document.getElementById('fullscreen-button');
    const fsPath = fsBtn.querySelector('path');
    let fsClicked = false;
    fsBtn.addEventListener('click', () => { fsClicked = true; });

    const clickFs = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    fsPath.dispatchEvent(clickFs);

    assert.equal(fsClicked, true, 'Fullscreen click should execute');
    assert.equal(clickFs.defaultPrevented, false, 'Fullscreen click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('fullscreen-button'), null, 'Fullscreen button must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('main-player'), null, 'Player must remain intact after fullscreen click');
  } finally {
    dom.window.close();
  }
});

test('generic HTML5 player controls (controls div with custom buttons) are preserved and never white-out video', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="player-box" class="player-wrapper">
          <video id="custom-video"></video>
          <div class="controls-panel">
            <button id="speaker-btn" class="speaker-icon">🔊</button>
            <button id="fs-btn" class="fullscreen-icon">⛶</button>
            <div id="vol-bar" class="volume-track"><div class="volume-level"></div></div>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  try {
    dom.window.chrome = {
      storage: { local: { get: (k, cb) => cb({ enabled: true }) } },
      runtime: { sendMessage: () => Promise.resolve() }
    };

    dom.window.eval(cosmeticFilterCode);

    // Test Speaker Click
    const speakerBtn = dom.window.document.getElementById('speaker-btn');
    let speakerClicked = false;
    speakerBtn.addEventListener('click', () => { speakerClicked = true; });

    const speakerEvt = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    speakerBtn.dispatchEvent(speakerEvt);

    assert.equal(speakerClicked, true, 'Speaker click should execute');
    assert.equal(speakerEvt.defaultPrevented, false, 'Speaker click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('player-box'), null, 'Player wrapper must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('custom-video'), null, 'Video element must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('speaker-btn'), null, 'Speaker button must NOT be removed');

    // Test Fullscreen Click
    const fsBtn = dom.window.document.getElementById('fs-btn');
    let fsClicked = false;
    fsBtn.addEventListener('click', () => { fsClicked = true; });

    const fsEvt = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    fsBtn.dispatchEvent(fsEvt);

    assert.equal(fsClicked, true, 'Fullscreen click should execute');
    assert.equal(fsEvt.defaultPrevented, false, 'Fullscreen click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('fs-btn'), null, 'Fullscreen button must NOT be removed');
    assert.notEqual(dom.window.document.getElementById('custom-video'), null, 'Video must remain in DOM');

    // Test Volume Bar Click
    const volBar = dom.window.document.getElementById('vol-bar');
    let volClicked = false;
    volBar.addEventListener('click', () => { volClicked = true; });

    const volEvt = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    volBar.dispatchEvent(volEvt);

    assert.equal(volClicked, true, 'Volume track click should execute');
    assert.equal(volEvt.defaultPrevented, false, 'Volume track click must NOT be prevented');
    assert.notEqual(dom.window.document.getElementById('vol-bar'), null, 'Volume track must NOT be removed');
  } finally {
    dom.window.close();
  }
});
