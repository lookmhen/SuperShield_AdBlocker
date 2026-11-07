// tests/youtube-ad-blocking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('defuser-main sanitizes ytInitialPlayerResponse by stripping adPlacements and playerAds', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'dangerously' });

  // Simulate YouTube setting ytInitialPlayerResponse with ad metadata
  dom.window.eval(defuserMainCode);
  dom.window.ytInitialPlayerResponse = {
    videoDetails: { title: 'Test Video' },
    adPlacements: [{ adPlacementRenderer: { config: {} } }],
    playerAds: [{ playerAdRenderer: {} }],
    adSlots: [{ slotId: '123' }],
    playbackTracking: {
      videostatsPlaybackUrl: 'https://youtube.com/api/stats/playback',
      ptrackingUrl: 'https://youtube.com/ptracking'
    }
  };

  const sanitized = dom.window.ytInitialPlayerResponse;
  assert.equal(sanitized.videoDetails.title, 'Test Video');
  assert.equal(sanitized.adPlacements, undefined);
  assert.equal(sanitized.playerAds, undefined);
  assert.equal(sanitized.adSlots, undefined);
  assert.equal(sanitized.playbackTracking.ptrackingUrl, undefined);
  dom.window.close();
});

test('defuser-main sanitizes JSON.parse payloads containing YouTube ad placements', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'dangerously' });
  dom.window.eval(defuserMainCode);

  const rawJson = JSON.stringify({
    contents: 'video stream',
    adPlacements: [{ ad: 1 }],
    playerAds: [{ ad: 2 }]
  });

  const parsed = dom.window.JSON.parse(rawJson);
  assert.equal(parsed.contents, 'video stream');
  assert.equal(parsed.adPlacements, undefined);
  assert.equal(parsed.playerAds, undefined);
  dom.window.close();
});

test('video-blocker responds to video timeupdate and playing events immediately to fast-forward ad', () => {
  const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="movie_player" class="html5-video-player ad-showing">
          <video id="yt-video"></video>
          <button class="ytp-ad-skip-button-modern">Skip</button>
        </div>
      </body>
    </html>`, { runScripts: 'dangerously' });

  const video = dom.window.document.getElementById('yt-video');
  Object.defineProperty(video, 'duration', { value: 20, configurable: true, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;

  let skipClicked = false;
  dom.window.document.querySelector('.ytp-ad-skip-button-modern').addEventListener('click', () => {
    skipClicked = true;
  });

  dom.window.eval(videoBlockerCode);

  // Trigger timeupdate event on video
  video.dispatchEvent(new dom.window.Event('timeupdate'));

  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
  assert.equal(video.currentTime, 20);
  assert.equal(skipClicked, true);
  dom.window.close();
});

test('cosmetic.css includes rules for YouTube feed ads and overlay banners', () => {
  const css = fs.readFileSync('content-scripts/cosmetic.css', 'utf8');
  assert.ok(css.includes('ytd-ad-slot-renderer'), 'Must include ytd-ad-slot-renderer');
  assert.ok(css.includes('#masthead-ad'), 'Must include #masthead-ad');
  assert.ok(css.includes('.ytp-ad-overlay-container'), 'Must include .ytp-ad-overlay-container');
  assert.ok(css.includes('ytd-in-feed-ad-layout-renderer'), 'Must include ytd-in-feed-ad-layout-renderer');
});

test('ad-rules.json blocks YouTube ad beacons and player ad break endpoints', () => {
  const rules = JSON.parse(fs.readFileSync('rules/ad-rules.json', 'utf8'));
  const ytRuleStats = rules.some(r => r.condition?.urlFilter?.includes('youtube.com/api/stats/ads'));
  const ytRuleAdBreak = rules.some(r => r.condition?.urlFilter?.includes('youtube.com/youtubei/v1/player/ad_break'));
  const ytRulePageAd = rules.some(r => r.condition?.urlFilter?.includes('youtube.com/pagead'));

  assert.ok(ytRuleStats, 'Must block youtube.com/api/stats/ads');
  assert.ok(ytRuleAdBreak, 'Must block youtube.com/youtubei/v1/player/ad_break');
  assert.ok(ytRulePageAd, 'Must block youtube.com/pagead');
});

test('defuser-main sanitizes ytInitialData by stripping masthead and rich grid ad slots', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'dangerously' });
  dom.window.eval(defuserMainCode);

  dom.window.ytInitialData = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  masthead: { adSlotRenderer: {} },
                  contents: [
                    { adSlotRenderer: { id: 'ad-1' } },
                    { richItemRenderer: { content: { videoRenderer: { id: 'v1' } } } }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  };

  const richGrid = dom.window.ytInitialData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer;
  assert.equal(richGrid.masthead, undefined, 'Masthead ad must be removed');
  assert.equal(richGrid.contents.length, 1, 'Only non-ad items should remain');
  dom.window.close();
});

test('cosmetic-filter detects and removes YouTube masthead ad from DOM', () => {
  const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div id="masthead-ad" class="style-scope ytd-rich-grid-renderer">
          <ytd-ad-slot-renderer class="style-scope ytd-rich-grid-renderer">
            <video id="masthead-video"></video>
          </ytd-ad-slot-renderer>
        </div>
      </body>
    </html>`, { runScripts: 'dangerously' });

  let blockedCount = 0;
  dom.window.chrome = {
    runtime: {
      sendMessage: (msg) => {
        if (msg.type === 'AD_BLOCKED') blockedCount += msg.count;
        return Promise.resolve();
      }
    }
  };

  dom.window.eval(cosmeticFilterCode);

  const mastheadEl = dom.window.document.getElementById('masthead-ad');
  assert.equal(mastheadEl, null, 'Masthead ad element must be removed from the DOM');
  assert.ok(blockedCount >= 1, 'Blocked masthead ad must be counted');
  dom.window.close();
});
