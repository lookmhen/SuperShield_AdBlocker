// content-scripts/defuser-isolated.js
// Runs in world: "ISOLATED" to remove anti-adblock modal overlays and restore scrollability
(function () {
  'use strict';

  const ANTI_ADBLOCK_SELECTORS = [
    '#adblock-modal-overlay',
    '.adblock-warning-popup',
    '[id*="adblock-modal" i]',
    '[class*="adblock-modal" i]',
    '[id*="adblock-notice" i]',
    '[class*="adblock-notice" i]',
    '[id*="adblock-overlay" i]',
    '[class*="adblock-overlay" i]',
    '[class*="tp-backdrop"]',
    '[class*="tp-modal"]',
    '.fc-ab-root',
    '#framer-adblock-modal'
  ];

  function dismissModals() {
    let defusedCount = 0;
    for (const selector of ANTI_ADBLOCK_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        try {
          el.remove();
          defusedCount++;
        } catch (e) {}
      }
    }

    // Restore body & html scroll if locked by anti-adblock
    if (document.documentElement && document.documentElement.style.overflow === 'hidden') {
      document.documentElement.style.setProperty('overflow', 'auto', 'important');
    }
    if (document.body && document.body.style.overflow === 'hidden') {
      document.body.style.setProperty('overflow', 'auto', 'important');
    }

    if (defusedCount > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'ANTI_ADBLOCK_DEFUSED', count: defusedCount });
      } catch (err) {}
    }
  }

  // Run immediately
  dismissModals();

  // Also run on DOMContentLoaded and observe mutations
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dismissModals);
  }

  // Throttle mutation observer
  let timeoutId = null;
  const observer = new MutationObserver(() => {
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        dismissModals();
      }, 100);
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
})();
