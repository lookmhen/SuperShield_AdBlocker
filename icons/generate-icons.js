// icons/generate-icons.js
import fs from 'node:fs';
import zlib from 'node:zlib';

function createPNG(size) {
  // Minimal valid RGBA PNG generator
  const width = size;
  const height = size;
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  
  // Fill with a vibrant blue-shield color (R: 30, G: 144, B: 255, A: 255) with dark border
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const isBorder = (x === 0 || x === width - 1 || y === 0 || y === height - 1);
      if (isBorder) {
        rawData[pxOffset] = 16;     // R
        rawData[pxOffset + 1] = 78;  // G
        rawData[pxOffset + 2] = 180; // B
        rawData[pxOffset + 3] = 255; // A
      } else {
        rawData[pxOffset] = 30;     // R
        rawData[pxOffset + 1] = 144; // G
        rawData[pxOffset + 2] = 255; // B
        rawData[pxOffset + 3] = 255; // A
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);

  function createChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    
    // CRC calculation
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
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type: RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const ihdr = createChunk('IHDR', ihdrData);
  const idat = createChunk('IDAT', deflated);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

if (!fs.existsSync('icons')) {
  fs.mkdirSync('icons', { recursive: true });
}

[16, 48, 128].forEach(size => {
  fs.writeFileSync(`icons/icon${size}.png`, createPNG(size));
  console.log(`Generated icons/icon${size}.png`);
});
