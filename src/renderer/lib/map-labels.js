/* Convert vector-tile text locally, preserving geometry, feature ids, keys and tags. */
(function (root) {
  const opencc = typeof module !== 'undefined' && module.exports ? require('../vendor/opencc/t2cn') : root.OpenCC;
  let converter;
  const cache = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  function simplify(text) {
    if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return text;
    if (cache.has(text)) return cache.get(text);
    if (!converter) converter = opencc.Converter({ from: 't', to: 'cn' });
    const result = converter(text);
    if (cache.size >= 4096) cache.clear();
    cache.set(text, result);
    return result;
  }
  function varint(data, cursor) {
    let value = 0, shift = 0;
    for (let i = 0; i < 10 && cursor.at < data.length; i++) {
      const byte = data[cursor.at++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error('invalid-vector-tile');
  }
  function encodeLength(n) {
    const out = [];
    do { const byte = n % 128; n = Math.floor(n / 128); out.push(byte | (n ? 128 : 0)); } while (n);
    return Uint8Array.from(out);
  }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
  function rewrite(data, field, transform) {
    const cursor = { at: 0 }, parts = [];
    while (cursor.at < data.length) {
      const start = cursor.at, key = varint(data, cursor), keyEnd = cursor.at;
      const wire = key % 8;
      if (wire === 2) {
        const length = varint(data, cursor), end = cursor.at + length;
        if (end > data.length) throw new Error('invalid-vector-tile');
        if (Math.floor(key / 8) === field) {
          const value = transform(data.subarray(cursor.at, end));
          parts.push(data.subarray(start, keyEnd), encodeLength(value.length), value);
        } else parts.push(data.subarray(start, end));
        cursor.at = end;
      } else {
        if (wire === 0) varint(data, cursor);
        else if (wire === 1) cursor.at += 8;
        else if (wire === 5) cursor.at += 4;
        else throw new Error('invalid-vector-tile');
        if (cursor.at > data.length) throw new Error('invalid-vector-tile');
        parts.push(data.subarray(start, cursor.at));
      }
    }
    return concat(parts);
  }
  function simplifyTile(buffer) {
    // Tile.layers (3) -> Layer.values (4) -> Value.string_value (1).
    return rewrite(new Uint8Array(buffer), 3, (layer) => rewrite(layer, 4, (value) =>
      rewrite(value, 1, (text) => encoder.encode(simplify(decoder.decode(text)))))).buffer;
  }
  const installed = new WeakSet();
  function install(gl) {
    if (installed.has(gl)) return;
    gl.addProtocol('photos-map', async (params, controller) => {
      const url = 'https://' + params.url.slice('photos-map://'.length);
      if (!url.startsWith('https://tiles.openfreemap.org/')) throw new Error('invalid-map-host');
      const response = await root.fetch(url, { signal: controller.signal, headers: params.headers });
      if (!response.ok) throw new Error('map-tile-' + response.status);
      return { data: simplifyTile(await response.arrayBuffer()), cacheControl: response.headers.get('cache-control'), expires: response.headers.get('expires') };
    });
    installed.add(gl);
  }
  function transformRequest(url, type) {
    const zh = root.i18n && root.i18n.getLocale() === 'zh-Hans';
    return { url: zh && type === 'Tile' && url.startsWith('https://tiles.openfreemap.org/') && /\.pbf(?:[?#]|$)/.test(url)
      ? 'photos-map://' + url.slice('https://'.length) : url };
  }
  const api = { simplify, simplifyTile, install, transformRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotosMapLabels = api;
})(typeof window !== 'undefined' ? window : globalThis);
