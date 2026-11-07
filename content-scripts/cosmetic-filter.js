// content-scripts/cosmetic-filter.js
// Runs in world: "ISOLATED" to actively scan/hide banners, intercept popunders/fake play overlays, and report blocked stats
(function () {
  'use strict';

  const KNOWN_AD_DOMAINS = [
    'popads.net',
    'propellerads.com',
    'adsterra.com',
    'betting',
    'malicious-tracker.ad',
    'cutt.ly',
    '1xbet',
    'ufabet'
  ];

  const BANNER_SELECTORS = [
    'a[href*="1xbet" i]',
    'a[href*="cutt.ly" i]',
    'a[href*="ufabet" i]',
    'a[href*="bet365" i]',
    'a[href*="sbobet" i]',
    'a[href*="pgslot" i]',
    'a[href*="baccarat" i]',
    'a[href*="slotxo" i]',
    'a[href*="slot888" i]',
    '.ad-banner',
    '.advertisement',
    '.sponsor-banner',
    '.floating-ad',
    '.sticky-ad',
    '[id^="google_ads_"]',
    '[id^="div-gpt-ad-"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adnxs.com"]',
    'iframe[src*="smartadserver.com"]'
  ];

  let isEnabled = true;

  function setExtensionState(active) {
    isEnabled = Boolean(active);
    if (document.documentElement) {
      if (active) {
        document.documentElement.setAttribute('data-supershield-active', 'true');
        document.documentElement.removeAttribute('data-supershield-disabled');
      } else {
        document.documentElement.removeAttribute('data-supershield-active');
        document.documentElement.setAttribute('data-supershield-disabled', 'true');
      }
    }
  }

  function unhideAllBlocked() {
    const hiddenElements = document.querySelectorAll('[data-supershield-hidden]');
    for (const el of hiddenElements) {
      el.removeAttribute('data-supershield-hidden');
      el._supershieldHidden = false;
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('height');
      el.style.removeProperty('pointer-events');
    }
  }

  function scanAndHideBanners() {
    if (!isEnabled) return;
    let newlyBlocked = 0;

    for (const selector of BANNER_SELECTORS) {
      let elements = [];
      try {
        elements = document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }

      for (const el of elements) {
        if (!el || el._supershieldHidden) continue;

        let shouldHide = true;
        if (el.tagName === 'A') {
          const href = (el.href || '').toLowerCase();
          const matchesAd = KNOWN_AD_DOMAINS.some(d => href.includes(d)) ||
                            href.includes('1xbet') || href.includes('cutt.ly') ||
                            href.includes('ufabet') || href.includes('bet365');
          if (!matchesAd) {
            shouldHide = false;
          }
        }

        if (shouldHide) {
          el._supershieldHidden = true;
          try {
            el.setAttribute('data-supershield-hidden', 'true');
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('height', '0px', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            newlyBlocked++;

            const parent = el.parentElement;
            if (parent && parent.tagName === 'DIV' && !parent._supershieldHidden) {
              const parentText = (parent.textContent || '').trim();
              if (parentText === '' || parent.id.includes('banner') || parent.className.includes('banner')) {
                parent._supershieldHidden = true;
                parent.setAttribute('data-supershield-hidden', 'true');
                parent.style.setProperty('display', 'none', 'important');
              }
            }
          } catch (err) {}
        }
      }
    }

    if (newlyBlocked > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: newlyBlocked }).catch(() => {});
    }
  }

  function updateEnabledState(active) {
    setExtensionState(active);
    if (active) {
      scanAndHideBanners();
    } else {
      unhideAllBlocked();
    }
  }

  // Sync extension enabled state
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('enabled', (data) => {
      const active = data && data.enabled !== undefined ? data.enabled : true;
      updateEnabledState(active);
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.enabled !== undefined) {
        updateEnabledState(changes.enabled.newValue);
      }
    });

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'SET_ENABLED') {
          updateEnabledState(msg.enabled);
        }
      });
    }
  } else {
    // Non-extension test environments
    updateEnabledState(true);
  }

  // Intercept click hijacking, fake play overlays, and popunders
  document.addEventListener(
    'click',
    function (event) {
      if (!isEnabled) return;

      const target = event.target;
      if (!target) return;

      // 1. Check for Fake Play Button / Transparent Click-Jacking Overlays on top of video
      const playerContainer = target.closest('.video-container, .video-player-container, [class*="player"], [id*="player"]');
      if (playerContainer) {
        const video = playerContainer.querySelector('video');
        if (video) {
          // Check if clicked element is an overlay sitting on top of the video
          const overlay = target.closest(
            '[class*="play-overlay" i], [id*="play-overlay" i], ' +
            '[class*="player-overlay" i], [id*="player-overlay" i], ' +
            '[class*="fake-play" i], [class*="ad-overlay" i], ' +
            '[class*="overlay" i]'
          ) || (target !== video && (target.style.position === 'absolute' || target.style.position === 'fixed') ? target : null);

          if (overlay && overlay !== video && !video.contains(overlay)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            // Disarm and remove the overlay blocker
            try { overlay.remove(); } catch (e) {}

            // Trigger the real video to play!
            try {
              const playPromise = video.play();
              if (playPromise !== undefined) {
                playPromise.catch(() => {});
              }
            } catch (err) {}

            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: 1 }).catch(() => {});
            }
            return false;
          }
        }
      }

      // 2. Check for anchor links pointing to ad networks or popunders near video
      const link = target.closest('a');
      if (link && link.href) {
        const isNearVideo = Boolean(
          playerContainer ||
          link.querySelector('video') ||
          (link.parentElement && link.parentElement.querySelector('video'))
        );

        if (!isNearVideo) return;

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

          if (link.style.position === 'absolute' || link.style.position === 'fixed') {
            try { link.remove(); } catch (e) {}
          }

          if (playerContainer) {
            const video = playerContainer.querySelector('video');
            if (video && typeof video.play === 'function') {
              try { video.play(); } catch (err) {}
            }
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

  // Expose scan function for testing / manual triggering
  if (typeof window !== 'undefined') {
    window.scanAndHideBanners = scanAndHideBanners;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isEnabled) scanAndHideBanners();
    });
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (!isEnabled) return;
    if (!debounceTimer) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isEnabled) scanAndHideBanners();
      }, 100);
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
