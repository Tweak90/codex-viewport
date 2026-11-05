// Same visible pixel, distinct valid PNG metadata for independent fixture files.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=", "base64");
export function taggedPng(tag) {
  const type = Buffer.from("tEXt"), data = Buffer.from("fixture\0" + tag);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([pixel.subarray(0, -12), length, type, data, checksum, pixel.subarray(-12)]);
}
