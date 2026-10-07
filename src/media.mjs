import { fail } from './store.mjs';
export function validateMediaSource(media) {
  try {
    if (media.url) {
      const url = new URL(media.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)whatsapp\.(net|com)$/.test(url.hostname)) throw Error();
    }
    if (media.directPath && (!media.directPath.startsWith('/') || media.directPath.startsWith('//') || /[\r\n]/.test(media.directPath))) throw Error();
    if (!media.url && !media.directPath) throw Error();
  } catch { throw fail('MEDIA_SOURCE_INVALID', 'Invalid provider media source'); }
}
export async function downloadMedia(lib, media, kind, maxBytes) {
  validateMediaSource(media);
  let stream;
  try {
    stream = await lib.downloadContentFromMessage(media, kind, { options: { signal: AbortSignal.timeout(20000), redirect: 'error' } });
    const chunks = []; let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) throw fail('MEDIA_TOO_LARGE', 'Media exceeds download limit');
      chunks.push(chunk);
    }
    if (!size) throw fail('MEDIA_EMPTY', 'Media is empty');
    return Buffer.concat(chunks);
  } finally { stream?.destroy(); }
}
