// The pinned demuxer does not expose Matroska CodecDelay/SeekPreRoll. Read just
// TrackEntry metadata, never media blocks or a whole video buffer.
// https://www.matroska.org/technical/elements.html#CodecDelay
interface Element { id: number; data: number; end: number }
export interface MatroskaAudioTiming { delay: number; preroll: number }

export async function readMatroskaAudioTiming(file: Blob, trackId: number): Promise<MatroskaAudioTiming> {
  const none = { delay: 0, preroll: 0 };
  const head = new DataView(await file.slice(0, 4).arrayBuffer());
  if (head.byteLength < 4 || head.getUint32(0) !== 0x1a45dfa3) return none;
  const fail = () => new Error("Matroska 音轨时间信息不完整，无法准确导出。");
  const header = async (position: number, limit: number): Promise<Element> => {
    const bytes = new Uint8Array(await file.slice(position, Math.min(position + 12, limit)).arrayBuffer());
    let offset = 0;
    const vint = (id: boolean): number => {
      if (!bytes[offset]) throw fail();
      let length = 1, mask = 128;
      while (!(bytes[offset] & mask)) { length++; mask >>= 1; }
      if (length > (id ? 4 : 8) || offset + length > bytes.length) throw fail();
      let value = BigInt(id ? bytes[offset] : bytes[offset] & (mask - 1));
      for (let i = 1; i < length; i++) value = value * 256n + BigInt(bytes[offset + i]);
      offset += length;
      if (!id && value === (1n << BigInt(length * 7)) - 1n) return Infinity;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw fail();
      return Number(value);
    };
    const id = vint(true), size = vint(false), data = position + offset;
    if (Number.isFinite(size) && data + size > limit) throw fail();
    return { id, data, end: Number.isFinite(size) ? data + size : Infinity };
  };
  const children = async function* (start: number, end: number): AsyncGenerator<Element> {
    for (let offset = start, count = 0; offset < end; count++) {
      if (count > 4096) throw fail();
      const item = await header(offset, end); yield item;
      if (!Number.isFinite(item.end)) throw fail();
      offset = item.end;
    }
  };
  const uint = async (item: Element): Promise<number> => {
    if (item.end - item.data > 8) throw fail();
    const bytes = new Uint8Array(await file.slice(item.data, item.end).arrayBuffer());
    let value = 0; for (const byte of bytes) value = value * 256 + byte;
    if (!Number.isSafeInteger(value)) throw fail(); return value;
  };
  const tracks = async (item: Element): Promise<MatroskaAudioTiming> => {
    for await (const entry of children(item.data, item.end)) if (entry.id === 0xae) {
      let id = -1, delay = 0, preroll = 0;
      for await (const field of children(entry.data, entry.end)) {
        if (field.id === 0xd7) id = await uint(field);
        else if (field.id === 0x56aa) delay = await uint(field) / 1e9;
        else if (field.id === 0x56bb) preroll = await uint(field) / 1e9;
      }
      if (id === trackId) return { delay, preroll };
    }
    throw fail();
  };
  for await (const segment of children(0, file.size)) if (segment.id === 0x18538067) {
    const end = Math.min(file.size, segment.end);
    for await (const item of children(segment.data, end)) {
      if (item.id === 0x1654ae6b) return tracks(item);
      if (item.id === 0x114d9b74) {
        // Tracks may be after an unknown-sized cluster; use SeekHead when available.
        for await (const seek of children(item.data, item.end)) if (seek.id === 0x4dbb) {
          let id = 0, offset = -1;
          for await (const field of children(seek.data, seek.end)) {
            if (field.id === 0x53ab) id = await uint(field);
            else if (field.id === 0x53ac) offset = await uint(field);
          }
          if (id === 0x1654ae6b && offset >= 0) {
            const target = await header(segment.data + offset, end);
            if (target.id !== id) throw fail(); return tracks(target);
          }
        }
      }
    }
    throw fail();
  }
  throw fail();
}
