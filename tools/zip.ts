// ZIP を作る・読む（配布用の ZIP のため）。依存を増やさないよう、Node 標準の zlib だけで書く。
// 扱うのは、通常のファイルだけの小さな ZIP である（分割・暗号化・ZIP64 は扱わない）。
// 同じ内容なら同じ ZIP になるよう、日時は固定する。

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const UTF8 = 0x0800;
const DEFLATE = 8;
/** 1980-01-01 00:00:00（ZIP で表せる最も古い日時）。 */
const DOS_DATE = 0x0021;

export function zip(files: Record<string, Uint8Array>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of Object.keys(files).sort()) {
    const data = files[name]!;
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(DEFLATE, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

export function unzip(buffer: Buffer): Record<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('ZIP ではない');
  const count = buffer.readUInt16LE(end + 10);
  const files: Record<string, Buffer> = {};
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP の目次が読めない');
    const method = buffer.readUInt16LE(at + 10);
    const packedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const skip = buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const packed = buffer.subarray(start, start + packedSize);
    if (method !== 0 && method !== DEFLATE) throw new Error(`扱えない圧縮方式: ${name}`);
    const data = method === 0 ? Buffer.from(packed) : inflateRawSync(packed);
    if (crc32(data) !== buffer.readUInt32LE(at + 16)) throw new Error(`ZIP の中身が壊れている: ${name}`);
    if (!name.endsWith('/')) files[name] = data;
    at += 46 + nameLength + skip;
  }
  return files;
}
