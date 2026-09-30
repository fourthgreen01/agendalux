'use strict';

/* Upload de imagens: valida o conteúdo de verdade (magic bytes),
   recusa SVG/HTML e limita o tamanho — nada malicioso entra no Storage. */

const LIMIT = 800000; /* 800KB depois da redução feita no navegador */

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(LIMIT * 4 / 3) + 200) return null;
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) return null;
  let raw = m[2].replace(/\s+/g, '');
  if (raw.length % 4 !== 0) return null;
  let buf;
  try { buf = Buffer.from(raw, 'base64'); } catch (e) { return null; }
  if (!buf.length || buf.length > LIMIT) return null;
  const mime = sniff(buf);
  if (!mime) return null;                 /* rejeita SVG, HTML, scripts… */
  return { buffer: buf, mime };
}

function extOf(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

module.exports = { decodeDataUrl, extOf, sniff };
