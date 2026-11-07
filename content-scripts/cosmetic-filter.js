// content-scripts/cosmetic-filter.js
// Runs in world: "ISOLATED" to intercept popunders and clean up empty ad spaces
(function () {
  'use strict';

  const SUSPICIOUS_DOMAINS = [
    'malicious-tracker.ad',
    'popads',
    'propellerads',
    'adsterra',
    'betting',
    'track',
    'click',
    'affiliate',
    'redirect'
  ];

  // Intercept click hijacking and popunders (especially around video elements)
  document.addEventListener(
    'click',
    function (event) {
      const target = event.target;
      if (!target) return;

      // Check if clicked element is an anchor or is inside an anchor
      const link = target.closest('a');
      if (link && link.href) {
        const href = link.href.toLowerCase();
        
        // Check if anchor is placed on top of a video container
        const isNearVideo = Boolean(
          link.closest('.video-player-container, [class*="player"], [id*="player"]') ||
          link.querySelector('video') ||
          (link.parentElement && link.parentElement.querySelector('video'))
        );

        const isSuspicious = SUSPICIOUS_DOMAINS.some(domain => href.includes(domain));
        const isBlankPopunder = link.target === '_blank' && isNearVideo;

        if (isSuspicious || (isNearVideo && isBlankPopunder && href.startsWith('http'))) {
          // Verify if it is not navigating within the same origin host
          try {
            const url = new URL(link.href, window.location.href);
            if (url.hostname !== window.location.hostname || isSuspicious) {
              event.preventDefault();
              event.stopPropagation();
              event.stopImmediatePropagation();

              // Remove the fake transparent overlay if present
              if (link.style.position === 'absolute' || link.style.position === 'fixed') {
                link.remove();
              }

              if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                try {
                  chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: 1 });
                } catch (e) {}
              }
              return false;
            }
          } catch (e) {}
        }
      }
    },
    true // Capture phase to intercept before site listeners
  );
})();
