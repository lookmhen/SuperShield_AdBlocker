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

  function updateUI(state) {
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

    const stats = state.stats || {};
    if (bannersCount) bannersCount.textContent = (stats.bannersBlocked || 0).toLocaleString();
    if (videosCount) videosCount.textContent = (stats.videoAdsSkipped || 0).toLocaleString();
    if (defusedCount) defusedCount.textContent = (stats.antiAdblockDefused || 0).toLocaleString();
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

    const stats = storageData.stats || { bannersBlocked: 0, videoAdsSkipped: 0, antiAdblockDefused: 0 };
    let dnrBlockedCount = 0;

    // Retrieve network blocks via declarativeNetRequest.getMatchedRules
    if (chrome.declarativeNetRequest?.getMatchedRules) {
      try {
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

        if (activeTabId) {
          const tabMatches = await chrome.declarativeNetRequest.getMatchedRules({ tabId: activeTabId });
          const tabCount = tabMatches?.rulesMatchedInfo?.length || 0;
          dnrBlockedCount = Math.max(dnrBlockedCount, tabCount);
        }

        const allMatches = await chrome.declarativeNetRequest.getMatchedRules();
        const allCount = allMatches?.rulesMatchedInfo?.length || 0;
        dnrBlockedCount = Math.max(dnrBlockedCount, allCount);
      } catch (err) {}
    }

    const bestBanners = Math.max(stats.bannersBlocked || 0, dnrBlockedCount);
    const combinedStats = {
      bannersBlocked: bestBanners,
      videoAdsSkipped: stats.videoAdsSkipped || 0,
      antiAdblockDefused: stats.antiAdblockDefused || 0
    };

    if (bestBanners > (stats.bannersBlocked || 0) && chrome.storage?.local) {
      chrome.storage.local.set({ stats: combinedStats });
    }

    updateUI({ ...storageData, stats: combinedStats });
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
