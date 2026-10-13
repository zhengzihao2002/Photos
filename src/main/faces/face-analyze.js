/**
 * face-analyze.js  (M10.3)
 *
 * Analyses ONE photo: decode -> detect (YuNet) -> align -> embed (SFace).
 * No database access; the face worker maps results to rows.
 *
 * READ-ONLY: source files are only read. HEIC/HEIF/BMP/RAW go through the
 * existing sips route (sips-decode.js, which refuses any output path outside
 * tmpFolder); that temp JPEG is deleted as soon as it is decoded.
 *
 * Input image: a ready 'md' thumbnail when given (1536 px, orientation baked
 * in), otherwise a display-oriented decode of the original, long edge <= 1536.
 *
 * Result: { ok: true, width, height, usedThumbnail, faces: [{ box, landmarks,
 *   score, sizePx, sharpness, canSeed, embedding }] }
 *   box [x, y, w, h] and landmarks (10 values) are 0..1 fractions of the image;
 *   embedding is a unit-length Float32Array(128).
 * or { ok: false, code, message } with the same codes as generate.js.
 */

// The runtime reads this when it loads; main.js sets it too (see M10 notes).
process.env.ORT_DISABLE_TELEMETRY = '1';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { sipsToJpeg, SIPS_EXTENSIONS } = require('../thumbnails/sips-decode');
const { SHARP_EXTENSIONS } = require('../thumbnails/generate');
const fm = require('./face-math');

// Raising this re-analyses every photo once (AuraFace v1 was evaluated in M10.5 and not adopted).
const PIPELINE_VERSION = 1;
const ANALYSIS_EDGE = 1536;
const DETECTOR_FILE = 'face_detection_yunet_2023mar.onnx';
const RECOGNIZER_FILE = 'face_recognition_sface_2021dec.onnx';

function fail(code, message) {
  return { ok: false, code, message: String(message).slice(0, 300) };
}

/** Loads both models once; CPU only (CoreML writes outside the project, see M10.2). */
async function loadModels(modelDir) {
  const ort = require('onnxruntime-node');
  const opts = { executionProviders: ['cpu'], logSeverityLevel: 3, intraOpNumThreads: 1, interOpNumThreads: 1 };
  const det = await ort.InferenceSession.create(path.join(modelDir, DETECTOR_FILE), opts);
  const rec = await ort.InferenceSession.create(path.join(modelDir, RECOGNIZER_FILE), opts);
  return { ort, det, rec };
}

async function checkReadable(p) {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fail('source_missing', err.message);
    if (err.code === 'EACCES' || err.code === 'EPERM') return fail('permission_denied', err.message);
    return fail('read_failed', err.message);
  }
}

function toRaw(input) {
  return sharp(input, { failOn: 'error' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: ANALYSIS_EDGE, height: ANALYSIS_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Returns { ok, img, W, H, usedThumbnail } or a failure. */
async function decodeAnalysisImage({ sourcePath, extension, mdPath, tmpFolder, id }) {
  if (mdPath) {
    try {
      const { data, info } = await toRaw(mdPath);
      return { ok: true, img: data, W: info.width, H: info.height, usedThumbnail: true };
    } catch (err) { /* fall back to the original */ }
  }
  const ext = String(extension || '').toLowerCase();
  const viaSips = SIPS_EXTENSIONS.has(ext);
  if (viaSips === false && SHARP_EXTENSIONS.has(ext) === false) return fail('unsupported_format', 'No face route for .' + ext);
  const unreadable = await checkReadable(sourcePath);
  if (unreadable) return unreadable;

  let input = sourcePath, temp = null;
  if (viaSips) {
    const decoded = await sipsToJpeg({ sourcePath, tmpFolder, id, maxEdge: ANALYSIS_EDGE });
    if (decoded.ok === false) return fail(decoded.code, decoded.message);
    input = decoded.path; temp = decoded.path;
  }
  try {
    const { data, info } = await toRaw(input);
    return { ok: true, img: data, W: info.width, H: info.height, usedThumbnail: false };
  } catch (err) {
    return fail('decode_failed', err.message);
  } finally {
    if (temp) await fs.promises.unlink(temp).catch(() => {});
  }
}

async function detect(models, img, W, H) {
  const D = fm.DET_SIZE;
  const scale = Math.min(D / W, D / H), sw = Math.round(W * scale), sh = Math.round(H * scale);
  const small = await sharp(img, { raw: { width: W, height: H, channels: 3 } }).resize(sw, sh)
    .extend({ right: D - sw, bottom: D - sh, background: { r: 0, g: 0, b: 0 } }).raw().toBuffer();
  const plane = D * D, input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { // YuNet expects BGR, 0..255
    input[i] = small[i * 3 + 2]; input[plane + i] = small[i * 3 + 1]; input[2 * plane + i] = small[i * 3];
  }
  const out = await models.det.run({ input: new models.ort.Tensor('float32', input, [1, 3, D, D]) });
  return fm.decodeDetections(out, sw / W);
}

async function embed(models, crop) {
  const S = fm.ALIGNED_SIZE, p = S * S, x = new Float32Array(3 * p);
  for (let i = 0; i < p; i++) { x[i] = crop[i * 3]; x[p + i] = crop[i * 3 + 1]; x[2 * p + i] = crop[i * 3 + 2]; } // RGB, 0..255
  const out = await models.rec.run({ [models.rec.inputNames[0]]: new models.ort.Tensor('float32', x, [1, 3, S, S]) });
  const e = out[models.rec.outputNames[0]].data;
  let norm = 0;
  for (let i = 0; i < e.length; i++) norm += e[i] * e[i];
  norm = Math.sqrt(norm) || 1;
  const unit = new Float32Array(e.length);
  for (let i = 0; i < e.length; i++) unit[i] = e[i] / norm;
  return unit;
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

async function analyzeImage({ models, sourcePath, extension, mdPath, tmpFolder, id }) {
  const decoded = await decodeAnalysisImage({ sourcePath, extension, mdPath, tmpFolder, id });
  if (decoded.ok === false) return decoded;
  const { img, W, H, usedThumbnail } = decoded;
  let found;
  try { found = await detect(models, img, W, H); } catch (err) { return fail('decode_failed', 'detect: ' + err.message); }
  const faces = [];
  for (const f of found) {
    const crop = fm.alignFace(img, W, H, f.lm);
    const sizePx = Math.round(Math.min(f.box[2], f.box[3]));
    const sharp1 = fm.sharpness(crop);
    let embedding;
    try { embedding = await embed(models, crop); } catch (err) { return fail('decode_failed', 'embed: ' + err.message); }
    const x0 = clamp01(f.box[0] / W), y0 = clamp01(f.box[1] / H);
    const x1 = clamp01((f.box[0] + f.box[2]) / W), y1 = clamp01((f.box[1] + f.box[3]) / H);
    const landmarks = new Float32Array(10);
    for (let k = 0; k < 5; k++) { landmarks[2 * k] = f.lm[k][0] / W; landmarks[2 * k + 1] = f.lm[k][1] / H; }
    faces.push({
      box: [x0, y0, x1 - x0, y1 - y0], landmarks, score: f.score, sizePx,
      sharpness: sharp1, canSeed: fm.canSeed(f.score, sizePx, sharp1), embedding,
    });
  }
  return { ok: true, width: W, height: H, usedThumbnail, faces };
}

module.exports = { PIPELINE_VERSION, loadModels, analyzeImage };
