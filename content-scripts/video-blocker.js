// content-scripts/video-blocker.js
// Runs in world: "ISOLATED" in all_frames: true to fast-forward and auto-skip video ads
(function () {
  'use strict';

  const YT_SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-text',
    'button.ytp-ad-skip-button-modern',
    'button.ytp-skip-ad-button',
    'button[id^="skip-button:"]',
    'div.ytp-ad-skip-button-slot button',
    'ytd-button-renderer#skip-button button',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-preview-container',
    'button[class*="skip" i]'
  ];

  const UNIVERSAL_SKIP_SELECTORS = [
    '#skip_btn',
    '#skip-btn',
    '#skipButton',
    'button[id*="skip" i]',
    'div[id*="skip" i]',
    'a[id*="skip" i]',
    '[class*="skip-button" i]',
    '[class*="skip-ad" i]',
    '[class*="ad-skip" i]',
    '[id*="skip-ad" i]',
    '[id*="ad-skip" i]',
    '[aria-label*="skip" i]',
    '.skip-btn',
    '.skip-button',
    '.skip_btn',
    'button[class*="skip" i]'
  ];

  // Use strict word boundary patterns to prevent matching video-adapter, etc.
  const AD_CLASS_REGEX = /\b(ad-showing|ad-interrupting|ad-playing|video-ad|vast-ad|jw-flag-ads|vjs-ad-playing|afs_ads|ad-placement)\b/i;
  const AD_URL_REGEX = /(watermelogic\.com|doubleclick\.net|googlesyndication\.com|\/assets\/we\d+|\/video-ads?\/|\/ads?\/[a-z0-9_-]+\.mp4)/i;

  let isEnabled = true;

  function isVisible(el) {
    if (!el) return false;
    try {
      if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
        return false;
      }
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function triggerClick(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e) {}
    try {
      if (typeof el.click === 'function') el.click();
      if (typeof el.onclick === 'function') el.onclick();
    } catch (e) {}
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
    } catch (e) {
      // Catch synchronous context invalidation exception when extension is reloaded
    }
  }

  function clickSkipButtons(root) {
    let skipped = false;
    const targetRoot = root || document;

    // 1. YouTube selectors
    for (const sel of YT_SKIP_SELECTORS) {
      const btn = targetRoot.querySelector(sel);
      if (btn && isVisible(btn)) {
        triggerClick(btn);
        skipped = true;
      }
    }

    // 2. Universal selectors
    for (const sel of UNIVERSAL_SKIP_SELECTORS) {
      const btns = targetRoot.querySelectorAll(sel);
      for (const btn of btns) {
        if (isVisible(btn)) {
          triggerClick(btn);
          skipped = true;
        }
      }
    }

    // Also check document root so sibling skip buttons are always found
    if (targetRoot !== document) {
      for (const sel of UNIVERSAL_SKIP_SELECTORS) {
        const btns = document.querySelectorAll(sel);
        for (const btn of btns) {
          if (isVisible(btn)) {
            triggerClick(btn);
            skipped = true;
          }
        }
      }
    }

    // 3. Text-based fallback search
    const allButtons = (targetRoot === document ? targetRoot : document).querySelectorAll('button, div[role="button"], a[role="button"], [class*="btn" i]');
    for (const el of allButtons) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (
        text.includes('ข้ามโฆษณา') ||
        text.includes('ข้าม') ||
        text.includes('skip ad') ||
        text.includes('skip advertisement') ||
        text === 'skip' ||
        text === 'close ad'
      ) {
        if (isVisible(el)) {
          triggerClick(el);
          skipped = true;
        }
      }
    }

    return skipped;
  }

  function checkIsAdVideo(video) {
    if (!video) return false;
    const container = video.closest('.custom-stream-player, .jwplayer, [class*="player"], [id*="player"]') || video.parentElement;
    const playerContext = container?.parentElement || container || document;

    if (video.className && typeof video.className === 'string' && AD_CLASS_REGEX.test(video.className)) return true;
    if (container && container.className && typeof container.className === 'string' && AD_CLASS_REGEX.test(container.className)) return true;
    if (container && container.querySelector('.video-ad-overlay, [class*="ad-overlay"], [id*="ad-overlay"], .afs_ads, .ad-placement')) return true;

    const videoSrc = (video.src || video.currentSrc || '').toLowerCase();
    if (videoSrc && AD_URL_REGEX.test(videoSrc)) return true;

    // Check if visible skip button exists in playerContext or document
    for (const sel of UNIVERSAL_SKIP_SELECTORS) {
      const skipBtn = playerContext.querySelector(sel) || document.querySelector(sel);
      if (skipBtn && isVisible(skipBtn)) return true;
    }

    // Check buttons with text
    const buttons = playerContext.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if ((txt.includes('ข้ามโฆษณา') || txt.includes('skip ad')) && isVisible(btn)) {
        return true;
      }
    }

    return false;
  }

  function bindVideoEvents(video) {
    if (!video || video._supershieldBound) return;
    video._supershieldBound = true;

    const onPlayOrTimeUpdate = () => {
      if (!isExtensionContextValid()) {
        try {
          video.removeEventListener('timeupdate', onPlayOrTimeUpdate);
          video.removeEventListener('playing', onPlayOrTimeUpdate);
          video.removeEventListener('play', onPlayOrTimeUpdate);
        } catch (e) {}
        return;
      }
      if (!isEnabled) return;
      const ytPlayer = video.closest('#movie_player, .html5-video-player');
      if (ytPlayer) {
        const isLive = ytPlayer.classList.contains('ytp-live-mode');
        const isAdShowing = ytPlayer.classList.contains('ad-showing') ||
                            ytPlayer.classList.contains('ad-interrupting') ||
                            Boolean(ytPlayer.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button-slot, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'));
        if (isAdShowing) {
          try {
            if (video._prevMuted === undefined) {
              video._prevMuted = video.muted;
            }
            video._adBlockActive = true;
            video.muted = true;
            video.playbackRate = 16.0;
            if (!isLive && isFinite(video.duration) && video.duration > 0) {
              video.currentTime = video.duration;
            }
          } catch (e) {}
          clickSkipButtons(ytPlayer);
          if (!video._supershieldCounted) {
            video._supershieldCounted = true;
            safeSendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
          }
        } else if (video._adBlockActive) {
          try {
            video._adBlockActive = false;
            video._supershieldCounted = false;
            video.playbackRate = 1.0;
            video.muted = video._prevMuted !== undefined ? video._prevMuted : false;
            delete video._prevMuted;
          } catch (e) {}
        }
      } else {
        const container = video.closest('.custom-stream-player, .jwplayer, [class*="player"], [id*="player"]') || video.parentElement;
        const playerContext = container?.parentElement || container || document;
        const isAd = checkIsAdVideo(video);

        if (isAd) {
          try {
            if (video._prevMuted === undefined) {
              video._prevMuted = video.muted;
            }
            video._adBlockActive = true;
            video.muted = true;
            video.playbackRate = 16.0;
            if (isFinite(video.duration) && video.duration > 0) {
              video.currentTime = video.duration;
            }
          } catch (e) {}
          clickSkipButtons(playerContext);
          if (!video._supershieldCounted) {
            video._supershieldCounted = true;
            safeSendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
          }
        } else if (video._adBlockActive) {
          try {
            video._adBlockActive = false;
            video._supershieldCounted = false;
            video.playbackRate = 1.0;
            video.muted = video._prevMuted !== undefined ? video._prevMuted : false;
            delete video._prevMuted;
          } catch (e) {}
        }
      }
    };

    video.addEventListener('timeupdate', onPlayOrTimeUpdate, { passive: true });
    video.addEventListener('playing', onPlayOrTimeUpdate, { passive: true });
    video.addEventListener('play', onPlayOrTimeUpdate, { passive: true });
  }

  function handleVideoAds() {
    if (!isExtensionContextValid()) return;
    if (!isEnabled) return;
    let skippedAny = false;

    // 1. YouTube specific handler
    const ytPlayer = document.querySelector('#movie_player, .html5-video-player');
    if (ytPlayer) {
      const isLive = ytPlayer.classList.contains('ytp-live-mode');
      const isAdShowing = ytPlayer.classList.contains('ad-showing') ||
                          ytPlayer.classList.contains('ad-interrupting') ||
                          Boolean(ytPlayer.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button-slot, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'));

      const ytVideo = ytPlayer.querySelector('video');
      if (ytVideo) {
        bindVideoEvents(ytVideo);
        if (isAdShowing) {
          try {
            ytVideo._adBlockActive = true;
            ytVideo.muted = true;
            ytVideo.playbackRate = 16.0;
            if (!isLive && isFinite(ytVideo.duration) && ytVideo.duration > 0) {
              ytVideo.currentTime = ytVideo.duration;
            }
          } catch (e) {}

          if (clickSkipButtons(ytPlayer)) {
            skippedAny = true;
          }

          if (!ytVideo._supershieldCounted) {
            ytVideo._supershieldCounted = true;
            safeSendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
          }
        } else if (ytVideo._adBlockActive) {
          // Restore playback state once ad finishes
          try {
            ytVideo._adBlockActive = false;
            ytVideo._supershieldCounted = false;
            ytVideo.playbackRate = 1.0;
            ytVideo.muted = false;
          } catch (e) {}
        }
      }
    }

    // 2. Universal HTML5 Video Player handler
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (ytPlayer && ytPlayer.contains(video)) continue; // Handled above
      bindVideoEvents(video);

      const container = video.closest('.custom-stream-player, .jwplayer, [class*="player"], [id*="player"]') || video.parentElement;
      const playerContext = container?.parentElement || container || document;
      const isAd = checkIsAdVideo(video);

      if (isAd) {
        try {
          video._adBlockActive = true;
          video.muted = true;
          video.playbackRate = 16.0;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        } catch (e) {}

        if (clickSkipButtons(playerContext)) {
          skippedAny = true;
        }

        // Hide predatory registration buttons
        const regBtn = playerContext.querySelector('#register_btn, [id*="register_btn" i]');
        if (regBtn) {
          try { regBtn.style.display = 'none'; } catch (e) {}
        }

        // Auto click custom play button once ready
        const customPlayBtn = playerContext.querySelector('#custom_play_btn, [aria-label*="Play content" i]');
        if (customPlayBtn && isVisible(customPlayBtn) && !customPlayBtn._supershieldClicked) {
          customPlayBtn._supershieldClicked = true;
          setTimeout(() => {
            triggerClick(customPlayBtn);
          }, 100);
        }

        if (!video._supershieldCounted) {
          video._supershieldCounted = true;
          safeSendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
        }
      } else if (video._adBlockActive) {
        // Restore playback state once ad finishes
        try {
          video._adBlockActive = false;
          video._supershieldCounted = false;
          video.playbackRate = 1.0;
          video.muted = false;
        } catch (e) {}
      }
    }

    if (skippedAny) {
      safeSendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
    }
  }

  function setEnabledState(active) {
    isEnabled = Boolean(active);
    if (!isEnabled) {
      // Restore any video currently manipulated
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (v._adBlockActive) {
          try {
            v._adBlockActive = false;
            v._supershieldCounted = false;
            v.playbackRate = 1.0;
            v.muted = false;
          } catch (e) {}
        }
      }
    } else {
      handleVideoAds();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      chrome.storage.local.get('enabled', (data) => {
        const active = data && data.enabled !== undefined ? data.enabled : true;
        setEnabledState(active);
      });

      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes.enabled !== undefined) {
          setEnabledState(changes.enabled.newValue);
        }
      });

      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg && msg.type === 'SET_ENABLED') {
            setEnabledState(msg.enabled);
          }
        });
      }
    } catch (e) {}
  }

  // Expose for testing
  if (typeof window !== 'undefined') {
    window.handleVideoAds = handleVideoAds;
  }

  // Run on initial load
  handleVideoAds();

  // Watch DOM mutations
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (!isExtensionContextValid()) {
      observer.disconnect();
      return;
    }
    if (!isEnabled) return;
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        if (isEnabled && isExtensionContextValid()) handleVideoAds();
      }, 50);
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'src']
    });
  }

  // Periodic fallback check for video ad timing
  const timer = setInterval(() => {
    if (!isExtensionContextValid()) {
      clearInterval(timer);
      if (observer) observer.disconnect();
      return;
    }
    if (isEnabled) handleVideoAds();
  }, 500);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
})();
