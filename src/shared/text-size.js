/* Shared preference values and renderer application; Default preserves the original sizes. */
(function (root) {
  const factors = Object.freeze({ small: 0.9, default: 1, large: 1.2, 'extra-large': 1.4 });
  const normalize = (value) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(factors, value) ? value : 'default';
  const sizes = { factors, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = sizes;
  else {
    root.PhotosTextSize = sizes;
    const apply = (value) => {
      const size = normalize(value);
      root.document.documentElement.dataset.textSize = size;
      root.document.documentElement.style.setProperty('--text-scale', factors[size]);
    };
    if (root.api && root.api.getTextSize) apply(root.api.getTextSize());
    if (root.api && root.api.onTextSizeChanged) root.api.onTextSizeChanged(apply);
  }
})(typeof window !== 'undefined' ? window : globalThis);
