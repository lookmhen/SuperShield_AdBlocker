// icons/generate-icons.js
// High-resolution multi-size SuperShield AdBlocker icon generator with 4x supersampling anti-aliasing
import fs from 'node:fs';
import zlib from 'node:zlib';

function createShieldPNG(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  // Supersampling factor for smooth, crisp anti-aliasing
  const SAMPLES = 4;
  const invSamplesSq = 1 / (SAMPLES * SAMPLES);

  // Check if a point (nx, ny) is inside the shield
  // nx in [-1, 1], ny in [-1, 1]
  function getShieldGeometry(nx, ny) {
    // Top boundary with subtle arch
    const topY = -0.82 + 0.08 * (nx * nx);
    const bottomTipY = 0.90;

    if (ny < topY || ny > bottomTipY) {
      return { inShield: false, borderDist: 0 };
    }

    let maxWidth = 0;
    if (ny <= 0.0) {
      // Upper shield: straight/slight outward swell
      maxWidth = 0.80 + 0.04 * (1 - Math.pow(ny / 0.82, 2));
    } else {
      // Lower shield: smooth bezier-like taper to bottom tip
      const progress = ny / bottomTipY;
      maxWidth = 0.84 * Math.pow(1 - progress, 0.72);
    }

    const distFromCenter = Math.abs(nx);
    if (distFromCenter > maxWidth) {
      return { inShield: false, borderDist: 0 };
    }

    // Border thickness factor
    const edgeRatio = distFromCenter / maxWidth;
    const topEdgeDist = Math.abs(ny - topY);
    const bottomEdgeDist = Math.abs(ny - bottomTipY);

    const isRim = edgeRatio > 0.82 || topEdgeDist < 0.10 || (ny > 0.75 && edgeRatio > 0.65);
    const isInnerRim = !isRim && (edgeRatio > 0.72 || topEdgeDist < 0.16);

    // Inner Emblem: SuperShield "S" and Security Core
    // Stylized checkmark/S core in normalized coords
    let inEmblem = false;
    let emblemColor = null;

    // Checkmark / Central Security Crest
    // Checkmark stroke 1 (left down): from (-0.32, 0.02) to (-0.08, 0.32)
    // Checkmark stroke 2 (right up): from (-0.08, 0.32) to (0.36, -0.26)
    const distToSeg = (px, py, x1, y1, x2, y2) => {
      const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (l2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
    };

    const strokeWidth = size <= 16 ? 0.22 : 0.15;
    const d1 = distToSeg(nx, ny, -0.34, 0.04, -0.08, 0.36);
    const d2 = distToSeg(nx, ny, -0.08, 0.36, 0.38, -0.28);
    const minD = Math.min(d1, d2);

    if (minD <= strokeWidth) {
      inEmblem = true;
      emblemColor = { r: 255, g: 255, b: 255, a: 255 }; // Pure white security checkmark
    }

    return {
      inShield: true,
      isRim,
      isInnerRim,
      inEmblem,
      emblemColor,
      nx,
      ny
    };
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.52;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // PNG filter: None

    for (let x = 0; x < width; x++) {
      let accumR = 0;
      let accumG = 0;
      let accumB = 0;
      let accumA = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const subX = x + (sx + 0.5) / SAMPLES;
          const subY = y + (sy + 0.5) / SAMPLES;

          const nx = (subX - cx) / radius;
          const ny = (subY - cy) / radius;

          const geo = getShieldGeometry(nx, ny);

          if (!geo.inShield) {
            // Transparent background
            continue;
          }

          let r, g, b, a = 255;

          if (geo.inEmblem) {
            r = geo.emblemColor.r;
            g = geo.emblemColor.g;
            b = geo.emblemColor.b;
          } else if (geo.isRim) {
            // Glowing cyan-electric blue outer rim with metallic gradient
            const rimGradient = (geo.ny + 1) * 0.5;
            r = Math.round(14 + 20 * (1 - rimGradient));
            g = Math.round(165 + 40 * (1 - rimGradient));
            b = Math.round(233 + 22 * (1 - rimGradient));
          } else if (geo.isInnerRim) {
            // Darker metallic bevel
            r = 10;
            g = 90;
            b = 160;
          } else {
            // Shield Body: Deep modern royal-navy gradient with top-left specular highlight
            // Top: Vibrant Cobalt Blue (26, 86, 219) -> Bottom: Midnight Indigo (15, 23, 42)
            const t = (geo.ny + 0.8) / 1.7;
            const highlight = Math.max(0, 0.4 - Math.hypot(geo.nx + 0.3, geo.ny + 0.4));

            r = Math.min(255, Math.round((30 * (1 - t) + 12 * t) + highlight * 140));
            g = Math.min(255, Math.round((115 * (1 - t) + 35 * t) + highlight * 180));
            b = Math.min(255, Math.round((245 * (1 - t) + 110 * t) + highlight * 255));
          }

          accumR += r;
          accumG += g;
          accumB += b;
          accumA += a;
        }
      }

      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = Math.round(accumR * invSamplesSq);
      rawData[pxOffset + 1] = Math.round(accumG * invSamplesSq);
      rawData[pxOffset + 2] = Math.round(accumB * invSamplesSq);
      rawData[pxOffset + 3] = Math.round(accumA * invSamplesSq);
    }
  }

  const deflated = zlib.deflateSync(rawData);

  function createChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);

    let crc = 0xffffffff;
    const combined = Buffer.concat([typeBuf, data]);
    for (let i = 0; i < combined.length; i++) {
      crc ^= combined[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    crcBuf.writeUInt32BE(crc, 0);

    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdr = createChunk('IHDR', ihdrData);
  const idat = createChunk('IDAT', deflated);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

if (!fs.existsSync('icons')) {
  fs.mkdirSync('icons', { recursive: true });
}

[16, 48, 128].forEach(size => {
  fs.writeFileSync(`icons/icon${size}.png`, createShieldPNG(size));
  console.log(`Generated high-definition anti-aliased icons/icon${size}.png`);
});
