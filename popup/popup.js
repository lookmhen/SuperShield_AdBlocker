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

  // Custom Rules & Subscriptions UI
  const btnToggleCustomPanel = document.getElementById('btn-toggle-custom-panel');
  const customPanelBody = document.getElementById('custom-panel-body');
  const customPanelArrow = document.getElementById('custom-panel-arrow');
  const customTotalBadge = document.getElementById('custom-total-badge');
  const customRulesTextarea = document.getElementById('custom-rules-textarea');
  const customUserCount = document.getElementById('custom-user-count');
  const btnSaveCustomRules = document.getElementById('btn-save-custom-rules');
  const btnClearCustomRules = document.getElementById('btn-clear-custom-rules');
  const customRulesFeedback = document.getElementById('custom-rules-feedback');
  const subscriptionUrlInput = document.getElementById('subscription-url-input');
  const btnAddSubscription = document.getElementById('btn-add-subscription');
  const subFeedback = document.getElementById('sub-feedback');
  const subscriptionsContainer = document.getElementById('subscriptions-container');

  function countNonEmptyLines(text) {
    if (!text) return 0;
    return text.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('!') && !trimmed.startsWith('#');
    }).length;
  }

  function renderSubscriptions(subscriptions) {
    if (!subscriptionsContainer) return;
    subscriptionsContainer.innerHTML = '';

    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      subscriptionsContainer.innerHTML =
        '<div style="font-size: 10px; color: var(--text-muted); font-style: italic;">No active URL subscriptions</div>';
      return;
    }

    for (const sub of subscriptions) {
      const item = document.createElement('div');
      item.className = 'sub-item';

      const info = document.createElement('div');
      info.className = 'sub-item-info';

      const name = document.createElement('span');
      name.className = 'sub-item-name';
      name.textContent = sub.name || sub.url;
      name.title = sub.url;

      const count = document.createElement('span');
      count.className = 'sub-item-count';
      count.textContent = `${(sub.totalCount || sub.networkRulesCount || 0).toLocaleString()} rules`;

      info.appendChild(name);
      info.appendChild(count);

      const btnRemove = document.createElement('button');
      btnRemove.className = 'sub-item-remove';
      btnRemove.innerHTML = '✕';
      btnRemove.title = 'Remove this list';
      btnRemove.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'REMOVE_SUBSCRIPTION', url: sub.url }, (res) => {
            if (res && res.subscriptions) {
              renderSubscriptions(res.subscriptions);
              updateCustomBadge(customRulesTextarea?.value || '', res.subscriptions);
            }
          });
        }
      });

      item.appendChild(info);
      item.appendChild(btnRemove);
      subscriptionsContainer.appendChild(item);
    }
  }

  function updateCustomBadge(rulesText, subscriptions) {
    const userRulesCount = countNonEmptyLines(rulesText);
    const subRulesCount = (subscriptions || []).reduce(
      (acc, s) => acc + (s.totalCount || s.networkRulesCount || 0),
      0
    );
    const total = userRulesCount + subRulesCount;

    if (customTotalBadge) {
      customTotalBadge.textContent = total > 0 ? total.toLocaleString() : '0';
    }
    if (customUserCount) {
      customUserCount.textContent = `${userRulesCount} rule${userRulesCount === 1 ? '' : 's'}`;
    }
  }

  function loadCustomData() {
    if (typeof chrome === 'undefined') return;

    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_CUSTOM_DATA' }, (res) => {
        if (!res) return;
        if (customRulesTextarea && res.customRawRulesText !== undefined) {
          customRulesTextarea.value = res.customRawRulesText;
        }
        renderSubscriptions(res.subscriptions || []);
        updateCustomBadge(res.customRawRulesText || '', res.subscriptions || []);
      });
    } else if (chrome.storage?.local) {
      chrome.storage.local.get(['customRawRulesText', 'subscriptions'], (res) => {
        if (customRulesTextarea && res?.customRawRulesText !== undefined) {
          customRulesTextarea.value = res.customRawRulesText;
        }
        renderSubscriptions(res?.subscriptions || []);
        updateCustomBadge(res?.customRawRulesText || '', res?.subscriptions || []);
      });
    }
  }

  loadCustomData();

  if (btnToggleCustomPanel && customPanelBody && customPanelArrow) {
    btnToggleCustomPanel.addEventListener('click', () => {
      const isClosed = customPanelBody.style.display === 'none';
      customPanelBody.style.display = isClosed ? 'flex' : 'none';
      if (isClosed) {
        customPanelArrow.classList.add('open');
      } else {
        customPanelArrow.classList.remove('open');
      }
    });
  }

  if (customRulesTextarea) {
    customRulesTextarea.addEventListener('input', () => {
      const count = countNonEmptyLines(customRulesTextarea.value);
      if (customUserCount) {
        customUserCount.textContent = `${count} rule${count === 1 ? '' : 's'}`;
      }
    });
  }

  if (btnSaveCustomRules && customRulesTextarea) {
    btnSaveCustomRules.addEventListener('click', () => {
      const rulesText = customRulesTextarea.value;
      if (customRulesFeedback) {
        customRulesFeedback.textContent = 'Saving rules...';
        customRulesFeedback.className = 'feedback-msg loading';
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'SAVE_CUSTOM_RULES', rulesText }, (res) => {
          if (customRulesFeedback) {
            const count = countNonEmptyLines(rulesText);
            customRulesFeedback.textContent = `✓ Saved ${count} custom rules!`;
            customRulesFeedback.className = 'feedback-msg success';
            setTimeout(() => {
              if (customRulesFeedback) customRulesFeedback.textContent = '';
            }, 3000);
          }
          loadCustomData();
        });
      }
    });
  }

  if (btnClearCustomRules && customRulesTextarea) {
    btnClearCustomRules.addEventListener('click', () => {
      customRulesTextarea.value = '';
      if (customRulesFeedback) {
        customRulesFeedback.textContent = 'Clearing...';
        customRulesFeedback.className = 'feedback-msg loading';
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CLEAR_CUSTOM_RULES' }, () => {
          if (customRulesFeedback) {
            customRulesFeedback.textContent = '✓ Custom rules cleared.';
            customRulesFeedback.className = 'feedback-msg success';
            setTimeout(() => {
              if (customRulesFeedback) customRulesFeedback.textContent = '';
            }, 2500);
          }
          loadCustomData();
        });
      }
    });
  }

  if (btnAddSubscription && subscriptionUrlInput) {
    btnAddSubscription.addEventListener('click', () => {
      const url = subscriptionUrlInput.value.trim();
      if (!url) return;

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (subFeedback) {
          subFeedback.textContent = 'URL must start with https:// or http://';
          subFeedback.className = 'feedback-msg error';
        }
        return;
      }

      if (subFeedback) {
        subFeedback.textContent = 'Fetching and parsing blocklist...';
        subFeedback.className = 'feedback-msg loading';
      }
      btnAddSubscription.disabled = true;

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'ADD_SUBSCRIPTION', url }, (res) => {
          btnAddSubscription.disabled = false;
          if (res && res.success) {
            subscriptionUrlInput.value = '';
            if (subFeedback) {
              const count = res.subscription?.totalCount || 0;
              subFeedback.textContent = `✓ Added "${res.subscription?.name || 'List'}" (${count.toLocaleString()} rules)`;
              subFeedback.className = 'feedback-msg success';
              setTimeout(() => {
                if (subFeedback) subFeedback.textContent = '';
              }, 4000);
            }
            renderSubscriptions(res.subscriptions);
            updateCustomBadge(customRulesTextarea?.value || '', res.subscriptions);
          } else {
            if (subFeedback) {
              subFeedback.textContent = res?.error || 'Failed to download blocklist';
              subFeedback.className = 'feedback-msg error';
            }
          }
        });
      } else {
        btnAddSubscription.disabled = false;
      }
    });
  }
})();
