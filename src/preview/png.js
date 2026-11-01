// Small PNG codec for our generated RGBA previews and bundled 8-bit material tiles.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export function encodePng(width, height, pixels) {
  if (pixels.length !== width * height * 4) throw new Error('Invalid RGBA dimensions');
  const chunk = (type, data) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  // Sub filtering compresses the flat background and adjacent textured faces well.
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1); raw[start] = 1;
    for (let x = 0; x < stride; x++) raw[start + 1 + x] = pixels[y * stride + x] - (x < 4 ? 0 : pixels[y * stride + x - 4]);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level:6})), chunk('IEND', Buffer.alloc(0))]);
}

export function decodePng(buffer) {
  if (!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Not a PNG');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20), type = buffer[25];
  if (buffer[24] !== 8 || ![2,6].includes(type) || buffer[28] !== 0 || width * height > 4e6) throw new Error('Unsupported material PNG');
  const chunks = [];
  for (let i = 8; i + 12 <= buffer.length;) {
    const n = buffer.readUInt32BE(i), end = i + 12 + n;
    if (end > buffer.length) throw new Error('Truncated PNG');
    if (buffer.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(buffer.subarray(i + 8, i + 8 + n));
    i = end;
  }
  const channels = type === 6 ? 4 : 3, stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks), {maxOutputLength:height * (stride + 1)});
  if (raw.length !== height * (stride + 1)) throw new Error('Invalid PNG rows');
  const decoded = Buffer.alloc(height * stride);
  const paeth = (a,b,c) => {
    const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x < channels ? 0 : decoded[at - channels], b = y ? decoded[at - stride] : 0, c = y && x >= channels ? decoded[at - stride - channels] : 0;
      decoded[at] = raw[y * (stride + 1) + 1 + x] + [0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
    }
  }
  if (channels === 4) return {width,height,pixels:decoded};
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) decoded.copy(pixels, i * 4, i * 3, i * 3 + 3);
  return {width,height,pixels};
}
