// content-scripts/defuser-main.js
// Runs in world: "MAIN" at document_start to defeat JS-based anti-adblock detection
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

  // 2. Stub Google AdSense and GPT objects on window
  if (!window.adsbygoogle) {
    const dummyAdsByGoogle = [];
    dummyAdsByGoogle.loaded = true;
    dummyAdsByGoogle.push = function (obj) {
      if (typeof obj === 'object' && obj !== null) {
        if (typeof obj.onload === 'function') {
          try { obj.onload(); } catch (err) {}
        }
      }
      return 0;
    };
    try {
      window.adsbygoogle = dummyAdsByGoogle;
    } catch (e) {}
  }

  // 3. Stub googletag
  if (!window.googletag) {
    try {
      window.googletag = {
        cmd: [],
        pubads: () => ({
          addEventListener: () => {},
          enableSingleRequest: () => {},
          collapseEmptyDivs: () => {},
          setTargeting: () => {},
          clearTargeting: () => {}
        }),
        enableServices: () => {},
        display: () => {},
        defineSlot: () => ({
          addService: function () { return this; },
          setTargeting: function () { return this; }
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
})();
