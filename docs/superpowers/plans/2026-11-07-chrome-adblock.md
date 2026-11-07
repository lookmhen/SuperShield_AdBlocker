# Chrome Extension AdBlocker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, lightweight Google Chrome Extension (Manifest V3) that blocks banner ads, evades anti-adblock detection, automatically fast-forwards and skips video ads across YouTube and diverse HTML5 streaming players, and prevents popunders.

**Architecture:** Dual-layer filtering combining declarative network rules (`declarativeNetRequest`) with local surrogate script redirection for anti-adblock evasion, main-world early property stubs (`world: "MAIN"`), cosmetic CSS/DOM filtering, and an adaptive video player watcher that accelerates ad playback (16x), mutes audio, and triggers auto-skip clicks in real time.

**Tech Stack:** Chrome Extension APIs (Manifest V3, `declarativeNetRequest`, Service Worker, Content Scripts), Vanilla JavaScript (ES6+), HTML5/CSS3, Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-07-chrome-adblock-design.md`

## Global Constraints
- Must strictly comply with Chrome Extension Manifest V3 specifications.
- Must run in `all_frames: true` and `match_about_blank: true` to handle embedded streaming players.
- Media elements must never be thrown into error states (never hard-cancel critical video streams).
- Network blocking must use `declarativeNetRequest` with valid JSON rule schema.
- Content script DOM operations must be debounced and non-blocking using `MutationObserver`.

## Review Focus
1. **Video player playback stall:** Fast-forwarding or setting `currentTime` on a stream whose duration is not yet finite or is live/streaming; must check `isFinite(video.duration)` and verify duration > 0 before seeking.
2. **Anti-adblock bait false-positive:** Overly generic CSS selectors (`.ad`) hiding site layout elements; cosmetic selectors must be scoped to specific ad patterns or accompanied by structural checks.
3. **Surrogate script missing API methods:** Sites calling `adsbygoogle.push({ ... })` or inspecting `window.canRunAds` crashing due to undefined properties; surrogate stubs must implement dummy chainable methods.
4. **Popunder event interception breaking legitimate clicks:** Catching click events on the player container preventing user interaction with real play/pause controls; must only intercept clicks navigating to foreign URLs or spawning untrusted new windows.
5. **Multi-frame messaging race:** Content scripts in iframes sending messages before background service worker is awakened; messaging must handle runtime errors gracefully.

---

### Task 1: Extension Manifest, Icons, and Surrogate Scripts Setup

**Files:**
- Create: `manifest.json`
- Create: `icons/generate-icons.js`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`
- Create: `surrogates/adsbygoogle.js`
- Create: `surrogates/prebid.js`
- Test: `tests/manifest-and-surrogates.test.js`

**Interfaces:**
- Consumes: None (Root scaffold)
- Produces: Valid Chrome extension manifest file and web-accessible surrogate stubs for anti-adblock decoy scripts.

- [ ] **Step 1: Write test for manifest validity and surrogate stubs**

```javascript
// tests/manifest-and-surrogates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('manifest.json has required Manifest V3 fields and correct structure', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.ok(manifest.version);
  assert.ok(manifest.permissions.includes('declarativeNetRequest'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.declarative_net_request.rule_resources.length > 0);
  assert.ok(manifest.web_accessible_resources.length > 0);
});

test('surrogate scripts define required mock structures without error', () => {
  const adsbygoogleCode = fs.readFileSync('surrogates/adsbygoogle.js', 'utf8');
  assert.ok(adsbygoogleCode.includes('window.adsbygoogle'));
  assert.ok(adsbygoogleCode.includes('push'));
  
  const prebidCode = fs.readFileSync('surrogates/prebid.js', 'utf8');
  assert.ok(prebidCode.includes('pbjs'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/manifest-and-surrogates.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement icon generator, `manifest.json`, and surrogate files**

Create `icons/generate-icons.js` using node buffer to write valid PNG files.
Create `surrogates/adsbygoogle.js` stub:
```javascript
(function() {
  window.adsbygoogle = window.adsbygoogle || [];
  window.adsbygoogle.loaded = true;
  window.adsbygoogle.push = function(obj) { return 0; };
})();
```
Create `surrogates/prebid.js` stub:
```javascript
(function() {
  window.pbjs = window.pbjs || {};
  window.pbjs.que = window.pbjs.que || [];
  window.pbjs.processQueue = function() {};
})();
```
Create `manifest.json` configured for background service worker, declarative ruleset, content scripts, and web accessible surrogates.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/manifest-and-surrogates.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add manifest.json icons/ surrogates/ tests/manifest-and-surrogates.test.js
git commit -m "feat: setup manifest v3 scaffold, icons, and surrogate scripts"
```

