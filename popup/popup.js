// popup/popup.js
(function () {
  'use strict';

  const toggleSwitch = document.getElementById('toggle-switch');
  const statusBadge = document.getElementById('status-badge');
  const bannersCount = document.getElementById('banners-count');
  const videosCount = document.getElementById('videos-count');
  const defusedCount = document.getElementById('defused-count');

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

  // Load state on open
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(null, (data) => {
      updateUI(data || {});
    });
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
})();
