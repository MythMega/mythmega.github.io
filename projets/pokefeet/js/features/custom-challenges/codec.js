// business/custom_challenges/custom-challenge-codec.js
// Encode / décode un challenge custom dans un code court utilisable dans une URL.
// Format du code :
//   [marqueur][base64url(...)]
//     marqueur '1' = JSON UTF-8 compressé (deflate-raw) puis base64url
//     marqueur '2' = JSON UTF-8 en base64url (fallback sans compression)
// Le décodage accepte aussi bien le code seul que l'URL complète
// "custom_play.html?code=<code>".

const CustomChallengeCodec = (function () {
  // ---- Utils binaires ----
  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function base64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // ---- API publique ----
  // data = { author, name, random, pokemons: [index, ...] }
  async function encode(data) {
    const payload = JSON.stringify({
      a: String(data.author || 'Trainer'),
      n: String(data.name || 'Challenge'),
      r: data.random ? 1 : 0,
      p: (data.pokemons || []).map(String)
    });
    const plainBytes = utf8Encode(payload);

    if (typeof CompressionStream !== 'undefined') {
      try {
        const compressed = await deflate(plainBytes);
        // On ne compresse que si ça raccourcit réellement
        if (compressed.length < plainBytes.length) {
          return '1' + bytesToBase64Url(compressed);
        }
      } catch (e) {
        // fallback ci-dessous
      }
    }
    return '2' + bytesToBase64Url(plainBytes);
  }

  // Accepte le code seul OU une URL complète (avec ?code=...)
  async function decode(input) {
    let code = String(input || '').trim();
    if (!code) return null;

    // Si c'est une URL complète, on extrait le paramètre code
    const m = code.match(/[?&]code=([^&#]+)/);
    if (m) code = m[1];

    // Décoder un éventuel percent-encoding
    try { code = decodeURIComponent(code); } catch (e) { /* on garde tel quel */ }

    if (code.length < 2) return null;
    const marker = code.charAt(0);
    const body = code.slice(1);
    if ((marker !== '1' && marker !== '2') || !body) return null;

    try {
      let bytes;
      if (marker === '1') {
        if (typeof DecompressionStream === 'undefined') return null;
        bytes = await inflate(base64UrlToBytes(body));
      } else {
        bytes = base64UrlToBytes(body);
      }
      const payload = JSON.parse(utf8Decode(bytes));
      if (!payload || !Array.isArray(payload.p)) return null;
      return {
        author: String(payload.a || 'Trainer'),
        name: String(payload.n || 'Challenge'),
        random: !!payload.r,
        pokemons: payload.p.map(function (idx) { return String(idx); })
      };
    } catch (e) {
      return null;
    }
  }

  return { encode, decode };
})();
