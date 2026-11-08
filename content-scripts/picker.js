// content-scripts/picker.js
// Interactive Element Picker Mode and Force Play Unlocker for Google Chrome Extension
(function () {
  'use strict';

  let isPickerActive = false;
  let hoveredElement = null;
  let pickerBanner = null;

  function isExtensionContextValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return true;
      const id = chrome.runtime.id;
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

  function getHostname() {
    return (window.location && window.location.hostname) ? window.location.hostname : 'localhost';
  }

  // 1. Selector Generator
  function generateSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return '';

    // Prefer ID if stable
    if (el.id && typeof el.id === 'string' && !/\d{5,}/.test(el.id)) {
      return `${el.tagName.toLowerCase()}#${CSS.escape(el.id)}`;
    }

    // Prefer unique class names
    if (el.className && typeof el.className === 'string') {
      const classes = el.className
        .trim()
        .split(/\s+/)
        .filter(c => c && !c.includes(':') && !/\d{5,}/.test(c) && !c.startsWith('_'));
      if (classes.length > 0) {
        const classSelector = `${el.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
        try {
          if (document.querySelectorAll(classSelector).length === 1) {
            return classSelector;
          }
        } catch (e) {}
      }
    }

    // Path fallback
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let tag = current.tagName.toLowerCase();
      if (current.id && !/\d{5,}/.test(current.id)) {
        parts.unshift(`${tag}#${CSS.escape(current.id)}`);
        break;
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            tag += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(tag);
      }
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  // 2. Block and Save Custom Filter
  function blockAndSaveElement(el) {
    if (!el) return;
    const selector = generateSelector(el);
    if (!selector) return;

    // Hide immediately
    try {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
    } catch (e) {}

    const hostname = getHostname();

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get('customFilters', (res) => {
        const customFilters = res?.customFilters || {};
        if (!customFilters[hostname]) {
          customFilters[hostname] = [];
        }
        if (!customFilters[hostname].includes(selector)) {
          customFilters[hostname].push(selector);
        }
        chrome.storage.local.set({ customFilters }, () => {
          showNotification(`Blocked & Saved: ${selector}`);
          applyCustomFilters();
        });
      });

      safeSendMessage({ type: 'AD_BLOCKED', count: 1 });
    } else {
      showNotification(`Blocked: ${selector}`);
    }
  }

  // 3. Apply Stored Custom Filters
  function applyCustomFilters() {
    const hostname = getHostname();
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    chrome.storage.local.get(['customFilters', 'customCosmeticFilters', 'customGlobalFilters', 'enabled'], (res) => {
      let styleEl = document.getElementById('supershield-custom-filters');
      if (res && res.enabled === false) {
        if (styleEl) styleEl.remove();
        return;
      }

      const pickerFilters = res?.customFilters?.[hostname] || [];
      const subFilters = res?.customCosmeticFilters?.[hostname] || [];
      const globalFilters = res?.customGlobalFilters || [];

      // Check subdomains matching (e.g. m.youtube.com matches youtube.com)
      const domainMatches = [];
      if (res?.customCosmeticFilters) {
        for (const [dom, selectors] of Object.entries(res.customCosmeticFilters)) {
          if (hostname.endsWith('.' + dom)) {
            domainMatches.push(...selectors);
          }
        }
      }

      const combined = Array.from(new Set([...pickerFilters, ...subFilters, ...domainMatches, ...globalFilters]));
      if (combined.length === 0) {
        if (styleEl) styleEl.remove();
        return;
      }

      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'supershield-custom-filters';
        (document.head || document.documentElement).appendChild(styleEl);
      }

      const validRules = [];
      for (const sel of combined) {
        try {
          if (sel && sel.length < 2000) {
            validRules.push(`${sel} { display: none !important; visibility: hidden !important; height: 0 !important; }`);
          }
        } catch (e) {}
      }

      styleEl.textContent = validRules.join('\n');

      // Also apply inline style to currently matched elements
      for (const sel of combined) {
        try {
          if (sel && sel.length < 2000) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              el.style.setProperty('display', 'none', 'important');
            }
          }
        } catch (e) {}
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (
        area === 'local' &&
        (changes.customFilters ||
          changes.customCosmeticFilters ||
          changes.customGlobalFilters ||
          changes.enabled !== undefined)
      ) {
        applyCustomFilters();
      }
    });
  }

  // 4. Force Play & Unlock Video Action (Universal Player Engine)
  const BIG_PLAY_BUTTON_SELECTORS = [
    '.vjs-big-play-button',
    '.jw-display-icon-container',
    '.jw-icon-display',
    'button[data-plyr="play"]',
    '.plyr__control--overlaid',
    '.fp-play',
    '.flowplayer .fp-ui',
    '.dplayer-mobile-play',
    '.dplayer-play-icon',
    '.art-state-play',
    '.mejs__overlay-play',
    '.video-play-button',
    '.play-button',
    '.play-btn',
    'button[aria-label*="play"]',
    'button[aria-label*="Play"]'
  ];

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

  function forcePlayVideos() {
    let unlocked = false;
    let removedCount = 0;

    // 1. Direct <video> elements (HTML5, JW Player, Video.js, Plyr, Clappr, etc.)
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      let container = null;
      try {
        container = video.parentElement?.closest(
          '.player-container, .video-container, .video-js, .jwplayer, .plyr, .clappr, .dplayer, .flowplayer, [class*="player"], [id*="player"]'
        );
      } catch (err) {}
      if (!container) container = video.parentElement;

      if (container) {
        // Strip rogue overlays and fake buttons covering the video
        const potentialOverlays = container.querySelectorAll(
          '[class*="play-overlay" i], [id*="play-overlay" i], ' +
          '[class*="fake-play" i], [id*="fake-play" i], ' +
          '[class*="play-button" i], [id*="play-button" i], ' +
          '[class*="play-btn" i], [id*="play-btn" i], ' +
          '[class*="overlay" i], [id*="overlay" i], ' +
          '[class*="fake" i], [id*="fake" i], ' +
          '[class*="trap" i], [id*="trap" i], ' +
          '[class*="click-trap" i], [id*="click-trap" i], ' +
          'div[style*="absolute"], div[style*="fixed"], a[target="_blank"]'
        );

        for (const el of potentialOverlays) {
          if (el === video || video.contains(el) || el.contains(video) || el === container) continue;

          // Do not delete legitimate control bars or real player play buttons
          if (isLegitimatePlayerControl(el)) {
            continue;
          }

          const isPositioned = el.style.position === 'absolute' || el.style.position === 'fixed' ||
                               parseInt(el.style.zIndex, 10) > 0 ||
                               /overlay|fake|trap|ad-|sponsor|backdrop|click/i.test(el.className + ' ' + el.id) ||
                               (el.tagName === 'A' && el.target === '_blank');

          if (isPositioned) {
            try {
              el.remove();
              removedCount++;
            } catch (e) {}
          }
        }

        // Trigger Big Play Buttons for player frameworks
        for (const sel of BIG_PLAY_BUTTON_SELECTORS) {
          const btn = container.querySelector(sel);
          if (btn) {
            try {
              if (typeof btn.click === 'function') btn.click();
              if (typeof btn.onclick === 'function') btn.onclick();
              unlocked = true;
            } catch (e) {}
          }
        }
      }

      // Force native video playback
      try {
        video.playbackRate = 1.0;
        video.muted = false;
        const p = video.play();
        if (p !== undefined) {
          p.then(() => {
            unlocked = true;
          }).catch((err) => {
            // Autoplay policy fallback: mute and play
            try {
              video.muted = true;
              video.play().then(() => {
                unlocked = true;
              }).catch(() => {});

              // Auto unmute on first user click anywhere
              const unmuteOnGesture = () => {
                try { video.muted = false; } catch (e) {}
                window.removeEventListener('click', unmuteOnGesture, true);
                window.removeEventListener('keydown', unmuteOnGesture, true);
              };
              window.addEventListener('click', unmuteOnGesture, true);
              window.addEventListener('keydown', unmuteOnGesture, true);
            } catch (fallbackErr) {}
          });
        }
        unlocked = true;
      } catch (err) {}
    }

    // 2. Embedded <iframe> video players (Streaming hosts: streamtape, dood, vidcloud, etc.)
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.src || '').toLowerCase();
      const idClass = ((iframe.id || '') + ' ' + (iframe.className || '')).toLowerCase();
      const rect = iframe.getBoundingClientRect ? iframe.getBoundingClientRect() : { width: 640, height: 360 };
      const isVideoIframe = (rect.width > 200 && rect.height > 120) ||
                            /embed|player|stream|video|movie|vids|play|watch/i.test(src) ||
                            /player|video|stream|embed|film|cinema/i.test(idClass);

      if (isVideoIframe) {
        let container = null;
        try {
          container = iframe.closest('.player-container, .video-container, .player-wrapper, .video-player-box, [class*="player"], [id*="player"]');
        } catch (err) {}
        if (!container) container = iframe.parentElement;
        if (container) {
          const overlays = container.querySelectorAll(
            '[class*="overlay" i], [id*="overlay" i], [class*="click" i], [id*="click" i], [class*="fake" i], [id*="fake" i], [class*="trap" i], a, div'
          );
          for (const el of overlays) {
            if (el === iframe || iframe.contains(el)) continue;

            const isPositioned = el.style.position === 'absolute' || el.style.position === 'fixed' ||
                                 parseInt(el.style.zIndex, 10) > 0 ||
                                 /overlay|trap|catcher|fake|play|shield|mask|backdrop|click/i.test((el.className || '') + ' ' + (el.id || '')) ||
                                 (el.tagName === 'A' && el.target === '_blank');

            if (isPositioned) {
              try {
                el.remove();
                removedCount++;
              } catch (e) {}
            }
          }
        }

        try {
          iframe.style.setProperty('pointer-events', 'auto', 'important');
        } catch (e) {}

        // Send universal embed playback postMessage commands (YouTube, Vimeo, etc.)
        try {
          iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
          iframe.contentWindow?.postMessage('{"method":"play"}', '*');
        } catch (e) {}

        unlocked = true;
      }
    }

    if (unlocked) {
      showNotification('⚡ Video Player Unlocked & Forced Play!');
      if (removedCount > 0) {
        safeSendMessage({ type: 'AD_BLOCKED', count: removedCount });
      }
    } else {
      showNotification('⚠️ No video player found on this page');
    }

    return { unlocked, count: removedCount };
  }

  // 5. Visual Notification Toast
  function showNotification(msg) {
    try {
      let toast = document.getElementById('supershield-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'supershield-toast';
        toast.style.cssText = `
          position: fixed !important;
          bottom: 24px !important;
          right: 24px !important;
          background: #0f172a !important;
          color: #38bdf8 !important;
          padding: 12px 20px !important;
          border-radius: 8px !important;
          font-family: sans-serif !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          z-index: 2147483647 !important;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important;
          border: 1px solid #38bdf8 !important;
          transition: opacity 0.3s ease !important;
          pointer-events: none !important;
        `;
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.opacity = '1';
      setTimeout(() => {
        if (toast) toast.style.opacity = '0';
      }, 3000);
    } catch (e) {}
  }

  function isTopFrame() {
    try {
      return window.self === window.top;
    } catch (e) {
      return false;
    }
  }

  // 6. Interactive Element Picker Mode
  function startElementPicker() {
    // Only the top-level window should launch the interactive picker
    if (!isTopFrame()) {
      return;
    }

    if (isPickerActive) {
      stopElementPicker();
    }
    isPickerActive = true;

    // Clean up any stale banner
    const existing = document.getElementById('supershield-picker-banner');
    if (existing) {
      try { existing.remove(); } catch (e) {}
    }

    // Show Top Helper Banner
    pickerBanner = document.createElement('div');
    pickerBanner.id = 'supershield-picker-banner';
    pickerBanner.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      background: #1e293b !important;
      color: #f8fafc !important;
      padding: 12px 16px !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
      border-bottom: 2px solid #ef4444 !important;
      user-select: none !important;
    `;
    pickerBanner.innerHTML = `
      <span style="pointer-events: none;">🎯 <strong>Element Picker Active:</strong> Click on any fake button, banner, or rogue overlay to block it permanently.</span>
      <button id="supershield-cancel-picker" type="button" style="background:#ef4444 !important;color:#ffffff !important;border:none !important;padding:8px 16px !important;border-radius:6px !important;cursor:pointer !important;font-weight:bold !important;font-size:13px !important;z-index:2147483647 !important;position:relative !important;">Exit [ESC]</button>
    `;
    (document.body || document.documentElement).appendChild(pickerBanner);

    const cancelBtn = pickerBanner.querySelector('#supershield-cancel-picker');
    if (cancelBtn) {
      const handleExit = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        stopElementPicker();
      };
      cancelBtn.addEventListener('click', handleExit, true);
      cancelBtn.addEventListener('mousedown', handleExit, true);
      cancelBtn.addEventListener('pointerdown', handleExit, true);
    }

    window.addEventListener('mouseover', onPickerMouseOver, true);
    document.addEventListener('mouseover', onPickerMouseOver, true);
    window.addEventListener('click', onPickerClick, true);
    document.addEventListener('click', onPickerClick, true);
    window.addEventListener('keydown', onPickerKeyDown, true);
    document.addEventListener('keydown', onPickerKeyDown, true);
    window.addEventListener('keyup', onPickerKeyDown, true);
    document.addEventListener('keyup', onPickerKeyDown, true);

    try {
      window.focus();
      cancelBtn?.focus?.();
    } catch (e) {}
  }

  function stopElementPicker() {
    isPickerActive = false;
    if (hoveredElement) {
      try {
        hoveredElement.style.outline = '';
        hoveredElement.style.backgroundColor = '';
      } catch (e) {}
      hoveredElement = null;
    }
    const banners = document.querySelectorAll('#supershield-picker-banner');
    for (const b of banners) {
      try { b.remove(); } catch (e) {}
    }
    pickerBanner = null;

    window.removeEventListener('mouseover', onPickerMouseOver, true);
    document.removeEventListener('mouseover', onPickerMouseOver, true);
    window.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('click', onPickerClick, true);
    window.removeEventListener('keydown', onPickerKeyDown, true);
    document.removeEventListener('keydown', onPickerKeyDown, true);
    window.removeEventListener('keyup', onPickerKeyDown, true);
    document.removeEventListener('keyup', onPickerKeyDown, true);
  }

  function onPickerMouseOver(e) {
    if (!isPickerActive) return;
    const target = e.target;
    if (!target || target === pickerBanner || pickerBanner?.contains(target)) return;

    if (hoveredElement && hoveredElement !== target) {
      try {
        hoveredElement.style.outline = '';
        hoveredElement.style.backgroundColor = '';
      } catch (err) {}
    }

    hoveredElement = target;
    try {
      target.style.outline = '3px dashed #ef4444';
      target.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    } catch (err) {}
  }

  function onPickerClick(e) {
    if (!isPickerActive) return;
    const target = e.target;
    if (!target) return;

    // Check if clicked the cancel button or anywhere inside it
    if (target.id === 'supershield-cancel-picker' || target.closest?.('#supershield-cancel-picker')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      stopElementPicker();
      return false;
    }

    // Do not pick the top helper banner itself
    if (target === pickerBanner || pickerBanner?.contains(target)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    blockAndSaveElement(target);
    stopElementPicker();
    return false;
  }

  function onPickerKeyDown(e) {
    if (!isPickerActive) return;
    const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27 || e.which === 27;
    if (isEsc) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      stopElementPicker();
    }
  }

  // 7. Message Dispatcher
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'START_ELEMENT_PICKER') {
        if (isTopFrame()) {
          startElementPicker();
          sendResponse({ success: true });
        }
      } else if (message.type === 'STOP_ELEMENT_PICKER') {
        stopElementPicker();
        sendResponse({ success: true });
      } else if (message.type === 'FORCE_PLAY_VIDEO') {
        const res = forcePlayVideos();
        sendResponse(res);
      }
      return true;
    });
  }

  // Expose API for testing
  if (typeof window !== 'undefined') {
    window.generateSelector = generateSelector;
    window.blockAndSaveElement = blockAndSaveElement;
    window.applyCustomFilters = applyCustomFilters;
    window.forcePlayVideos = forcePlayVideos;
    window.startElementPicker = startElementPicker;
    window.stopElementPicker = stopElementPicker;
  }

  // Load and apply on page startup
  applyCustomFilters();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCustomFilters);
  }
})();
