// surrogates/prebid.js
// Safe surrogate stub for Prebid / header bidding to defuse anti-adblock detection
(function () {
  'use strict';
  window.pbjs = window.pbjs || {};
  window.pbjs.que = window.pbjs.que || [];
  
  // Immediately execute any callbacks pushed to the queue
  window.pbjs.que.push = function (fn) {
    if (typeof fn === 'function') {
      try { fn(); } catch (e) {}
    }
    return Array.prototype.push.call(window.pbjs.que, fn);
  };

  window.pbjs.processQueue = function () {};
  window.pbjs.requestBids = function (cfg) {
    if (cfg && typeof cfg.bidsBackHandler === 'function') {
      try { cfg.bidsBackHandler(); } catch (e) {}
    }
  };
})();
