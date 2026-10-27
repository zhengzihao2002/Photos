/* Local category badges and text sizing shared by every map. No additional requests. */
(function (root) {
  const BADGES = {
    food: ['#f5a65e', 'M7 6v5a2 2 0 0 0 4 0V6 M9 6v12 M16 6v12 M16 6c-3 0-3 7 0 7'],
    cafe: ['#d3a17d', 'M6 8h10v7a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z M16 9h2a2 2 0 0 1 0 4h-2 M8 5v1 M12 5v1'],
    shopping: ['#edca5e', 'M6 9h12v10H6z M9 9V7a3 3 0 0 1 6 0v2'],
    culture: ['#e880c4', 'M5 9l7-4 7 4z M7 11v6 M12 11v6 M17 11v6 M5 19h14'],
    park: ['#72c77a', 'M12 4l-5 7h3l-4 5h12l-4-5h3z M12 16v4'],
    transit: ['#67b0f5', 'M7 5h10v12H7z M7 12h10 M10 8h4 M9 17l-2 3 M15 17l2 3 M9 15h.1 M15 15h.1'],
    lodging: ['#b094d8', 'M5 7v12 M5 15h14v4 M5 11h5v4 M10 10h7a2 2 0 0 1 2 2v3'],
    health: ['#f591a4', 'M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z'],
    education: ['#c3a183', 'M4 9l8-4 8 4-8 4z M7 11v5c3 2 7 2 10 0v-5 M20 9v7'],
    water: ['#66c5d8', 'M12 5v10 M7 10l5-3 5 3 M5 14l7 3 7-3-2 5H7z'],
    attraction: ['#b4a4e6', 'M12 4l2.5 5 5.5.8-4 4 .9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-4 5.5-.8z'],
    general: ['#a9baca', 'M12 5a5 5 0 0 0-5 5c0 4 5 9 5 9s5-5 5-9a5 5 0 0 0-5-5z M12 9v3'],
  };
  const images = new Map();
  function badge(category) {
    if (images.has(category)) return images.get(category);
    const canvas = root.document.createElement('canvas');
    canvas.width = canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.scale(40 / 24, 40 / 24);
    ctx.beginPath(); ctx.arc(12, 12, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = BADGES[category][0]; ctx.fill();
    ctx.strokeStyle = 'rgba(20,35,52,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#20354a'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new root.Path2D(BADGES[category][1]));
    const image = ctx.getImageData(0, 0, 40, 40);
    images.set(category, image);
    return image;
  }

  function scaleTextSize(value, factor) {
    if (typeof value === 'number') return value * factor;
    if (!Array.isArray(value)) return value;
    const copy = JSON.parse(JSON.stringify(value));
    // Keep zoom expressions at the top level, as required by the style specification.
    if (copy[0] === 'interpolate') {
      for (let i = 4; i < copy.length; i += 2) copy[i] = scaleTextSize(copy[i], factor);
    } else if (copy[0] === 'step') {
      copy[2] = scaleTextSize(copy[2], factor);
      for (let i = 4; i < copy.length; i += 2) copy[i] = scaleTextSize(copy[i], factor);
    } else return ['*', copy, factor];
    return copy;
  }
  function scaleStyle(base, factor) {
    const copy = JSON.parse(JSON.stringify(base));
    for (const layer of copy.layers) {
      if (layer.layout && layer.layout['text-size'] != null) layer.layout['text-size'] = scaleTextSize(layer.layout['text-size'], factor);
    }
    return copy;
  }
  function style(base) {
    const sizes = root.PhotosTextSize;
    const size = root.document.documentElement.dataset.textSize;
    const factor = sizes ? sizes.factors[sizes.normalize(size)] : 1;
    return factor === 1 ? base : scaleStyle(base, factor);
  }
  function prepare(map) {
    if (root.PhotosMapLabels) {
      root.PhotosMapLabels.install(root.maplibregl);
      map.setTransformRequest(root.PhotosMapLabels.transformRequest);
    }
    map.on('styleimagemissing', (e) => {
      const prefix = 'photos-poi-';
      if (typeof e.id !== 'string' || !e.id.startsWith(prefix)) return;
      const category = e.id.slice(prefix.length);
      if (Object.prototype.hasOwnProperty.call(BADGES, category) && !map.hasImage(e.id)) map.addImage(e.id, badge(category), { pixelRatio: 2 });
    });
    const off = root.api && root.api.onTextSizeChanged && root.api.onTextSizeChanged(() => {
      map.setStyle(root.__PhotosMapStyleFor(root.matchMedia('(prefers-color-scheme: dark)').matches));
    });
    map.on('remove', () => { if (typeof off === 'function') off(); });
  }
  const api = { style, prepare, scaleStyle, scaleTextSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotosMapPresentation = api;
})(typeof window !== 'undefined' ? window : globalThis);
