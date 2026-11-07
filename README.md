# SuperShield AdBlocker

Manifest V3 ad blocker for Google Chrome with DeclarativeNetRequest network rules, cosmetic element hiding, anti-adblock defusing, and video ad skipping.

## Features

- Blocks ad networks and trackers using DeclarativeNetRequest rulesets.
- Hides banner ads and affiliate promotions via cosmetic stylesheet and mutation observers.
- Neutralizes anti-adblock detection scripts and removes warning dialogs.
- Skips video ads automatically on YouTube and generic HTML5 video players.
- Disarms fake play button overlays and prevents popunder redirect traps on streaming pages.
- Includes an interactive element picker to create site-specific custom block rules.
- Scopes block counters per active tab, resetting to zero on new tabs.

## Project structure

- `manifest.json`: Extension Manifest V3 configuration.
- `background/`: Service worker handling state persistence, badge updates, and tab statistics.
- `content-scripts/`:
  - `defuser-main.js`: Runs in the main world at document start to defeat adblock detectors and strip YouTube ad payloads.
  - `defuser-isolated.js`: Runs in the isolated world to remove anti-adblock modal overlays.
  - `cosmetic-filter.js`: Scans and hides DOM banner ads and intercepts click traps.
  - `cosmetic.css`: Declarative rules hiding common ad containers and sponsored feeds.
  - `video-blocker.js`: Detects video ads, mutes them, accelerates playback, and clicks skip buttons.
  - `picker.js`: Interactive element picker and force play video helper.
- `popup/`: Popup interface with status badge, toggle, counters, and quick action buttons.
- `rules/`: DeclarativeNetRequest ruleset in `ad-rules.json`.
- `surrogates/`: Minimal mock implementations for Google AdSense and Prebid scripts.
- `tests/`: Automated unit tests using the Node.js test runner.

## Installation

### Load unpacked extension in Google Chrome

1. Clone this repository:
   ```bash
   git clone https://github.com/lookmhen/SuperShield_AdBlocker.git
   cd SuperShield_AdBlocker
   ```
2. Build the production files:
   ```bash
   npm install
   npm run build
   ```
3. Open Google Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** in the top right corner.
5. Click **Load unpacked** and select the `dist` folder generated inside the project directory.

Alternatively, you can load the root folder directly during local development.

## Testing and building

Run automated unit tests:

```bash
npm test
```

Build the standalone `dist/` directory and `supershield-adblocker.zip` archive:

```bash
npm run build
```

## License

MIT
