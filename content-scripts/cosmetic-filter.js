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

  function isLegitimatePlayerControl(el) {
    if (!el) return false;
    const cls = String(el.className || '') + ' ' + String(el.id || '');
    if (/jw-flag-ads|ad-container|video-ad|ad-overlay/i.test(cls)) return false;
    if (/vjs-control|vjs-button|jw-control|jw-display-icon|jw-icon|plyr__control|dplayer-controller|dplayer-icon|art-control/i.test(cls)) return true;
    if (/vjs-big-play|jw-icon-display|fp-play|dplayer-play|mejs__overlay-play/i.test(cls)) return true;
    if (el.tagName === 'VIDEO' || el.tagName === 'TRACK') return true;
    return false;
  }

  function findTrapOrOverlay(target) {
    if (!target || target === document.body || target === document.documentElement) return null;
    if (target.tagName === 'VIDEO' || isLegitimatePlayerControl(target)) return null;
    if (target._supershieldDisarmed) return { overlay: target, video: null, iframe: null };

    // 1. Inside a Player Container
    const playerContainer = target.closest(
      '.video-container, .video-player-container, .video-player-box, .player-wrapper, ' +
      '.jwplayer, .video-js, .plyr, .clappr, .dplayer, .flowplayer, ' +
      '[class*="player" i], [id*="player" i], [class*="video" i], [id*="video" i]'
    );

    if (playerContainer) {
      const video = playerContainer.querySelector('video');
      const iframe = playerContainer.querySelector('iframe');
      const mediaTarget = video || iframe;

      if (mediaTarget) {
        if (target === mediaTarget) return null;
        if (isLegitimatePlayerControl(target)) return null;

        const matchedOverlay = target.closest(
          '[class*="play" i], [id*="play" i], ' +
          '[class*="overlay" i], [id*="overlay" i], ' +
          '[class*="fake" i], [id*="fake" i], ' +
          '[class*="trap" i], [id*="trap" i], ' +
          '[class*="ad-" i], [id*="ad-" i], ' +
          '[class*="click" i], [id*="click" i]'
        ) || ((target.style.position === 'absolute' || target.style.position === 'fixed') ? target : null)
          || (target.tagName === 'A' ? target : null)
          || target;

        if (matchedOverlay && matchedOverlay !== mediaTarget && !mediaTarget.contains(matchedOverlay)) {
          return { overlay: matchedOverlay, video, iframe, playerContainer };
        }
      }
    }

    // 2. Full-page fixed/absolute click traps on body or outside player container
    const hasMediaOnPage = Boolean(document.querySelector('video, iframe'));
    if (hasMediaOnPage) {
      const isFixedOrAbsolute = target.style.position === 'fixed' || target.style.position === 'absolute';
      const isZIndexHigh = parseInt(target.style.zIndex || '0', 10) >= 10;
      const isTrapName = /trap|overlay|click|catcher|fake|pop|mask|backdrop/i.test((target.id || '') + ' ' + (target.className || ''));

      if (isFixedOrAbsolute && (isZIndexHigh || isTrapName)) {
        if (!target.querySelector('video, iframe')) {
          const video = document.querySelector('video');
          const iframe = document.querySelector('iframe');
          return { overlay: target, video, iframe, playerContainer: null };
        }
      }
    }

    // 3. Anchor links near media pointing to ad domains or blank popunders
    const link = target.closest('a');
    if (link && link.href) {
      const isNearVideo = Boolean(
        playerContainer ||
        link.querySelector('video, iframe') ||
        (link.parentElement && link.parentElement.querySelector('video, iframe'))
      );

      if (isNearVideo) {
        let linkHostname = '';
        try {
          const url = new URL(link.href, window.location.href);
          linkHostname = url.hostname.toLowerCase();
        } catch (e) {
          return null;
        }

        const isKnownAdDomain = KNOWN_AD_DOMAINS.some(domain => linkHostname.includes(domain));
        const isBlankPopunder = link.target === '_blank' && linkHostname !== window.location.hostname;

        if (isKnownAdDomain || isBlankPopunder) {
          const video = playerContainer ? playerContainer.querySelector('video') : document.querySelector('video');
          const iframe = playerContainer ? playerContainer.querySelector('iframe') : document.querySelector('iframe');
          return { overlay: link, video, iframe, playerContainer };
        }
      }
    }

    return null;
  }

  function handleOverlayEvent(event) {
    if (!isEnabled) return;
    const target = event.target;
    if (!target) return;

    const trapInfo = findTrapOrOverlay(target);
    if (trapInfo) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const { overlay, video, iframe } = trapInfo;
      if (overlay) {
        overlay._supershieldDisarmed = true;
        const killEvent = (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return false;
        };
        for (const ev of INTERCEPTED_MOUSE_EVENTS) {
          try {
            overlay.addEventListener(ev, killEvent, true);
          } catch (err) {}
        }
        try {
          overlay.remove();
        } catch (e) {
          try {
            overlay.style.setProperty('display', 'none', 'important');
            overlay.style.setProperty('pointer-events', 'none', 'important');
          } catch (err) {}
        }
      }

      // Trigger playback or activate iframe
      if (video) {
        try {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              video.muted = true;
              video.play().catch(() => {});
            });
          }
        } catch (err) {}
      } else if (iframe) {
        try {
          iframe.style.setProperty('pointer-events', 'auto', 'important');
          iframe.focus?.();
          iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
          iframe.contentWindow?.postMessage('{"method":"play"}', '*');
        } catch (e) {}
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: 1 }).catch(() => {});
      }
      return false;
    }
  }

  // Intercept all mouse, pointer, and contextmenu events in capture phase
  const INTERCEPTED_MOUSE_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'contextmenu', 'auxclick'];
  for (const evt of INTERCEPTED_MOUSE_EVENTS) {
    document.addEventListener(evt, handleOverlayEvent, true);
    if (typeof window !== 'undefined') {
      window.addEventListener(evt, handleOverlayEvent, true);
    }
  }

  // Continuous Proactive Overlay Sweeper
  function sweepOverlays() {
    if (!isEnabled) return;

    const containers = document.querySelectorAll(
      '.video-container, .video-player-container, .video-player-box, .player-wrapper, ' +
      '.jwplayer, .video-js, .plyr, .clappr, .dplayer, .flowplayer, ' +
      '[class*="player" i], [id*="player" i], [class*="video" i], [id*="video" i]'
    );

    for (const container of containers) {
      const media = container.querySelector('video, iframe');
      if (!media) continue;

      const overlays = container.querySelectorAll(
        '[class*="overlay" i], [id*="overlay" i], [class*="fake" i], [id*="fake" i], ' +
        '[class*="trap" i], [id*="trap" i], [class*="click" i], [id*="click" i], ' +
        '[class*="ad-" i], [id*="ad-" i], a[target="_blank"]'
      );

      for (const el of overlays) {
        if (el === media || media.contains(el) || isLegitimatePlayerControl(el)) continue;
        try {
          el.remove();
        } catch (e) {
          try {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
          } catch (err) {}
        }
      }
    }

    const hasMedia = Boolean(document.querySelector('video, iframe'));
    if (hasMedia && document.body) {
      const bodyChildren = Array.from(document.body.children);
      for (const el of bodyChildren) {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'VIDEO' || el.tagName === 'IFRAME') continue;
        const isPositionedTrap = (el.style.position === 'fixed' || el.style.position === 'absolute') &&
                                 (parseInt(el.style.zIndex || '0', 10) >= 10 || /trap|overlay|catcher|fake|click/i.test((el.id || '') + ' ' + (el.className || '')));
        if (isPositionedTrap && !el.querySelector('video, iframe')) {
          try { el.remove(); } catch (e) {}
        }
      }
    }
  }

  // Expose scan functions for testing / manual triggering
  if (typeof window !== 'undefined') {
    window.scanAndHideBanners = scanAndHideBanners;
    window.sweepOverlays = sweepOverlays;
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
