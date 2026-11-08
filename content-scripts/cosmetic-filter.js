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

  const YOUTUBE_AD_CONTAINER_SELECTORS = [
    '#masthead-ad',
    'ytd-rich-grid-renderer #masthead-ad',
    'ytd-ad-slot-renderer',
    'ytd-page-top-ad-layout-renderer',
    'ytd-video-masthead-ad-v3-renderer',
    'ytd-video-masthead-ad-primary-video-renderer',
    'ytd-video-masthead-ad-advertiser-info-renderer',
    '#masthead-player',
    'ytd-player[context="WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_MASTHEAD_AD"]',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-banner-promo-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-statement-banner-renderer',
    'ytd-mealbar-promo-renderer',
    '#player-ads',
    '.ytd-action-companion-ad-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)'
  ];

  let isEnabled = true;

  // Set default active state immediately so cosmetic.css applies from the initial DOM frame
  if (typeof document !== 'undefined' && document.documentElement && !document.documentElement.hasAttribute('data-supershield-disabled')) {
    document.documentElement.setAttribute('data-supershield-active', 'true');
  }

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

    // Active sweep for YouTube masthead and in-feed ad elements
    for (const ytSelector of YOUTUBE_AD_CONTAINER_SELECTORS) {
      let ytElements = [];
      try {
        ytElements = document.querySelectorAll(ytSelector);
      } catch (e) {
        continue;
      }
      for (const el of ytElements) {
        if (!el || el._supershieldHidden) continue;
        el._supershieldHidden = true;
        try {
          const v = el.querySelector('video');
          if (v) {
            try { v.pause(); v.src = ''; } catch (err) {}
          }
          el.remove();
          newlyBlocked++;
        } catch (e) {
          try {
            el.setAttribute('data-supershield-hidden', 'true');
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('height', '0px', 'important');
            el.style.setProperty('min-height', '0px', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            newlyBlocked++;
          } catch (err) {}
        }
      }
    }

    if (newlyBlocked > 0) {
      safeSendMessage({ type: 'AD_BLOCKED', count: newlyBlocked });
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
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || el.tagName === 'TRACK' || el.tagName === 'SOURCE') return true;

    // Explicit ad overlay elements are NEVER legitimate controls
    const cls = String(el.className || '') + ' ' + String(el.id || '');
    if (/jw-flag-ads|ad-container|video-ad|ad-overlay|fake-play|fake-player|click-trap|play-trap|stream-overlay/i.test(cls)) {
      return false;
    }

    // Check if element is or is inside any control bar / panel / toolbar
    const controlAncestor = el.closest?.(
      '.controls, .player-controls, .video-controls, .control-bar, .controls-panel, .player-control-bar, ' +
      '.vjs-control-bar, .jw-controls, .plyr__controls, .dplayer-controller, .art-controls, ' +
      '.fp-controls, .mejs__controls, [class*="control" i], [id*="control" i], ' +
      '[class*="toolbar" i], [class*="bottom-bar" i]'
    );
    if (controlAncestor) {
      const ancestorCls = String(controlAncestor.className || '') + ' ' + String(controlAncestor.id || '');
      if (!/jw-flag-ads|ad-container|video-ad|ad-overlay|fake|trap/i.test(ancestorCls)) {
        return true;
      }
    }

    // Check if element is a control button or slider by common player attributes/classes
    const isControlFeature = el.closest?.(
      '[class*="volume" i], [id*="volume" i], [class*="mute" i], [id*="mute" i], [class*="sound" i], [id*="sound" i], [class*="speaker" i], [id*="speaker" i], ' +
      '[class*="fullscreen" i], [id*="fullscreen" i], [class*="full-screen" i], [id*="full-screen" i], ' +
      '[class*="progress" i], [id*="progress" i], [class*="timeline" i], [id*="timeline" i], [class*="seekbar" i], [id*="seekbar" i], ' +
      '[class*="setting" i], [id*="setting" i], [class*="gear" i], [class*="subtitle" i], [class*="caption" i], [class*="quality" i], [class*="speed" i], [class*="pip" i], ' +
      '[aria-label*="play" i], [aria-label*="pause" i], [aria-label*="mute" i], [aria-label*="volume" i], [aria-label*="sound" i], [aria-label*="fullscreen" i], [aria-label*="Full" i], ' +
      '[role="slider"], [role="progressbar"], input[type="range"]'
    );
    if (isControlFeature) return true;

    // Standard player framework classes (VideoJS, JWPlayer, Plyr, DPlayer, Artplayer, Flowplayer)
    if (/vjs-control|vjs-button|jw-control|jw-display-icon|jw-icon|plyr__control|dplayer-controller|dplayer-icon|art-control/i.test(cls)) return true;
    if (/vjs-big-play|jw-icon-display|fp-play|dplayer-play|mejs__overlay-play/i.test(cls)) return true;

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

        // Specific overlay matchers - NEVER use generic [class*="play"] which matches "player"
        const matchedOverlay = target.closest(
          '[class*="play-overlay" i], [id*="play-overlay" i], ' +
          '[class*="fake-play" i], [id*="fake-play" i], ' +
          '[class*="play-fake" i], [id*="play-fake" i], ' +
          '[class*="play-trap" i], [id*="play-trap" i], ' +
          '[class*="play-button" i], [id*="play-button" i], ' +
          '[class*="play-btn" i], [id*="play-btn" i], ' +
          '[class*="overlay" i], [id*="overlay" i], ' +
          '[class*="fake" i], [id*="fake" i], ' +
          '[class*="trap" i], [id*="trap" i], ' +
          '[class*="click-trap" i], [id*="click-trap" i], ' +
          '[class*="catcher" i], [id*="catcher" i], ' +
          '[class*="ad-" i], [id*="ad-" i], ' +
          'a[target="_blank"]'
        ) || ((target.style.position === 'absolute' || target.style.position === 'fixed') && !isLegitimatePlayerControl(target) ? target : null);

        // Safety Invariant: The overlay must exist, cannot be mediaTarget, cannot contain mediaTarget, and cannot be playerContainer
        if (matchedOverlay &&
            matchedOverlay !== mediaTarget &&
            !mediaTarget.contains(matchedOverlay) &&
            !matchedOverlay.contains(mediaTarget) &&
            matchedOverlay !== playerContainer &&
            !isLegitimatePlayerControl(matchedOverlay)) {
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
        if (!target.querySelector('video, iframe') && !isLegitimatePlayerControl(target)) {
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

      if (isNearVideo && !isLegitimatePlayerControl(link)) {
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

      safeSendMessage({ type: 'AD_BLOCKED', count: 1 });
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
        '[class*="play-overlay" i], [id*="play-overlay" i], ' +
        '[class*="fake-play" i], [id*="fake-play" i], ' +
        '[class*="overlay" i], [id*="overlay" i], [class*="fake" i], [id*="fake" i], ' +
        '[class*="trap" i], [id*="trap" i], [class*="click-trap" i], [id*="click-trap" i], ' +
        '[class*="ad-" i], [id*="ad-" i], a[target="_blank"]'
      );

      for (const el of overlays) {
        if (el === media || media.contains(el) || el.contains(media) || el === container || isLegitimatePlayerControl(el)) continue;
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
    if (!isExtensionContextValid()) {
      observer.disconnect();
      return;
    }
    if (!isEnabled) return;
    if (!debounceTimer) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isEnabled && isExtensionContextValid()) scanAndHideBanners();
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
