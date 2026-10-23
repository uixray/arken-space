import { deflateSync } from "node:zlib";

const onePixelPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);
const onePixelJpeg = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldZWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==",
  ),
  (character) => character.charCodeAt(0),
);
// Generated with installed Sharp 0.35.4/libvips 8.18.6; see the QA fixture
// provenance artifact for raw inputs, output hashes and frame verification.
const stillWebp = Uint8Array.from(
  atob("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQyH5Uu/+BiOh/AAA="),
  (character) => character.charCodeAt(0),
);
const animatedWebp = Uint8Array.from(
  atob(
    "UklGRogAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GKgAAAAAAAAAAAAEAAAEAAHgAAAJWUDhMEQAAAC8BQAAAB1CT1jem/4GI6H8AAEFOTUYqAAAAAAAAAAAAAQAAAQAA8AAAAFZQOEwRAAAALwFAAAAHUOpydKv/gYjofwAA",
  ),
  (character) => character.charCodeAt(0),
);

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.slice(4, 8 + data.length)));
  return chunk;
}

function jpegWithInvalidFrame() {
  const result = onePixelJpeg.slice();
  let offset = 2;
  while (offset + 4 < result.length) {
    if (result[offset] !== 0xff) break;
    while (result[offset] === 0xff) offset++;
    const marker = result[offset++]!;
    if (marker === 0xda || marker === 0xd9) break;
    const length = (result[offset]! << 8) | result[offset + 1]!;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      result[offset + 3] = 0;
      result[offset + 4] = 0;
      result[offset + 5] = 0;
      result[offset + 6] = 0;
      return result;
    }
    offset += length;
  }
  throw new Error("JPEG fixture has no frame header.");
}

function interlacedPng() {
  const signature = onePixelPng.slice(0, 8);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header.set([8, 6, 0, 0, 1], 8);
  const chunks = [
    pngChunk("IHDR", header),
    pngChunk(
      "IDAT",
      Uint8Array.from(deflateSync(Uint8Array.of(0, 255, 0, 0, 255))),
    ),
    pngChunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(
    signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  result.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function withPngTextVariant(variant = 0) {
  if (variant === 0) return onePixelPng;
  const data = new TextEncoder().encode(`v\0${variant}`);
  const chunk = pngChunk("tEXt", data);
  const insertion = onePixelPng.length - 12;
  const result = new Uint8Array(onePixelPng.length + chunk.length);
  result.set(onePixelPng.slice(0, insertion));
  result.set(chunk, insertion);
  result.set(onePixelPng.slice(insertion), insertion + chunk.length);
  return result;
}

function pngAtExactSize(targetBytes: number) {
  const data = new Uint8Array(targetBytes - onePixelPng.length - 12);
  data.fill(97);
  data[1] = 0;
  const chunk = pngChunk("tEXt", data);
  const insertion = onePixelPng.length - 12;
  const result = new Uint8Array(targetBytes);
  result.set(onePixelPng.slice(0, insertion));
  result.set(chunk, insertion);
  result.set(onePixelPng.slice(insertion), insertion + chunk.length);
  return result;
}

export const artbookImageFixtureBytes = {
  png: withPngTextVariant,
  interlacedPng,
  pngWithInvalidInterlaceMethod() {
    const result = interlacedPng();
    result[28] = 2;
    new DataView(result.buffer).setUint32(29, crc32(result.slice(12, 29)));
    return result;
  },
  pngAtExactSize,
  jpeg: () => onePixelJpeg,
  jpegWithInvalidFrame,
  webp: () => stillWebp,
  animatedWebp: () => animatedWebp,
};
