const { compareVersions } = require('./version-compare');

const RELEASES_URL = 'https://api.github.com/repos/zhengzihao2002/Photos/releases';
const validTag = tag => typeof tag === 'string' && /^v?\d+(\.\d+){1,3}$/.test(tag);

// Treat release text as text throughout; never send remote HTML to the renderer.
function plainNotes(value) {
  return value.replace(/\r/g, '').replace(/<!--[^]*?-->/g, '')
    .split(/^\*\*Install:\*\*/m)[0]
    .replace(/^Photos v?\d+(?:\.\d+)+\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim().slice(0, 12000);
}

function releaseNotes(body) {
  const text = typeof body === 'string' ? body : '';
  const sections = { en: [], 'zh-Hans': [] };
  let language = null, bilingual = false;
  for (const line of text.split('\n')) {
    if (/^## English\s*$/.test(line)) { language = 'en'; bilingual = true; }
    else if (/^## 简体中文\s*$/.test(line)) { language = 'zh-Hans'; bilingual = true; }
    else if (/^## /.test(line)) language = null;
    else if (language) sections[language].push(line);
  }
  const en = plainNotes(bilingual ? sections.en.join('\n') : text);
  return { en, 'zh-Hans': bilingual ? plainNotes(sections['zh-Hans'].join('\n')) || en : en };
}

function selectReleases(items, current, latest) {
  const seen = new Set(), out = [];
  for (const release of items) {
    if (!release || release.draft || release.prerelease || !validTag(release.tag_name)) continue;
    const version = release.tag_name.replace(/^v/, '');
    if (seen.has(version) || compareVersions(version, current) <= 0 || compareVersions(version, latest) > 0) continue;
    seen.add(version);
    out.push({ version, notes: releaseNotes(release.body) });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

async function loadReleaseNotes(fetchRelease, latestRelease, current, latest) {
  const releases = [latestRelease];
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await fetchRelease(`${RELEASES_URL}?per_page=100&page=${page}`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('unexpected releases response');
      releases.push(...items);
      if (!/rel="next"/.test(response.headers.get('link') || '')) {
        return { releases: selectReleases(releases, current, latest), notesIncomplete: false };
      }
    }
  } catch (_) { /* Release notes must never prevent installing an available update. */ }
  return { releases: selectReleases(releases, current, latest), notesIncomplete: true };
}

module.exports = { validTag, releaseNotes, selectReleases, loadReleaseNotes };
