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
    '[class*="skip-button" i]',
    '[class*="skip-ad" i]',
    '[class*="ad-skip" i]',
    '[id*="skip-ad" i]',
    '[id*="ad-skip" i]',
    '[aria-label*="skip" i]',
    '.skip-btn',
    '.skip-button'
  ];

  // Use strict word boundary patterns to prevent matching video-adapter, etc.
  const AD_CLASS_REGEX = /\b(ad-showing|ad-interrupting|ad-playing|video-ad|vast-ad|jw-flag-ads|vjs-ad-playing)\b/i;

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
    } catch (e) {
      // Catch synchronous context invalidation exception when extension is reloaded
    }
  }

  function clickSkipButtons(root) {
    let skipped = false;
    const targetRoot = root || document;

    // YouTube selectors
    for (const sel of YT_SKIP_SELECTORS) {
      const btn = targetRoot.querySelector(sel);
      if (btn && typeof btn.click === 'function') {
        try {
          btn.click();
          skipped = true;
        } catch (e) {}
      }
    }

    // Universal selectors
    for (const sel of UNIVERSAL_SKIP_SELECTORS) {
      const btn = targetRoot.querySelector(sel);
      if (btn && typeof btn.click === 'function') {
        try {
          btn.click();
          skipped = true;
        } catch (e) {}
      }
    }

    // Text-based fallback search (scoped to player container when available)
    const allButtons = targetRoot.querySelectorAll('button, div[role="button"], a[role="button"]');
    for (const el of allButtons) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'skip' || text === 'skip ad' || text === 'ข้าม' || text === 'ข้ามโฆษณา' || text === 'close ad') {
        try {
          el.click();
          skipped = true;
        } catch (e) {}
      }
    }

    return skipped;
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
        const container = video.closest('.custom-stream-player, [class*="player"], [id*="player"]') || video.parentElement;
        let isAd = false;
        if (video.className && typeof video.className === 'string' && AD_CLASS_REGEX.test(video.className)) isAd = true;
        if (container && container.className && typeof container.className === 'string' && AD_CLASS_REGEX.test(container.className)) isAd = true;
        if (container && container.querySelector('.video-ad-overlay, [class*="ad-overlay"], [id*="ad-overlay"]')) isAd = true;

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
          clickSkipButtons(container || document);
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

      const container = video.closest('.custom-stream-player, [class*="player"], [id*="player"]') || video.parentElement;
      let isAd = false;

      // Test class patterns with word boundaries
      if (video.className && typeof video.className === 'string' && AD_CLASS_REGEX.test(video.className)) {
        isAd = true;
      }
      if (container && container.className && typeof container.className === 'string' && AD_CLASS_REGEX.test(container.className)) {
        isAd = true;
      }
      if (container && container.querySelector('.video-ad-overlay, [class*="ad-overlay"], [id*="ad-overlay"]')) {
        isAd = true;
      }

      if (isAd) {
        try {
          video._adBlockActive = true;
          video.muted = true;
          video.playbackRate = 16.0;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        } catch (e) {}

        if (clickSkipButtons(container || document)) {
          skippedAny = true;
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