---

### Task 2: DeclarativeNetRequest Ruleset for Ad Networks & Surrogates

**Files:**
- Create: `rules/ad-rules.json`
- Test: `tests/ad-rules.test.js`

**Interfaces:**
- Consumes: `surrogates/adsbygoogle.js`, `surrogates/prebid.js`
- Produces: Chrome `declarativeNetRequest` ruleset containing network block rules and redirect rules for surrogates.

- [ ] **Step 1: Write test for ad-rules.json schema and rule types**

```javascript
// tests/ad-rules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('rules/ad-rules.json contains valid declarativeNetRequest rules', () => {
  const rules = JSON.parse(fs.readFileSync('rules/ad-rules.json', 'utf8'));
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length >= 20, 'Expected at least 20 curated ad rules');
  
  const ids = new Set();
  let hasRedirect = false;
  let hasBlock = false;

  for (const rule of rules) {
    assert.ok(typeof rule.id === 'number', 'Rule id must be a number');
    assert.ok(!ids.has(rule.id), `Duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.condition && typeof rule.condition === 'object');
    assert.ok(rule.action && typeof rule.action === 'object');

    if (rule.action.type === 'redirect') {
      hasRedirect = true;
      assert.ok(rule.action.redirect && rule.action.redirect.extensionPath);
    }
    if (rule.action.type === 'block') {
      hasBlock = true;
    }
  }

  assert.ok(hasBlock, 'Must contain block action rules');
  assert.ok(hasRedirect, 'Must contain redirect surrogate rules');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ad-rules.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `rules/ad-rules.json`**

Curate rules blocking DoubleClick, Google Syndication ad servers, Taboola, Outbrain, PopAds, Adsterra, PropellerAds, Video VAST beacons, and redirect rules sending `*/pagead/js/adsbygoogle.js` to `/surrogates/adsbygoogle.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ad-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add rules/ad-rules.json tests/ad-rules.test.js
git commit -m "feat: create declarativeNetRequest ruleset with block and surrogate redirect actions"
```

---

### Task 3: Anti-Adblock Defuser (Main World Stubs & Overlay Dismissal)

**Files:**
- Create: `content-scripts/defuser-main.js`
- Create: `content-scripts/defuser-isolated.js`
- Test: `tests/defuser.test.js`

**Interfaces:**
- Consumes: None
- Produces:
  - `initMainDefuser()` in `defuser-main.js`: Stubs `window.canRunAds`, `window.isAdBlockActive`, `window.google_ad_status`.
  - `dismissAntiAdblockModals()` in `defuser-isolated.js`: Detects and removes anti-adblock modals/backdrops and restores page scrolling.

- [ ] **Step 1: Write test for main-world stubs and modal dismissal logic**

```javascript
// tests/defuser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
const defuserIsolatedCode = fs.readFileSync('content-scripts/defuser-isolated.js', 'utf8');

test('defuser-main.js stubs anti-adblock detection variables on window', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously" });
  dom.window.eval(defuserMainCode);
  
  assert.equal(dom.window.canRunAds, true);
  assert.equal(dom.window.isAdBlockActive, false);
  assert.ok(dom.window.adsbygoogle);
});

test('defuser-isolated.js dismisses anti-adblock modal and restores scroll', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html style="overflow: hidden">
      <body style="overflow: hidden">
        <div id="adblock-modal-overlay" class="adblock-warning-popup" style="position:fixed">
          Please disable AdBlock
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.eval(defuserIsolatedCode);
  
  assert.equal(dom.window.document.getElementById('adblock-modal-overlay'), null);
  assert.notEqual(dom.window.document.body.style.overflow, 'hidden');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/defuser.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `content-scripts/defuser-main.js` and `content-scripts/defuser-isolated.js`**

- `defuser-main.js`: Immediately defines fake ad properties and wraps detector functions.
- `defuser-isolated.js`: Runs MutationObserver querying for modal overlays (`[id*="adblock" i]`, `[class*="adblock" i]`, `.tp-backdrop`), removes them, and resets `document.documentElement.style.overflow` and `document.body.style.overflow` to `auto`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/defuser.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content-scripts/defuser-main.js content-scripts/defuser-isolated.js tests/defuser.test.js
git commit -m "feat: implement anti-adblock defuser stubs and modal dismissal"
```

---

### Task 4: Cosmetic Banner Filtering & Popunder Interceptor

