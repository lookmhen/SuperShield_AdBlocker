// content-scripts/cosmetic-filter.js
// Runs in world: "ISOLATED" to intercept popunders and clean up empty ad spaces
(function () {
  'use strict';

  let isEnabled = true;

  // Sync extension enabled state
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('enabled', (data) => {
      if (data && data.enabled !== undefined) {
        isEnabled = data.enabled;
      }
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.enabled) {
        isEnabled = changes.enabled.newValue;
      }
    });
  }

  const KNOWN_AD_DOMAINS = [
    'popads.net',
    'propellerads.com',
    'adsterra.com',
    'betting',
    'malicious-tracker.ad'
  ];

  // Intercept click hijacking and popunders (strictly around video elements)
  document.addEventListener(
    'click',
    function (event) {
      if (!isEnabled) return;

      const target = event.target;
      if (!target) return;

      // Check if clicked element is an anchor or is inside an anchor
      const link = target.closest('a');
      if (link && link.href) {
        // Must be directly over or associated with a video element
        const isNearVideo = Boolean(
          link.closest('.video-player-container, [class*="player"], [id*="player"]') ||
          link.querySelector('video') ||
          (link.parentElement && link.parentElement.querySelector('video'))
        );

        if (!isNearVideo) {
          // Never block normal links outside of video containers
          return;
        }

        let linkHostname = '';
        try {
          const url = new URL(link.href, window.location.href);
          linkHostname = url.hostname.toLowerCase();
        } catch (e) {
          return;
        }

        const isKnownAdDomain = KNOWN_AD_DOMAINS.some(domain => linkHostname.includes(domain));
        const isBlankPopunder = link.target === '_blank' && linkHostname !== window.location.hostname;

        if (isKnownAdDomain || isBlankPopunder) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          // Remove the fake transparent overlay if present
          if (link.style.position === 'absolute' || link.style.position === 'fixed') {
            try { link.remove(); } catch (e) {}
          }

          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: 1 }).catch(() => {});
          }
          return false;
        }
      }
    },
    true // Capture phase to intercept before site listeners
  );
})();
