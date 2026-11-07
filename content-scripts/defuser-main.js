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

  // 4. Wrap window.open to disarm ad popups and streaming popunders
  try {
    const origOpen = window.open;
    const AD_POPUP_PATTERNS = [
      '1xbet', 'cutt.ly', 'ufabet', 'bet365', 'sbobet', 'pgslot',
      'popads', 'propeller', 'adsterra', 'betting', 'affiliate',
      'casino', 'baccarat', 'slotxo', 'slot888'
    ];

    window.open = function (url, target, features) {
      if (typeof url === 'string') {
        const lowerUrl = url.toLowerCase();
        const isAdPopup = AD_POPUP_PATTERNS.some(p => lowerUrl.includes(p));
        if (isAdPopup) {
          return null; // Block popunder / ad tab
        }
      }
      if (typeof origOpen === 'function') {
        return origOpen.call(window, url, target, features);
      }
      return null;
    };
  } catch (e) {}
})();
