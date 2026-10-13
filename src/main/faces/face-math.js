/**
 * face-math.js  (M10.3)
 *
 * Pure calculations for the People pipeline: decoding YuNet's output grid,
 * aligning a face to SFace's 112x112 template, and a blur measure. No files,
 * no database, no ONNX runtime, so it is safe to load anywhere.
 *
 * Coordinates: everything here is in pixels of the "analysis image" (the
 * display-oriented decode, long edge at most 1536). Callers normalise.
 */

const DET_SIZE = 640;                 // YuNet's fixed input (measured in M10.2)
const ALIGNED_SIZE = 112;             // SFace's input
const STRIDES = [8, 16, 32];

// Starting values from the M10.1 design; tuned in M10.5. Changing any of these
// means raising PIPELINE_VERSION in face-analyze.js so existing rows are redone.
const THRESHOLDS = {
  detectScore: 0.7,      // faces below this are discarded
  minSizePx: 24,         // short side in the analysis image
  nmsIou: 0.3,
  maxFacesPerPhoto: 50,
  seedScore: 0.8,        // "can start a person": all three must hold
  seedSizePx: 56,
  seedSharpness: 40,
};

// SFace's 5-point template (eyes, nose tip, mouth corners), as used by OpenCV.
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

/**
 * Turns YuNet's 12 outputs into faces in analysis-image pixels.
 * scale = detection-image pixels per analysis-image pixel.
 * Returns [{ score, box: [x, y, w, h], lm: [[x, y] x5] }], best first.
 */
function decodeDetections(out, scale) {
  const found = [];
  for (const st of STRIDES) {
    const n = DET_SIZE / st;
    const cls = out['cls_' + st].data, obj = out['obj_' + st].data;
    const bb = out['bbox_' + st].data, kp = out['kps_' + st].data;
    for (let i = 0; i < n * n; i++) {
      const c1 = Math.min(Math.max(cls[i], 0), 1), o1 = Math.min(Math.max(obj[i], 0), 1);
      const score = Math.sqrt(c1 * o1);
      if (score < THRESHOLDS.detectScore) continue;
      const r = Math.floor(i / n), c = i % n;
      const cx = (c + bb[i * 4]) * st, cy = (r + bb[i * 4 + 1]) * st;
      const w = Math.exp(bb[i * 4 + 2]) * st, h = Math.exp(bb[i * 4 + 3]) * st;
      const lm = [];
      for (let k = 0; k < 5; k++) {
        lm.push([(kp[i * 10 + 2 * k] + c) * st / scale, (kp[i * 10 + 2 * k + 1] + r) * st / scale]);
      }
      found.push({ score, box: [(cx - w / 2) / scale, (cy - h / 2) / scale, w / scale, h / scale], lm });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of found) {
    if (Math.min(f.box[2], f.box[3]) < THRESHOLDS.minSizePx) continue;
    if (keep.every((k) => iou(k.box, f.box) <= THRESHOLDS.nmsIou)) keep.push(f);
    if (keep.length >= THRESHOLDS.maxFacesPerPhoto) break;
  }
  return keep;
}

/**
 * Least-squares similarity transform (landmarks -> template), then bilinear
 * sampling. img is packed RGB (W x H x 3). Returns a 112x112x3 RGB Buffer.
 * Pixels outside the image are black, as in OpenCV's alignCrop.
 */
function alignFace(img, W, H, lm) {
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let k = 0; k < 5; k++) { sx += lm[k][0]; sy += lm[k][1]; dx += TEMPLATE[k][0]; dy += TEMPLATE[k][1]; }
  sx /= 5; sy /= 5; dx /= 5; dy /= 5;
  let na = 0, nb = 0, den = 0;
  for (let k = 0; k < 5; k++) {
    const px = lm[k][0] - sx, py = lm[k][1] - sy, qx = TEMPLATE[k][0] - dx, qy = TEMPLATE[k][1] - dy;
    na += px * qx + py * qy; nb += px * qy - py * qx; den += px * px + py * py;
  }
  const a = na / den, b = nb / den, d = a * a + b * b;
  const get = (x, y, ch) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : img[(y * W + x) * 3 + ch];
  const S = ALIGNED_SIZE;
  const out = Buffer.alloc(S * S * 3);
  for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
    const qx = u - dx, qy = v - dy;
    const x = (a * qx + b * qy) / d + sx, y = (-b * qx + a * qy) / d + sy;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    for (let ch = 0; ch < 3; ch++) {
      const top = get(x0, y0, ch) * (1 - fx) + get(x0 + 1, y0, ch) * fx;
      const bot = get(x0, y0 + 1, ch) * (1 - fx) + get(x0 + 1, y0 + 1, ch) * fx;
      out[(v * S + u) * 3 + ch] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return out;
}

/** Blur measure: variance of the 4-neighbour Laplacian over the aligned face, in greyscale. */
function sharpness(crop) {
  const S = ALIGNED_SIZE;
  const g = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) g[i] = 0.299 * crop[i * 3] + 0.587 * crop[i * 3 + 1] + 0.114 * crop[i * 3 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    const lap = g[i - 1] + g[i + 1] + g[i - S] + g[i + S] - 4 * g[i];
    sum += lap; sumSq += lap * lap; n++;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Whether a face is reliable enough to start a new person (M10.1 part C). */
function canSeed(score, sizePx, sharp) {
  return score >= THRESHOLDS.seedScore && sizePx >= THRESHOLDS.seedSizePx && sharp >= THRESHOLDS.seedSharpness;
}

module.exports = { DET_SIZE, ALIGNED_SIZE, THRESHOLDS, decodeDetections, alignFace, sharpness, canSeed };
