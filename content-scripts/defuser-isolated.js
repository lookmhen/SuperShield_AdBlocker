// content-scripts/defuser-isolated.js
// Runs in world: "ISOLATED" to remove anti-adblock modal overlays and restore scrollability
(function () {
  'use strict';

  let isEnabled = true;

  function isExtensionContextValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return true;
      const id = chrome.runtime.id;
      if (typeof chrome.runtime.getURL === 'function') {
        chrome.runtime.getURL('');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(message) {
    try {
      if (isExtensionContextValid() && typeof chrome.runtime?.sendMessage === 'function') {
        chrome.runtime.sendMessage(message).catch(() => {});
      }
    } catch (e) {}
  }

  function updateState(enabled) {
    isEnabled = Boolean(enabled);
    if (isEnabled) {
      dismissModals();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('enabled', (data) => {
      const active = data && data.enabled !== undefined ? data.enabled : true;
      updateState(active);
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.enabled !== undefined) {
        updateState(changes.enabled.newValue);
      }
    });

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'SET_ENABLED') {
          updateState(msg.enabled);
        }
      });
    }
  }

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
    '#framer-adblock-modal',
    'ytd-enforcement-message-view-model',
    'tp-yt-paper-dialog:has(#feedback.ytd-enforcement-message-view-model)'
  ];

  function dismissModals() {
    if (!isEnabled) return;
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

    // If YouTube modal was removed, resume video playback if paused
    const ytVideo = document.querySelector('#movie_player video');
    if (ytVideo && ytVideo.paused && defusedCount > 0) {
      try {
        ytVideo.play().catch(() => {});
      } catch (e) {}
    }

    if (defusedCount > 0) {
      safeSendMessage({ type: 'ANTI_ADBLOCK_DEFUSED', count: defusedCount });
    }
  }

  // Run initial modal check
  dismissModals();

  // Also run on DOMContentLoaded and observe mutations
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isEnabled && isExtensionContextValid()) dismissModals();
    });
  }

  // Throttle mutation observer
  let timeoutId = null;
  const observer = new MutationObserver(() => {
    if (!isExtensionContextValid()) {
      observer.disconnect();
      return;
    }
    if (!isEnabled) return;
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (isEnabled && isExtensionContextValid()) dismissModals();
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
