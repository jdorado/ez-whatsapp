import { fail } from './store.mjs';
export function recipient(value) {
  if (typeof value !== 'string') throw fail('INVALID_INPUT', 'Supply --to with E.164 number or exact WhatsApp chat JID');
  if (/^\+[1-9]\d{6,14}$/.test(value)) return `${value.slice(1)}@s.whatsapp.net`;
  if (/^\d{7,15}@s\.whatsapp\.net$/.test(value) || /^\d+(?:-\d+)?@g\.us$/.test(value) || /^\d+@lid$/.test(value)) return value;
  throw fail('INVALID_INPUT', 'Use +countrycode number or exact @s.whatsapp.net, @lid, or @g.us JID');
}
export function normalize(m, unwrap, source = 'notify') {
  const key = m.key;
  if (!key?.id || !key.remoteJid || /@(broadcast|newsletter)$/.test(key.remoteJid)) return null;
  const content = unwrap(m.message) ?? {};
  const type = Object.keys(content).find(k => k !== 'messageContextInfo') ?? 'unknown';
  if (['protocolMessage', 'senderKeyDistributionMessage'].includes(type)) return null;
  return {
    id: key.id, chat: key.remoteJid, participant: key.participant ?? null,
    fromMe: Boolean(key.fromMe), source, timestamp: Number(m.messageTimestamp ?? 0),
    type, text: content.conversation ?? content.extendedTextMessage?.text ?? content[type]?.caption ?? null,
    // A LID is deliberately never represented as a phone number.
    phoneJid: key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? key.remoteJidAlt : null,
    quotedId: content[type]?.contextInfo?.stanzaId ?? null,
    mediaAvailable: ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(type)
  };
}
