# Design Document: Chrome Extension AdBlocker (Dual-Layer Engine + Anti-Adblock Stealth Defuser)

- **Date:** 2026-11-07
- **Target Platform:** Google Chrome Extension (Manifest V3)
- **Document Path:** `docs/superpowers/specs/2026-11-07-chrome-adblock-design.md`
- **Status:** Complete / Approved for Planning

---

## 1. Intent & The "Why"
Users require a Google Chrome Extension capable of:
1. Blocking display banner ads and intrusive network trackers.
2. Automatically bypassing/skipping in-stream video ads (YouTube pre-rolls, mid-rolls, and embedded HTML5 video player ads across streaming sites).
3. **Evading Anti-Adblock Detection:** Preventing websites from locking users out with anti-adblock warning walls, anti-adblock scripts, or disabled page scrolling.

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals
- **Network-Level Interception:** Block requests to known ad networks and tracking servers using Chrome's `declarativeNetRequest` API.
- **Anti-Adblock Stealth & Defuser (Detection Evasion):**
  - **Surrogate Redirection:** Redirect anti-adblock bait scripts (e.g. `adsbygoogle.js`, `prebid.js`) to local surrogate stub files via `declarativeNetRequest`, returning HTTP 200 with dummy objects so detection scripts believe ads loaded successfully.
  - **Early Main-World Stubs (`world: "MAIN"`):** Inject a lightweight script at `document_start` to set standard ad objects (`window.canRunAds = true`, `window.isAdBlockActive = false`, `window.adsbygoogle = []`).
  - **Modal Defuser & Scroll Restoration:** Detect anti-adblock overlays/paywalls (`[id*="adblock" i]`, `[class*="adblock" i]`, `.tp-backdrop`), dismiss/remove them, and restore `document.body.style.overflow = "auto"`.
- **Cosmetic DOM Filtering:** Hide banner containers and ad widgets (`iframe[src*="doubleclick"]`, `ins.adsbygoogle`, `.ad-banner`) without triggering zero-height bait traps.
- **Dedicated YouTube Ad-Skipping Engine:** Reliably detect YouTube ad overlays and video ad states (`.ad-showing`), immediately fast-forward (16x speed), mute audio, jump playback time to video duration, and auto-click the "Skip Ad" button within milliseconds.
- **Universal HTML5 Player Engine:** Inspect all `<video>` elements across top-level pages and embedded iframes (`all_frames: true`). Detect ad attributes/containers, neutralize in-stream video ads, and auto-click generic skip elements across various streaming player frameworks.
- **Anti-Popunder / Click-Hijacking Protection:** Intercept click hijacking on streaming video players (transparent overlay anchors redirecting to affiliate/ad sites).
- **User Controls & Popup UI:** Modern popup with master toggle and live metrics (Banners Blocked, Video Ads Skipped, Anti-Adblock Bypassed).

### Non-Goals
- Full adblock filter list compiler replicating uBlock Origin's entire 300,000+ regex rule engine in JavaScript (we leverage Manifest V3 declarative rulesets with high-frequency ad domains and surrogates to maintain optimal performance and memory footprint).
- Server-side ad-injection decryption (e.g. Twitch server-side ad stitching requiring dedicated proxy streams).

### Anti-Goals
- **Do not break video playback:** Never hard-block video streams in a way that causes media player errors (e.g., video player crashing with an unhandled exception or spinning wheel).
- **Do not trigger anti-adblock traps:** Avoid indiscriminate CSS hiding on empty decoy bait elements that trigger height/visibility checks.
- **Do not degrade page performance:** Content script observers must use batched MutationObserver processing and debounce logic, avoiding continuous high-CPU loops.

---

## 3. Constraints
- **Chrome Extension Manifest V3 Compliance:** Must operate under Manifest V3 specifications (service worker background script, `declarativeNetRequest` for network filtering, content scripts with well-scoped permissions).
- **Multi-Frame Support:** Streaming sites heavily rely on cross-domain and same-origin `<iframe>` embeds. Content scripts must inject into `all_frames: true` with `match_about_blank: true`.
- **Browser Autoplay & Audio Policies:** Media muting and speed changes must be handled through standard `HTMLMediaElement` properties without triggering browser permission errors.

---

## 4. Approaches Considered

### Approach 1: Dual-Layer Engine + Stealth Defusers (Network Ruleset + Universal Adaptive Player Watcher + Surrogates) *(SELECTED)*
- **Description:** Combines `declarativeNetRequest` for known ad networks/trackers with local surrogate redirects for decoy scripts, content script DOM filtering, an anti-adblock overlay remover, and a dedicated dual video observer (specialized YouTube hooks + universal HTML5 video heuristic skipper).
- **Pros:** Maximum compatibility, bypasses adblock walls, ultra-fast response time, does not trigger player fatal errors, lightweight memory usage.
- **Trade-offs:** Requires maintaining a set of standard surrogate stubs (`adsbygoogle.js`, `prebid.js`) and universal heuristic selectors.
- **Selection Reason:** Directly meets the user's requirements for YouTube, universal streaming players, banner blocking, AND anti-adblock evasion.

