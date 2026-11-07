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

  // Load state on open
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(null, (data) => {
      updateUI(data || {});
      if (data?.customFilters) {
        updateSiteRules(data.customFilters);
      }
    });

    // Detect active tab hostname
    if (chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.url) {
          try {
            const url = new URL(tabs[0].url);
            currentHostname = url.hostname;
            chrome.storage.local.get('customFilters', (res) => {
              updateSiteRules(res?.customFilters);
            });
          } catch (e) {}
        }
      });
    }
  }

  // Handle toggle switch change
  if (toggleSwitch) {
    toggleSwitch.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled }, (res) => {
          updateUI(res || { enabled });
        });
      } else {
        updateUI({ enabled });
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
              window.close(); // Close popup so user can click on page
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
          // Reload active tab to restore original DOM if needed
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
