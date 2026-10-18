/**
 * albums.js (M6, B.5) -- the All Albums overview ('albums' section).
 *
 * Albums are the user's source folders. A grid of rounded-square cards: an
 * "Add Folder..." card first (project-specific, not in Apple Photos), then
 * one card per folder with its newest visible item as cover, name, and the
 * same item count its grid shows. Exposed as window.__PhotosAlbumsView and
 * rendered by renderer.js's AppGrid. Folder operations go through
 * window.__PhotosFolderActions; nothing here touches photo files.
 */
(function () {
  const { h } = window.preact;
  const { useState, useEffect } = window.preactHooks;
  const S = window.__PhotosStores;

  const COVER_POLL_MS = 1500;
  const COVER_POLL_MAX = 20;

  function SvgIcon({ d, className }) {
    return h('svg', { class: className, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      h('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  const PLUS = 'M8 3v10 M3 8h10';
  const WARNING = 'M8 2.5l6 10.5H2z M8 6.5v3 M8 11.3v.2';
  const ALBUM = 'M3 5.5h10a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z M4.5 3.5h7';

  function AlbumsView() {
    const [albums, setAlbums] = useState(null); // [{ source, count, coverId }]
    const [coverPaths, setCoverPaths] = useState({}); // itemId -> path
    const [scanningId, setScanningId] = useState(S.scanStatusStore.get());
    useEffect(() => S.scanStatusStore.subscribe(setScanningId), []);

    useEffect(() => {
      let alive = true;
      let pollTimer = null;

      async function resolveCovers(ids, attempt) {
        if (!alive || ids.length === 0) return;
        const result = await window.api.getThumbnailPaths({ ids, size: 'sm' });
        if (!alive) return;
        const found = {};
        const pending = [];
        ids.forEach((id) => { if (result[id]) found[id] = result[id]; else pending.push(id); });
        setCoverPaths((prev) => Object.assign({}, prev, found));
        if (pending.length && attempt < COVER_POLL_MAX) {
          window.api.requestThumbnailPriority({ ids: pending, size: 'sm' });
          pollTimer = setTimeout(() => resolveCovers(pending, attempt + 1), COVER_POLL_MS);
        }
      }

      async function load() {
        clearTimeout(pollTimer);
        try {
          const sources = (await window.api.listSources()) || [];
          const details = await Promise.all(sources.map(async (source) => {
            const filter = 'source:' + source.id;
            const [count, page] = await Promise.all([
              window.api.getTotalCount({ filter }).catch(() => 0),
              window.api.getItemsPage({ filter, limit: 1 }).catch(() => null),
            ]);
            const first = page && page.items && page.items[0];
            return { source, count: count || 0, coverId: first ? first.id : null };
          }));
          if (!alive) return;
          setAlbums(details);
          resolveCovers(details.map((d) => d.coverId).filter((id) => id != null), 0);
        } catch (err) {
          console.error('Loading albums failed:', err);
        }
      }

      load();
      const unsubscribe = S.libraryChangeStore.subscribe(load);
      return () => { alive = false; clearTimeout(pollTimer); unsubscribe(); };
    }, []);

    if (albums === null) return null;

    const addCard = h('button', {
      class: 'album-card album-card-add', type: 'button',
      onClick: () => window.__PhotosFolderActions.pickAndAdd(),
    },
      h('div', { class: 'album-cover album-cover-add' }, h(SvgIcon, { d: PLUS, className: 'album-add-icon' })),
      h('div', { class: 'album-name' }, t('menu.file.addFolder')),
      h('div', { class: 'album-count' }, '\u00A0'));

    const cards = albums.map(({ source, count, coverId }) => {
      const path = coverId != null ? coverPaths[coverId] : null;
      const missing = source.status !== 'ok';
      return h('button', {
        key: source.id,
        class: 'album-card' + (missing ? ' is-missing' : ''),
        type: 'button',
        title: missing ? t('sidebar.folderMissingTip') : source.rootPath,
        onClick: () => S.sectionStore.set('source:' + source.id),
        onContextMenu: (e) => window.__PhotosAlbumContextMenu && window.__PhotosAlbumContextMenu(e, source),
      },
        h('div', { class: 'album-cover' },
          path
            ? h('img', { src: 'file://' + path, alt: '', draggable: false })
            : h(SvgIcon, { d: ALBUM, className: 'album-cover-placeholder' }),
          missing && h('span', { class: 'album-badge album-badge-missing' }, h(SvgIcon, { d: WARNING, className: 'album-badge-icon' })),
          !missing && scanningId === source.id && h('span', { class: 'album-badge album-badge-scanning', 'aria-label': t('sidebar.scanningAria') })),
        h('div', { class: 'album-name' }, source.displayName),
        h('div', { class: 'album-count' }, t('count.items', { count })));
    });

    return h('div', { class: 'albums-view' }, h('div', { class: 'albums-grid' }, addCard, cards));
  }

  window.__PhotosAlbumsView = AlbumsView;
})();
