// background/service-worker-logic.js

export const DEFAULT_STATE = {
  enabled: true,
  stats: {
    bannersBlocked: 0,
    videoAdsSkipped: 0,
    antiAdblockDefused: 0
  }
};

export async function handleMessage(message, storage) {
  if (!message || !message.type) {
    return await storage.get();
  }

  const current = await storage.get();
  const enabled = current.enabled !== undefined ? current.enabled : DEFAULT_STATE.enabled;
  const stats = {
    bannersBlocked: current.stats?.bannersBlocked || 0,
    videoAdsSkipped: current.stats?.videoAdsSkipped || 0,
    antiAdblockDefused: current.stats?.antiAdblockDefused || 0
  };

  const count = typeof message.count === 'number' && message.count > 0 ? message.count : 1;

  switch (message.type) {
    case 'AD_BLOCKED':
      stats.bannersBlocked += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'VIDEO_AD_SKIPPED':
      stats.videoAdsSkipped += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'ANTI_ADBLOCK_DEFUSED':
      stats.antiAdblockDefused += count;
      await storage.set({ stats });
      return { enabled, stats };

    case 'RESET_STATS':
      stats.bannersBlocked = 0;
      stats.videoAdsSkipped = 0;
      stats.antiAdblockDefused = 0;
      await storage.set({ stats });
      return { enabled, stats };

    case 'TOGGLE_ENABLED':
      const newEnabled = typeof message.enabled === 'boolean' ? message.enabled : !enabled;
      await storage.set({ enabled: newEnabled });
      return { enabled: newEnabled, stats };

    case 'GET_STATE':
    default:
      return { enabled, stats };
  }
}
