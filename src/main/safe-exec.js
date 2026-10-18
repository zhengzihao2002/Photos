/**
 * safe-exec.js  (M11) -- the only way this app starts an external program.
 *
 * The write guard cannot see inside child processes, so every command line is
 * checked here BEFORE it runs:
 *   - the program must be one of a short list (sips, ffmpeg, ffprobe, stat, mount, plutil);
 *     anything else is refused;
 *   - inputs are read-only by construction (the tools below only read their input
 *     unless told to write elsewhere);
 *   - any output path must be accepted by the write guard (inside the data or temp
 *     folder, never inside a source folder, never the input file itself);
 *   - sips must always have --out when it changes anything (without --out it edits the
 *     input file IN PLACE);
 *   - ffmpeg must run with -nostdin, has exactly one output (the last argument) and never
 *     writes to a "pipe:", "file:" or protocol URL.
 * validate() is pure apart from the guard lookup, so tests exercise it directly.
 */
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const writeGuard = require('./write-guard');

const SIPS_READ_ONLY = new Set(['-g', '--getProperty']);
// option -> number of values it takes
const SIPS_VALUES = { '-s': 2, '--setProperty': 2, '-Z': 1, '--resampleHeightWidthMax': 1, '-g': 1, '--getProperty': 1 };

function fail(msg) { return new Error('safe-exec refused: ' + msg); }

function outputAllowed(p, input) {
  if (typeof p !== 'string' || p === '') return false;
  if (input && path.resolve(p) === path.resolve(input)) return false;
  return writeGuard.isInstalled() ? writeGuard.check(p).ok : false;
}

function validateSips(args) {
  let out = null; const inputs = []; let modifies = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (a === '--out' || a === '-o') { out = args[i + 1]; i += 1; continue; }
    if (Object.prototype.hasOwnProperty.call(SIPS_VALUES, a)) {
      if (!SIPS_READ_ONLY.has(a)) modifies = true;
      i += SIPS_VALUES[a]; continue;
    }
    if (a.startsWith('-')) { modifies = true; continue; } // any other option may modify; require --out below
    inputs.push(a);
  }
  if (inputs.length !== 1) throw fail('sips needs exactly one input file');
  if (modifies && out === null) throw fail('sips would modify its input in place (no --out)');
  if (out !== null && !outputAllowed(out, inputs[0])) throw fail('sips output outside the data/temp folders: ' + out);
}

function validateFfmpeg(args) {
  const a = args.map(String);
  if (!a.includes('-nostdin')) throw fail('ffmpeg without -nostdin');
  const inputs = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] === '-i') { inputs.push(a[i + 1]); i += 1; }
  if (inputs.length !== 1) throw fail('ffmpeg needs exactly one input');
  const out = a[a.length - 1];
  if (a.length < 4 || out.startsWith('-') || a[a.length - 2] === '-i') throw fail('ffmpeg has no output file');
  if (/^[a-z][a-z0-9+.-]*:/i.test(out)) throw fail('ffmpeg output is a protocol URL: ' + out);
  if (!outputAllowed(out, inputs[0])) throw fail('ffmpeg output outside the data/temp folders: ' + out);
}

function validateFfprobe(args) {
  const a = args.map(String);
  if (a.some((x) => x === '-o' || x === '-write_index' || x === '-y')) throw fail('ffprobe may not write');
}

const TOOLS = {
  sips: validateSips,
  ffmpeg: validateFfmpeg,
  ffprobe: validateFfprobe,
  stat: (args) => {
    if (!(args.length === 3 && args[0] === '-f' && args[1] === '%Xf')) throw fail('stat is only used to read file flags');
  },
  mount: (args) => { if (args.length !== 0) throw fail('mount takes no arguments'); },
  plutil: (args) => {
    if (!(args.length === 4 && args[0] === '-extract' && args[1] === 'CFBundleIdentifier' && args[2] === 'raw')) throw fail('plutil is only used to read the bundle id');
  },
};

function toolOf(file) {
  const base = path.basename(String(file)).toLowerCase();
  return base.startsWith('ffmpeg') ? 'ffmpeg' : base.startsWith('ffprobe') ? 'ffprobe' : base;
}

/** Throws unless the command line is allowed. */
function validate(file, args) {
  const tool = toolOf(file);
  if (!Object.prototype.hasOwnProperty.call(TOOLS, tool)) throw fail('program not on the allowlist: ' + file);
  if (!Array.isArray(args)) throw fail('arguments must be an array');
  TOOLS[tool](args);
}

function safeExecFile(file, args, options, callback) {
  validate(file, args || []);
  return execFile(file, args || [], options || {}, callback);
}
const safeExecFileAsync = (file, args, options) => {
  validate(file, args || []);
  return promisify(execFile)(file, args || [], options || {});
};
function safeExecFileSync(file, args, options) {
  validate(file, args || []);
  return execFileSync(file, args || [], options || {});
}

module.exports = { validate, safeExecFile, safeExecFileAsync, safeExecFileSync, TOOLS };