**Files:**
- Create: `content-scripts/cosmetic.css`
- Create: `content-scripts/cosmetic-filter.js`
- Test: `tests/cosmetic-filter.test.js`

**Interfaces:**
- Consumes: None
- Produces:
  - `cosmetic.css`: Static high-specificity rules to hide ad banners, sponsored sections, and empty ad placeholders.
  - `interceptPopunders(event)`: Click listener to stop transparent overlay hijackers on streaming player elements.

- [ ] **Step 1: Write test for cosmetic filter and popunder interception**

```javascript
// tests/cosmetic-filter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const cosmeticFilterCode = fs.readFileSync('content-scripts/cosmetic-filter.js', 'utf8');

test('cosmetic-filter intercepts suspicious popunder links on video containers', () => {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html>
      <body>
        <div class="video-player-container">
          <video id="player"></video>
          <a id="fake-overlay" href="https://malicious-tracker.ad/click" target="_blank" style="position:absolute; width:100%; height:100%"></a>
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.eval(cosmeticFilterCode);
  
  const link = dom.window.document.getElementById('fake-overlay');
  let defaultPrevented = false;
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  
  // The script should intercept and disarm the click
  assert.equal(event.defaultPrevented, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cosmetic-filter.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `content-scripts/cosmetic.css` and `content-scripts/cosmetic-filter.js`**

Implement CSS rules targeting `.ad-banner`, `ins.adsbygoogle`, `iframe[src*="doubleclick"]`, `div[id^="google_ads"]`, etc.
Implement capturing click interceptor that detects when an `<a>` or overlay sitting directly over a `<video>` attempts to navigate to a third-party ad/tracker domain, preventing the action and removing the transparent blocker.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cosmetic-filter.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content-scripts/cosmetic.css content-scripts/cosmetic-filter.js tests/cosmetic-filter.test.js
git commit -m "feat: implement cosmetic CSS filtering and anti-popunder click interceptor"
```

---

### Task 5: YouTube & Universal HTML5 Video Ad Blocker Engine

**Files:**
- Create: `content-scripts/video-blocker.js`
- Test: `tests/video-blocker.test.js`

**Interfaces:**
- Consumes: None
- Produces:
  - `handleYouTubeAds(player)`: Mutes, fast-forwards to 16x, sets currentTime to duration, and clicks skip buttons.
  - `handleUniversalVideoAds(video)`: Inspects HTML5 video elements and parent containers, fast-forwards pre-rolls, and triggers generic skip selectors.

- [ ] **Step 1: Write test for YouTube and Universal HTML5 video ad handling**

```javascript
// tests/video-blocker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const videoBlockerCode = fs.readFileSync('content-scripts/video-blocker.js', 'utf8');

test('video-blocker fast-forwards, mutes, and clicks skip on YouTube ad-showing state', () => {
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
  video.duration = 30;
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
});

test('video-blocker handles generic HTML5 video ad and clicks universal skip button', () => {
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
  video.duration = 15;
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/video-blocker.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `content-scripts/video-blocker.js`**

Implement:
1. `runYouTubeAdSkipper()`: MutationObserver for `#movie_player, .html5-video-player`. Checks `.ad-showing, .ad-interrupting`. Mutes `video.muted = true`, sets `video.playbackRate = 16.0`, checks `isFinite(video.duration)` and advances `video.currentTime = video.duration`, queries `.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-overlay-close-button` and clicks immediately.
2. `runUniversalVideoSkipper()`: Scans all `<video>` elements in document and iframes. If video or parent container has ad indicators (`ad-showing`, `ad-playing`, `vast-ad`, duration <= 30 with skip button present), speeds up to 16x, mutes, and queries universal skip heuristics (`[class*="skip" i]`, `[id*="skip" i]`, `[aria-label*="skip" i]`, text "Skip", "ข้าม") and triggers click events.
3. Sends message to background service worker via `chrome.runtime?.sendMessage({ type: 'VIDEO_AD_SKIPPED' })` to increment user statistics.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/video-blocker.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content-scripts/video-blocker.js tests/video-blocker.test.js
git commit -m "feat: implement dual video ad blocker for youtube and universal html5 players"
```

---

### Task 6: Background Service Worker, State Management & Badge Counter

**Files:**
- Create: `background/service-worker.js`
- Test: `tests/service-worker.test.js`

**Interfaces:**
- Consumes: Messages `{ type: 'AD_BLOCKED' | 'VIDEO_AD_SKIPPED' | 'ANTI_ADBLOCK_DEFUSED' }` from content scripts.
- Produces:
  - Local storage state management (`enabled`, `stats`).
  - Badge text updates (`chrome.action.setBadgeText`).
  - Dynamic ruleset toggling (`chrome.declarativeNetRequest.updateEnabledRulesets`).

- [ ] **Step 1: Write test for background service worker message handling and storage**

```javascript
// tests/service-worker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

