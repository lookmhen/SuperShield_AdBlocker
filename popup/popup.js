// popup/popup.js
(function () {
  'use strict';

  const toggleSwitch = document.getElementById('toggle-switch');
  const statusBadge = document.getElementById('status-badge');
  const bannersCount = document.getElementById('banners-count');
  const videosCount = document.getElementById('videos-count');
  const defusedCount = document.getElementById('defused-count');
  const btnForcePlay = document.getElementById('btn-force-play');
  const btnPicker = document.getElementById('btn-picker');
  const siteRulesCount = document.getElementById('site-rules-count');
  const btnClearRules = document.getElementById('btn-clear-rules');

  let currentHostname = '';

  function updateUI(state, pageStats) {
    if (!state) return;

    const isEnabled = state.enabled !== false;
    if (toggleSwitch) {
      toggleSwitch.checked = isEnabled;
    }

    if (statusBadge) {
      if (isEnabled) {
        statusBadge.textContent = 'PROTECTED';
        statusBadge.className = 'badge active';
      } else {
        statusBadge.textContent = 'PAUSED';
        statusBadge.className = 'badge paused';
      }
    }

    const total = state.stats || {};
    const page = pageStats || total;

    if (bannersCount) bannersCount.textContent = (page.bannersBlocked || 0).toLocaleString();
    if (videosCount) videosCount.textContent = (page.videoAdsSkipped || 0).toLocaleString();
    if (defusedCount) defusedCount.textContent = (page.antiAdblockDefused || 0).toLocaleString();
  }

  function updateSiteRules(customFilters) {
    if (!currentHostname) return;
    const rules = customFilters?.[currentHostname] || [];
    if (siteRulesCount) siteRulesCount.textContent = rules.length;
    if (btnClearRules) {
      btnClearRules.style.display = rules.length > 0 ? 'inline' : 'none';
    }
  }

  // Immediate initial render from local storage
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(null, (data) => {
      updateUI(data || {});
      if (data?.customFilters) {
        updateSiteRules(data.customFilters);
      }
    });
  }

  async function syncAndRenderStats() {
    if (typeof chrome === 'undefined') return;

    let storageData = {};
    if (chrome.storage?.local) {
      storageData = await new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => resolve(data || {}));
      });
    }

    const totalStats = storageData.stats || { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
    let activeTabId = null;

    if (chrome.tabs?.query) {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      if (tabs && tabs[0]?.id) {
        activeTabId = tabs[0].id;
        try {
          const url = new URL(tabs[0].url);
          currentHostname = url.hostname;
          if (storageData.customFilters) {
            updateSiteRules(storageData.customFilters);
          }
        } catch (e) {}
      }
    }

    // 1. Get DNR network blocks for the CURRENT ACTIVE TAB only
    let tabDnrCount = 0;
    if (chrome.declarativeNetRequest?.getMatchedRules) {
      try {
        if (activeTabId) {
          const tabMatches = await chrome.declarativeNetRequest.getMatchedRules({ tabId: activeTabId });
          tabDnrCount = tabMatches?.rulesMatchedInfo?.length || 0;
        } else {
          const allMatches = await chrome.declarativeNetRequest.getMatchedRules();
          tabDnrCount = allMatches?.rulesMatchedInfo?.length || 0;
        }
      } catch (err) {}
    }

    // 2. Query in-memory per-tab blocks from background service worker
    let tabContentStats = { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
    if (activeTabId && chrome.runtime?.sendMessage) {
      try {
        const res = await new Promise((resolve) => {
          let resolved = false;
          const finish = (val) => {
            if (!resolved) {
              resolved = true;
              resolve(val);
            }
          };
          try {
            const p = chrome.runtime.sendMessage({ type: 'GET_TAB_STATS', tabId: activeTabId }, finish);
            if (p && typeof p.then === 'function') {
              p.then(finish).catch(() => finish(null));
            }
          } catch (e) {
            finish(null);
          }
          setTimeout(() => finish(null), 80);
        });
        if (res?.tabStats) {
          tabContentStats = res.tabStats;
        }
      } catch (err) {}
    }

    // This Page (Current Tab) stats
    const pageStats = {
      bannersBlocked: tabDnrCount + (tabContentStats.bannersBlocked || 0),
      videoAdsSkipped: tabContentStats.videoAdsSkipped || 0,
      antiAdblockDefused: tabContentStats.antiAdblockDefused || 0
    };

    // Keep total cumulative lifetime stats updated
    let totalBanners = totalStats.bannersBlocked || 0;
    if (pageStats.bannersBlocked > totalBanners) {
      totalBanners = pageStats.bannersBlocked;
      totalStats.bannersBlocked = totalBanners;
      if (chrome.storage?.local) {
        chrome.storage.local.set({ stats: totalStats });
      }
    }

    updateUI({ ...storageData, stats: totalStats }, pageStats);
  }

  // Initial load
  syncAndRenderStats();

  // Handle toggle switch change
  if (toggleSwitch) {
    toggleSwitch.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ enabled });
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled }, (res) => {
          updateUI(res || { enabled });
        });
      } else {
        updateUI({ enabled });
      }
    });
  }

  // Live storage change listener to keep stats synchronized
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        syncAndRenderStats();
      }
    });
  }

  // Handle Force Play / Unlock Video
  if (btnForcePlay) {
    btnForcePlay.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'FORCE_PLAY_VIDEO' }, () => {
              window.close();
            });
          }
        });
      }
    });
  }

  // Handle Element Picker Mode
  if (btnPicker) {
    btnPicker.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'START_ELEMENT_PICKER' }, () => {
              window.close();
            });
          }
        });
      }
    });
  }

  // Handle Clear Rules for this site
  if (btnClearRules) {
    btnClearRules.addEventListener('click', () => {
      if (!currentHostname || typeof chrome === 'undefined' || !chrome.storage?.local) return;
      chrome.storage.local.get('customFilters', (res) => {
        const customFilters = res?.customFilters || {};
        delete customFilters[currentHostname];
        chrome.storage.local.set({ customFilters }, () => {
          updateSiteRules(customFilters);
          if (chrome.tabs?.reload) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs && tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
            });
          }
        });
      });
    });
  }
})();
