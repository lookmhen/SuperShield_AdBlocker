// content-scripts/video-blocker.js
// Runs in world: "ISOLATED" in all_frames: true to fast-forward and auto-skip video ads
(function () {
  'use strict';

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

  const AD_CLASS_PATTERNS = [
    'ad-showing',
    'ad-interrupting',
    'ad-playing',
    'video-ad',
    'vast-ad',
    'jw-flag-ads',
    'vjs-ad-playing'
  ];

  function clickSkipButtons(root) {
    let skipped = false;
    
    // YouTube selectors
    for (const sel of YT_SKIP_SELECTORS) {
      const btn = (root || document).querySelector(sel);
      if (btn && typeof btn.click === 'function') {
        try {
          btn.click();
          skipped = true;
        } catch (e) {}
      }
    }

    // Universal selectors
    for (const sel of UNIVERSAL_SKIP_SELECTORS) {
      const btn = (root || document).querySelector(sel);
      if (btn && typeof btn.click === 'function') {
        try {
          btn.click();
          skipped = true;
        } catch (e) {}
      }
    }

    // Text-based fallback search (e.g. "Skip", "ข้าม", "Skip Ad")
    const allButtons = (root || document).querySelectorAll('button, div[role="button"], a[role="button"]');
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
    let skippedAny = false;

    // 1. YouTube specific handler
    const ytPlayer = document.querySelector('#movie_player, .html5-video-player');
    if (ytPlayer) {
      const isAdShowing = ytPlayer.classList.contains('ad-showing') ||
                          ytPlayer.classList.contains('ad-interrupting') ||
                          Boolean(ytPlayer.querySelector('.ytp-ad-player-overlay, .ytp-ad-text'));

      if (isAdShowing) {
        const video = ytPlayer.querySelector('video');
        if (video) {
          try {
            video.muted = true;
            video.playbackRate = 16.0;
            if (isFinite(video.duration) && video.duration > 0) {
              video.currentTime = video.duration;
            }
          } catch (e) {}
        }
        if (clickSkipButtons(ytPlayer)) {
          skippedAny = true;
        }
      }
    }

    // 2. Universal HTML5 Video Player handler (JW Player, Video.js, Custom streaming players)
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      const container = video.closest('.custom-stream-player, [class*="player"], [id*="player"]') || video.parentElement;
      let isAd = false;

      // Check classes on video itself or parent player container
      if (video.className && AD_CLASS_PATTERNS.some(pat => video.className.includes(pat))) {
        isAd = true;
      }
      if (container && container.className && typeof container.className === 'string') {
        if (AD_CLASS_PATTERNS.some(pat => container.className.includes(pat))) {
          isAd = true;
        }
      }

      // Check ad overlays in container
      if (container && container.querySelector('.video-ad-overlay, [class*="ad-overlay"], [id*="ad-overlay"]')) {
        isAd = true;
      }

      if (isAd) {
        try {
          video.muted = true;
          video.playbackRate = 16.0;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        } catch (e) {}

        if (clickSkipButtons(container || document)) {
          skippedAny = true;
        }
      }
    }

    if (skippedAny && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'VIDEO_AD_SKIPPED', count: 1 });
      } catch (err) {}
    }
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
