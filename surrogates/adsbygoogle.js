// surrogates/adsbygoogle.js
// Safe surrogate stub for Google AdSense to defuse anti-adblock detection
(function () {
  'use strict';
  window.adsbygoogle = window.adsbygoogle || [];
  window.adsbygoogle.loaded = true;
  window.adsbygoogle.push = function (obj) {
    if (typeof obj === 'object' && obj !== null) {
      if (typeof obj.onload === 'function') {
        try { obj.onload(); } catch (e) {}
      }
    }
    return Array.prototype.push.call(window.adsbygoogle, obj);
  };
})();
