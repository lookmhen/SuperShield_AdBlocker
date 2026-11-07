// content-scripts/video-blocker.js
// Runs in world: "ISOLATED" in all_frames: true to fast-forward and auto-skip video ads
(function () {
  'use strict';

  let isEnabled = true;

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

  const YT_SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-overlay-close-button',
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

  function handleVideoAds() {
    if (!isEnabled) return;
    let skippedAny = false;

    // 1. YouTube specific handler
    const ytPlayer = document.querySelector('#movie_player, .html5-video-player');
    if (ytPlayer) {
      const isLive = ytPlayer.classList.contains('ytp-live-mode');
      const isAdShowing = ytPlayer.classList.contains('ad-showing') ||
                          ytPlayer.classList.contains('ad-interrupting') ||
                          Boolean(ytPlayer.querySelector('.ytp-ad-player-overlay, .ytp-ad-text'));

      const ytVideo = ytPlayer.querySelector('video');
      if (ytVideo) {
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
        } else if (ytVideo._adBlockActive) {
          // Restore playback state once ad finishes
          try {
            ytVideo._adBlockActive = false;
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
      } else if (video._adBlockActive) {
        // Restore playback state once ad finishes
        try {
          video._adBlockActive = false;
          video.playbackRate = 1.0;
          video.muted = false;
        } catch (e) {}
      }
    }

    if (skippedAny && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 }).catch(() => {});
    }
  }

  // Expose for testing
  if (typeof window !== 'undefined') {
    window.handleVideoAds = handleVideoAds;
  }

  // Run immediately
  handleVideoAds();

  // Watch DOM mutations
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        handleVideoAds();
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
  const timer = setInterval(handleVideoAds, 500);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
})();