// Mock chrome API
const mockStorage = {
  data: {
    enabled: true,
    stats: { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 }
  },
  get(keys, cb) { cb({ ...this.data }); },
  set(items, cb) { Object.assign(this.data, items); if (cb) cb(); }
};

test('service-worker increments counters on content script notifications', async () => {
  const { handleMessage } = await import('../background/service-worker-logic.js');

  const res1 = await handleMessage({ type: 'VIDEO_AD_SKIPPED' }, mockStorage);
  assert.equal(res1.stats.videoAdsSkipped, 1);

  const res2 = await handleMessage({ type: 'AD_BLOCKED' }, mockStorage);
  assert.equal(res2.stats.bannersBlocked, 1);

  const res3 = await handleMessage({ type: 'ANTI_ADBLOCK_DEFUSED' }, mockStorage);
  assert.equal(res3.stats.antiAdblockDefused, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/service-worker.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `background/service-worker-logic.js` and `background/service-worker.js`**

Implement message listener updating `chrome.storage.local`, updating badge text with total blocked count, and enabling/disabling `ad_rules` ruleset based on extension status.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/service-worker.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background/ tests/service-worker.test.js
git commit -m "feat: implement background service worker for storage and badge counter"
```

---

### Task 7: Popup User Interface & Master Toggle

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`
- Test: `tests/popup.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local` (from Task 6)
- Produces: Popup dashboard with real-time statistics display and toggle switch.

- [ ] **Step 1: Write test for popup logic and DOM bindings**

```javascript
// tests/popup.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
const popupJs = fs.readFileSync('popup/popup.js', 'utf8');

test('popup initializes with stored metrics and handles toggle switch', () => {
  const dom = new JSDOM(popupHtml, { runScripts: "dangerously" });
  
  // Provide mock chrome.storage
  dom.window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({
          enabled: true,
          stats: { bannersBlocked: 42, videoAdsSkipped: 12, antiAdblockDefused: 5 }
        }),
        set: (items, cb) => { if (cb) cb(); }
      }
    },
    runtime: {
      sendMessage: () => {}
    }
  };

  dom.window.eval(popupJs);

  assert.equal(dom.window.document.getElementById('banners-count').textContent, '42');
  assert.equal(dom.window.document.getElementById('videos-count').textContent, '12');
  assert.equal(dom.window.document.getElementById('defused-count').textContent, '5');
  assert.equal(dom.window.document.getElementById('toggle-switch').checked, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/popup.test.js`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `popup/popup.html`, `popup/popup.css`, and `popup/popup.js`**

Create a modern, clean UI with:
- Extension Logo & Title
- Status Badge (Active / Paused)
- Master Toggle Switch (On / Off)
- Grid Cards for Metrics:
  - Banners Blocked
  - Videos Skipped
  - Anti-Adblock Defused
- Clean CSS styling with smooth transitions, dark-mode support, and responsive card layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/popup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add popup/ tests/popup.test.js
git commit -m "feat: implement popup dashboard with metrics and master toggle"
```

---

### Task 8: Full End-to-End Test Suite & Packaging Verification

**Files:**
- Create: `tests/e2e-simulation.test.js`
- Test: Run full test suite across all tasks

**Interfaces:**
- Consumes: All modules from Tasks 1-7
- Produces: Verified complete Chrome Extension ready for loading into Google Chrome (`chrome://extensions`).

- [ ] **Step 1: Write integration test simulating complete page load with ads and anti-adblock**

```javascript
// tests/e2e-simulation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('verify complete project structure for Chrome extension unpack loading', () => {
  const requiredFiles = [
    'manifest.json',
    'rules/ad-rules.json',
    'surrogates/adsbygoogle.js',
    'surrogates/prebid.js',
    'content-scripts/defuser-main.js',
    'content-scripts/defuser-isolated.js',
    'content-scripts/cosmetic-filter.js',
    'content-scripts/cosmetic.css',
    'content-scripts/video-blocker.js',
    'background/service-worker.js',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png'
  ];

  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(file), `Missing required extension file: ${file}`);
  }
});
```

- [ ] **Step 2: Run all project tests**

Run: `node --test tests/*.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-simulation.test.js
git commit -m "test: add e2e extension packaging and structure verification test"
```
