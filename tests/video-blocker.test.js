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
