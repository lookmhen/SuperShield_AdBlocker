// tests/video-blocker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('video-blocker fast-forwards, mutes, and clicks skip on YouTube ad-showing state', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="movie_player" class="html5-video-player ad-showing">
          <video id="yt-video"></video>
          <button class="ytp-ad-skip-button-modern">Skip Ad</button>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('yt-video');
  Object.defineProperty(video, 'duration', { value: 30, configurable: true, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;

  let clicked = false;
  dom.window.document.querySelector('.ytp-ad-skip-button-modern').addEventListener('click', () => {
    clicked = true;
  });

  dom.window.eval(videoBlockerCode);

  assert.equal(video.playbackRate, 16);
  assert.equal(video.muted, true);
  assert.equal(clicked, true);
  dom.window.close();
});

test('video-blocker handles generic HTML5 video ad and clicks universal skip button', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="custom-stream-player">
          <video id="stream-video" class="ad-playing"></video>
          <div class="video-ad-overlay">
            <button class="skip-btn" aria-label="Skip">Skip</button>
          </div>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  const video = dom.window.document.getElementById('stream-video');
  Object.defineProperty(video, 'duration', { value: 15, configurable: true, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;

  let clicked = false;
  dom.window.document.querySelector('.skip-btn').addEventListener('click', () => {
    clicked = true;
  });

  dom.window.eval(videoBlockerCode);

  assert.equal(video.playbackRate, 16);
  assert.equal(video.muted, true);
  assert.equal(clicked, true);
  dom.window.close();
});

test('video-blocker safely handles Extension context invalidated without throwing unhandled exceptions', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="movie_player" class="html5-video-player ad-showing">
          <video id="yt-video"></video>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  // Simulate invalidated extension context where chrome.runtime.id throws or sendMessage throws synchronously
  dom.window.chrome = {
    runtime: {
      get id() {
        throw new Error('Extension context invalidated.');
      },
      sendMessage: () => {
        throw new Error('Extension context invalidated.');
      }
    }
  };

  const video = dom.window.document.getElementById('yt-video');
  Object.defineProperty(video, 'duration', { value: 30, configurable: true, writable: true });

  assert.doesNotThrow(() => {
    dom.window.eval(videoBlockerCode);
    video.dispatchEvent(new dom.window.Event('timeupdate'));
  });

  dom.window.close();
});

test('video-blocker auto-skips custom player ad, fast-forwards watermelogic video, and clicks Thai skip button #skip_btn', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
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

  let skipClicked = false;
  dom.window.document.getElementById('skip_btn').addEventListener('click', () => {
    skipClicked = true;
  });

  dom.window.eval(videoBlockerCode);

  assert.equal(video.playbackRate, 16, 'Ad video must be accelerated to 16x');
  assert.equal(video.muted, true, 'Ad video must be muted');
  assert.equal(video.currentTime, 30, 'Ad video must be skipped to end');
  assert.equal(skipClicked, true, 'Skip button #skip_btn must be auto clicked');
  assert.equal(dom.window.document.getElementById('register_btn').style.display, 'none', 'Register button must be hidden');

  dom.window.close();
});

test('video-blocker does NOT fast-forward or mute the final content video even with afs_ads in the player', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
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
  video.muted = false;

  dom.window.eval(videoBlockerCode);

  // Simulate user pressing play on the real movie
  video.dispatchEvent(new dom.window.Event('play'));
  video.dispatchEvent(new dom.window.Event('timeupdate'));

  assert.equal(video.playbackRate, 1, 'Final content video must maintain 1.0 playbackRate');
  assert.equal(video.muted, false, 'Final content video must not be muted');
  assert.equal(video.currentTime, 0, 'Final content video must not be jumped to the end');

  dom.window.close();
});
