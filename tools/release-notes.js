const fs = require('node:fs');
const path = require('node:path');

function buildNotes(version, changelog, current) {
  const sections = changelog.split(/^## /m).slice(1);
  const exact = sections.find(s => s.startsWith(`[${version}]`) && /^(?:\s|$)/.test(s.slice(version.length + 2)));
  const notes = exact ? exact.slice(exact.indexOf('\n') + 1).trim() : current.trim();
  if (!notes) throw new Error('Release notes are required');
  return notes + '\n\n**Install:** download the repository and run `bash install.sh` (Apple Silicon, macOS 12+). The app is signed ad-hoc and not notarized; see the README for the one-time "Open Anyway" step.\n';
}

if (require.main === module) {
  const version = process.argv[2];
  if (!/^\d+(\.\d+){1,3}$/.test(version || '')) throw new Error('Expected a release version');
  const root = path.join(__dirname, '..');
  process.stdout.write(buildNotes(version, fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8')));
}
module.exports = { buildNotes };
