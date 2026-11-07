// content-scripts/defuser-main.js
// Runs in world: "MAIN" at document_start to defeat JS-based anti-adblock detection and block ad popunders
(function () {
  'use strict';

  // 1. Stub common global anti-adblock probe flags
  try {
    Object.defineProperty(window, 'canRunAds', {
      get: () => true,
      set: () => {},
      configurable: true
    });

    Object.defineProperty(window, 'isAdBlockActive', {
      get: () => false,
      set: () => {},
      configurable: true
    });

    Object.defineProperty(window, 'adblockDetected', {
      get: () => false,
      set: () => {},
      configurable: true
    });

    Object.defineProperty(window, 'hasAdblocker', {
      get: () => false,
      set: () => {},
      configurable: true
    });
  } catch (e) {}

  // 2. Stub Google AdSense objects on window
  if (!window.adsbygoogle) {
    const dummyAdsByGoogle = [];
    dummyAdsByGoogle.loaded = true;
    dummyAdsByGoogle.push = function (obj) {
      if (typeof obj === 'object' && obj !== null) {
        if (typeof obj.onload === 'function') {
          try { obj.onload(); } catch (err) {}
        }
      }
      return Array.prototype.push.call(dummyAdsByGoogle, obj);
    };
    try {
      window.adsbygoogle = dummyAdsByGoogle;
    } catch (e) {}
  }

  // 3. Stub googletag with fully chainable methods
  if (!window.googletag) {
    const pubadsInstance = {
      addEventListener: function () { return this; },
      enableSingleRequest: function () { return this; },
      collapseEmptyDivs: function () { return this; },
      setTargeting: function () { return this; },
      clearTargeting: function () { return this; },
      setCategoryExclusion: function () { return this; },
      refresh: function () { return this; }
    };

    try {
      window.googletag = {
        cmd: [],
        pubads: () => pubadsInstance,
        enableServices: () => {},
        display: () => {},
        defineSlot: () => ({
          addService: function () { return this; },
          setTargeting: function () { return this; },
          setCollapseEmptyDiv: function () { return this; }
        })
      };
      window.googletag.cmd.push = function (fn) {
        if (typeof fn === 'function') {
          try { fn(); } catch (err) {}
        }
        return 1;
      };
    } catch (e) {}
  }

  // 4. Player interaction tracking for context-aware popunder defusing
  let lastPlayerInteractionTime = 0;

  function isPlayerElement(el) {
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(
        'video, iframe, .video-container, .player-container, .video-player-container, .player-wrapper, ' +
        '.jwplayer, .video-js, .plyr, .clappr, .dplayer, .flowplayer, ' +
        '[class*="player" i], [id*="player" i], [class*="video" i], [id*="video" i]'
      )
    );
  }

  const recordPlayerAction = (e) => {
    if (isPlayerElement(e.target)) {
      lastPlayerInteractionTime = Date.now();
    }
  };

  try {
    window.addEventListener('pointerdown', recordPlayerAction, true);
    window.addEventListener('mousedown', recordPlayerAction, true);
    window.addEventListener('contextmenu', recordPlayerAction, true);
    window.addEventListener('click', recordPlayerAction, true);
  } catch (e) {}

  // 5. Wrap window.open to disarm ad popups, blank popunders, and rogue redirects
  const AD_POPUP_PATTERNS = [
    '1xbet', 'cutt.ly', 'ufabet', 'bet365', 'sbobet', 'pgslot',
    'popads', 'propeller', 'adsterra', 'betting', 'affiliate',
    'casino', 'baccarat', 'slotxo', 'slot888', 'popcash', 'exoclick',
    'juicyads', 'trafficjunky', 'hilltopads', 'clickadu', 'admaven',
    'monetag', 'wpadmngr', 'syndication', 'doubleclick', 'adnxs'
  ];

  function isSuspiciousPopupUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.trim().toLowerCase();
    if (lower === '' || lower === 'about:blank' || lower === 'about:srcdoc' || lower === 'javascript:void(0)') {
      return true;
    }
    if (AD_POPUP_PATTERNS.some(p => lower.includes(p))) {
      return true;
    }
    return false;
  }

  function isCrossOriginUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return false;
    try {
      const parsed = new URL(trimmed, window.location.href);
      return parsed.origin !== window.location.origin;
    } catch (e) {
      return true;
    }
  }

  function createDummyWindow() {
    return {
      closed: false,
      focus: () => {},
      blur: () => {},
      close: function () { this.closed = true; },
      location: {
        _href: '',
        get href() { return this._href; },
        set href(val) {
          if (isSuspiciousPopupUrl(val) || isCrossOriginUrl(val)) {
            return;
          }
          this._href = val;
        },
        replace: () => {},
        assign: () => {}
      },
      document: {
        write: () => {},
        writeln: () => {},
        open: function () { return this; },
        close: () => {},
        createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {} }),
        body: { appendChild: () => {} }
      }
    };
  }

  try {
    const origOpen = window.open;

    window.open = function (url, target, features) {
      const isPlayerActionRecent = (Date.now() - lastPlayerInteractionTime) < 2500;

      // Handle blank / empty popunders (e.g. window.open('about:blank'))
      if (!url || url === '' || url === 'about:blank' || url === 'about:srcdoc') {
        return createDummyWindow();
      }

      if (typeof url === 'string') {
        const lowerUrl = url.toLowerCase();
        const isAdPopup = AD_POPUP_PATTERNS.some(p => lowerUrl.includes(p));
        if (isAdPopup) {
          return null; // Block popunder / ad tab
        }

        // Block cross-origin popups triggered during player interaction
        if (isPlayerActionRecent && isCrossOriginUrl(url)) {
          return createDummyWindow();
        }
      }

      if (typeof origOpen === 'function') {
        return origOpen.call(window, url, target, features);
      }
      return createDummyWindow();
    };
  } catch (e) {}

  // 6. Wrap HTMLAnchorElement.prototype.click to block programmatic click hijacking
  try {
    if (typeof HTMLAnchorElement !== 'undefined' && HTMLAnchorElement.prototype) {
      const origAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        const href = (this.href || '').trim();
        const target = (this.target || '').toLowerCase();
        const isPlayerActionRecent = (Date.now() - lastPlayerInteractionTime) < 2500;
        
        if (isSuspiciousPopupUrl(href) || (isPlayerActionRecent && (target === '_blank' || isCrossOriginUrl(href)))) {
          return; // Block programmatic popunder anchor click
        }
        return origAnchorClick.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 7. YouTube ad defusing: sanitize player payloads and skip native movie_player ads
  function sanitizeYtPlayerResponse(data) {
    if (!data || typeof data !== 'object') return data;
    try {
      if ('adPlacements' in data) delete data.adPlacements;
      if ('playerAds' in data) delete data.playerAds;
      if ('adSlots' in data) delete data.adSlots;
      if ('adBreakHeartbeatParams' in data) delete data.adBreakHeartbeatParams;
      if (data.playbackTracking && typeof data.playbackTracking === 'object') {
        delete data.playbackTracking.videostatsPlaybackUrl;
        delete data.playbackTracking.videostatsDelayplayUrl;
        delete data.playbackTracking.videostatsWatchtimeUrl;
        delete data.playbackTracking.ptrackingUrl;
        delete data.playbackTracking.qoeUrl;
        delete data.playbackTracking.atrUrl;
      }
      if (data.playerResponse && typeof data.playerResponse === 'object') {
        sanitizeYtPlayerResponse(data.playerResponse);
      }
    } catch (e) {}
    return data;
  }

  function sanitizeYtBrowseData(data) {
    if (!data || typeof data !== 'object') return data;
    try {
      const richGrid = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.richGridRenderer;
      if (richGrid) {
        if (richGrid.masthead) delete richGrid.masthead;
        if (Array.isArray(richGrid.contents)) {
          richGrid.contents = richGrid.contents.filter(item => {
            if (!item || typeof item !== 'object') return true;
            return !item.richItemRenderer?.content?.adSlotRenderer &&
                   !item.adSlotRenderer;
          });
        }
      }
      if (data.masthead) delete data.masthead;
    } catch (e) {}
    return data;
  }

  // Intercept window.ytInitialPlayerResponse
  try {
    let _ytInitialPlayerResponse = sanitizeYtPlayerResponse(window.ytInitialPlayerResponse);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get: () => _ytInitialPlayerResponse,
      set: (val) => {
        _ytInitialPlayerResponse = sanitizeYtPlayerResponse(val);
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {}

  // Intercept window.ytInitialData for home feed & masthead ads
  try {
    let _ytInitialData = sanitizeYtBrowseData(window.ytInitialData);
    Object.defineProperty(window, 'ytInitialData', {
      get: () => _ytInitialData,
      set: (val) => {
        _ytInitialData = sanitizeYtBrowseData(val);
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {}

  // Intercept Response.prototype.json for YouTube SPA player requests
  try {
    if (typeof Response !== 'undefined' && Response.prototype && Response.prototype.json) {
      const origResponseJson = Response.prototype.json;
      Response.prototype.json = async function () {
        const result = await origResponseJson.apply(this, arguments);
        if (result && typeof result === 'object') {
          const url = (this && typeof this.url === 'string') ? this.url : '';
          if (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next') || result.adPlacements || result.playerAds) {
            sanitizeYtPlayerResponse(result);
          }
          if (url.includes('/youtubei/v1/browse') || result.contents?.twoColumnBrowseResultsRenderer) {
            sanitizeYtBrowseData(result);
          }
        }
        return result;
      };
    }
  } catch (e) {}

  // Intercept JSON.parse for YouTube player configs
  try {
    const origJsonParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const result = origJsonParse.apply(this, arguments);
      if (result && typeof result === 'object') {
        if (result.adPlacements || result.playerAds || result.adSlots) {
          sanitizeYtPlayerResponse(result);
        }
        if (result.contents?.twoColumnBrowseResultsRenderer || (result.richGridRenderer && result.richGridRenderer.masthead)) {
          sanitizeYtBrowseData(result);
        }
      }
      return result;
    };
  } catch (e) {}

  // Native movie_player ad skipper in world: "MAIN" (scoped to youtube.com)
  function skipMoviePlayerAd() {
    try {
      const player = document.getElementById('movie_player');
      if (!player) return;
      const adState = typeof player.getAdState === 'function' ? player.getAdState() : 0;
      const isAdShowing = adState > 0 || (player.classList && player.classList.contains('ad-showing'));
      if (isAdShowing) {
        if (typeof player.skipAd === 'function') {
          player.skipAd();
        }
        const video = player.querySelector('video');
        if (video) {
          video.muted = true;
          video.playbackRate = 16.0;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        }
      }
    } catch (e) {}
  }

  try {
    if (typeof window !== 'undefined' && window.location?.hostname?.includes('youtube.com')) {
      const ytTimer = setInterval(skipMoviePlayerAd, 250);
      if (ytTimer && typeof ytTimer.unref === 'function') {
        ytTimer.unref();
      }
    }
  } catch (e) {}
})();
