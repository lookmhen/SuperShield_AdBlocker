// scripts/build-dist.js
// Production bundler for SuperShield AdBlocker Manifest V3 Chrome Extension
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ZIP_PATH = path.join(ROOT_DIR, 'supershield-adblocker.zip');

console.log('🚀 Building SuperShield AdBlocker production distribution...\n');

// 1. Clean and recreate dist/ directory
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Define production items to copy
const COPY_ITEMS = [
  'manifest.json',
  'background',
  'content-scripts',
  'popup',
  'rules',
  'surrogates'
];

for (const item of COPY_ITEMS) {
  const src = path.join(ROOT_DIR, item);
  const dest = path.join(DIST_DIR, item);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  ✓ Copied ${item}/`);
  } else {
    console.warn(`  ⚠️ Warning: ${item} not found in root!`);
  }
}

// 3. Copy icons (production PNGs only, exclude development scripts)
const iconsDist = path.join(DIST_DIR, 'icons');
fs.mkdirSync(iconsDist, { recursive: true });
const iconFiles = ['icon16.png', 'icon48.png', 'icon128.png'];
for (const icon of iconFiles) {
  const src = path.join(ROOT_DIR, 'icons', icon);
  const dest = path.join(iconsDist, icon);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ Copied icons/${icon}`);
  }
}

// 4. Verify Manifest V3 integrity of the bundled dist/
const distManifestPath = path.join(DIST_DIR, 'manifest.json');
if (!fs.existsSync(distManifestPath)) {
  throw new Error('Build error: dist/manifest.json does not exist!');
}

const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));

const requiredFiles = [
  manifest.background?.service_worker,
  'background/service-worker-logic.js',
  manifest.action?.default_popup,
  'popup/popup.css',
  'popup/popup.js',
  manifest.action?.default_icon?.['16'],
  manifest.action?.default_icon?.['48'],
  manifest.action?.default_icon?.['128'],
  manifest.declarative_net_request?.rule_resources?.[0]?.path,
  ...(manifest.content_scripts?.[0]?.js || []),
  manifest.content_scripts?.[1]?.css?.[0],
  ...(manifest.content_scripts?.[1]?.js || []),
  ...(manifest.web_accessible_resources?.[0]?.resources || [])
].filter(Boolean);

for (const relPath of requiredFiles) {
  const absPath = path.join(DIST_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Build integrity verification failed: Missing ${relPath} in dist/`);
  }
}

console.log('\n✅ All Manifest V3 production files verified successfully in dist/');

// 5. Create ready-to-share ZIP package
try {
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force"`);
    console.log(`📦 Ready-to-share ZIP archive created: supershield-adblocker.zip`);
  }
} catch (err) {
  console.log(`  (Note: ZIP compression skipped: ${err.message})`);
}

console.log('\n🎉 Build complete! The dist/ folder contains ONLY production files ready for Chrome:');
console.log(`   Location: ${DIST_DIR}`);