### Approach 2: Deep Script Injection & API Monkey-Patching (Main World Only)
- **Description:** Injects scripts into the page's main JS context (`world: "MAIN"`) to monkey-patch `HTMLMediaElement.prototype.play`, `window.google.ima`, and player SDK prototypes.
- **Pros:** Intercepts ads before player initialization code runs.
- **Trade-offs:** High risk of breaking streaming players on sites with strict CSP or DRM; ad SDK failures frequently cause custom player scripts to fail completely and halt the video.

### Approach 3: Heuristic DOM Only (Content Script Only)
- **Description:** Only runs content scripts without network-level blocking.
- **Pros:** Fewer permissions requested.
- **Trade-offs:** Fails to prevent network traffic waste, banners flicker before being hidden, easily trapped by anti-adblock network checks.

---

## 5. Architectural Components & Detailed Design

```
adblock/
├── manifest.json                  # Manifest V3 specification
├── background/
│   └── service-worker.js          # State management, badge counter, declarativeNetRequest toggling
├── rules/
│   └── ad-rules.json              # DeclarativeNetRequest ruleset (blocking + surrogate redirects)
├── surrogates/                    # Benign stubs to defuse anti-adblock script loading tests
│   ├── adsbygoogle.js             # Stub for Google AdSense decoy checks
│   └── prebid.js                  # Stub for header bidding checks
├── content-scripts/
│   ├── defuser-main.js            # Main-world script (world: "MAIN", run_at: "document_start") to stub window.canRunAds
│   ├── defuser-isolated.js        # Isolated-world script to dismiss anti-adblock modals & restore scroll
│   ├── cosmetic-filter.js         # Banner ad hiding and popunder interception
│   ├── cosmetic.css               # Static CSS rules for common ad selectors
│   └── video-blocker.js           # YouTube + Universal HTML5 video ad skipper & fast-forwarder
├── popup/
│   ├── popup.html                 # Extension popup interface
│   ├── popup.css                  # Popup styling (modern dark/light clean aesthetic)
│   └── popup.js                   # Toggle switch and blocked counter metrics
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Component Details:
1. **`rules/ad-rules.json` & `surrogates/`:**
   - Blocks major ad distribution networks (DoubleClick, Taboola, Outbrain, PopAds, Adsterra, PropellerAds, Video VAST beacons, etc.).
   - Uses `declarativeNetRequest` redirection rule type: requests to `/pagead/js/adsbygoogle.js` redirect to `/surrogates/adsbygoogle.js`, fulfilling the HTTP request with status 200 and harmless dummy objects.
2. **`content-scripts/defuser-main.js` & `defuser-isolated.js`:**
   - `defuser-main.js` (`world: "MAIN"`, `run_at: "document_start"`): Stubs detection flags: `window.canRunAds = true; window.isAdBlockActive = false; window.adsbygoogle = window.adsbygoogle || [];`.
   - `defuser-isolated.js`: Observes DOM for anti-adblock modals (e.g. `[id*="adblock" i]`, `[class*="adblock" i]`, `[class*="tp-backdrop"]`) and removes them, restoring `document.body.style.overflow = "auto"` and `pointer-events = "auto"`.
3. **`content-scripts/cosmetic-filter.js` & `cosmetic.css`:**
   - Injects high-efficiency CSS selectors hiding banners (`.ad-banner`, `[id^="google_ads"]`, `.ad-container`, etc.).
   - Intercepts popunder click events attached to video wrappers before new tabs spawn.
4. **`content-scripts/video-blocker.js`:**
   - **YouTube Handler:**
     - Observes `.html5-video-player`.
     - When `ad-showing` or `ad-interrupting` class is present:
       - Mutes the active video element (`video.muted = true`).
       - Sets `video.playbackRate = 16.0`.
       - Jumps `video.currentTime = video.duration` if duration is finite.
       - Immediately queries and clicks: `.ytp-ad-skip-button`, `.ytp-ad-skip-button-modern`, `.ytp-skip-ad-button`, `.ytp-ad-overlay-close-button`.
   - **Universal HTML5 Video Handler:**
     - Traverses all `<video>` elements in top window and iframes.
     - Detects ad flags (e.g. `isAd`, duration <= 30 seconds accompanied by ad overlays, or video source matching ad patterns).
     - Speeds up, mutes, and triggers click events on elements matching universal skip heuristics:
       - `[class*="skip" i], [id*="skip" i], [aria-label*="skip" i]`
       - Buttons containing text "Skip", "ข้าม", "Skip Ad", "Close Ad".
5. **`background/service-worker.js` & `popup/`:**
   - Listens to messages from content scripts whenever an ad is blocked, video ad skipped, or anti-adblock defused; increments counters and updates the badge.
   - Provides full toggle control to pause/resume extension functionality.

---

## 6. What's Left to the Builder
- Precise curation of the top ad-network domains in `ad-rules.json`.
- Fine-tuning the universal skip selector queries and debouncing timers.
- Icon generation (SVG/Canvas to PNG generator script or clean modern vector assets).
- Testing on standard YouTube, embedded YouTube players, and representative HTML5 streaming players.
