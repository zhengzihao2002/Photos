/**
 * people.js (M10.6) -- the People page ('people' section, no person chosen).
 *
 * A grid of portrait cards from Apple Photos' People view: cover face crop,
 * name at the bottom left (none for unnamed people). Clicking a card opens
 * that person's photos (the normal Grid with person:<id>, via personStore).
 * Exposed as window.__PhotosPeopleView and rendered by renderer.js's AppGrid.
 * Read-only: nothing here writes to the database or to photo files.
 */
(function () {
  const { h } = window.preact;
  const { useState, useEffect, useRef } = window.preactHooks;
  const S = window.__PhotosStores;

  const COVER_POLL_MS = 1500;
  const COVER_POLL_MAX = 20;

  // M10.7: screens in the People section fade in instead of switching abruptly.
  const fadeIn = (el) => {
    if (el && el.dataset.faded !== '1') {
      el.dataset.faded = '1';
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  };

  function cardWidth(cols) {
    // The toolbar's - / + control: more grid columns means smaller cards.
    const c = Number.isFinite(cols) ? cols : 5;
    return Math.round(Math.min(320, Math.max(140, 1300 / Math.max(2, c * 0.9))));
  }

  let peopleSortByName = false; // M10.7: Sort by Name / Custom Order, kept for the session

  function PeopleView({ scope }) {
    const [people, setPeople] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [covers, setCovers] = useState({});
    // M10.7 Groups: named people often photographed together (People page only).
    const [groups, setGroups] = useState([]);
    const [groupThumbs, setGroupThumbs] = useState({});
    const [groupSel, setGroupSel] = useState(null);
    // M10.7 (Apple's model): People = named people; Add People (scope 'unnamed') = the rest.
    const unnamed = scope === 'unnamed';
    const [sortByName, setSortByNameState] = useState(peopleSortByName);
    const setSortByName = (v) => { peopleSortByName = v; setSortByNameState(v); };
    const dragId = useRef(null);
    // Apple: one click selects (outlined), double click or Return opens.
    // M10.7: several can be selected with Command- or Shift-click.
    const [selected, setSelected] = useState([]);
    const [naming, setNaming] = useState(null); // person id whose name field is open
    useEffect(() => {
      const onKey = (e) => {
        if (naming != null || S.viewerStore.get() != null) return;
        if (e.key === 'Enter' && selected.length === 1) { e.preventDefault(); S.personStore.set({ id: selected[0] }); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selected, naming]);
    useEffect(() => {
      if (people && selected.some((id) => people.every((p) => p.id !== id))) setSelected(selected.filter((id) => people.some((p) => p.id === id)));
    }, [people, selected]);

    const changed = () => S.peopleChangeStore.bump();
    // Return closes the field, which also fires blur: save only once per editing session.
    const committing = useRef(false);
    async function commitName(person, value) {
      if (committing.current) return;
      committing.current = true;
      setNaming(null);
      const name = String(value || '').trim();
      if (name === (person.name || '')) return;
      try {
        const r = await window.api.renamePerson(person.id, name);
        if (r && r.ok === false && r.sameNameId) {
          if (window.confirm(t('people.confirm.exists', { name }))) {
            await window.api.mergePeople(r.sameNameId, [person.id]);
          }
        }
      } catch (err) { S.noticeStore.set(t('people.err.name', { details: err.message })); }
      changed();
    }
    async function onMenu(e, person) {
      e.preventDefault(); e.stopPropagation();
      const ids = selected.includes(person.id) ? selected : [person.id];
      if (ids !== selected) setSelected(ids);
      const chosen = people.filter((p) => ids.includes(p.id));
      let res;
      try {
        res = await window.api.showPersonContextMenu({ count: ids.length, named: Boolean(person.name), hidden: chosen.every((p) => p.hidden) });
      } catch (err) { S.noticeStore.set(t('err.menu', { details: err.message })); return; }
      const action = res && res.action;
      try {
        if (action === 'name') { committing.current = false; setNaming(person.id); }
        else if (action === 'hide') {
          // Apple's model: Hide sends the person back to Add People (name cleared).
          for (const id of ids) await window.api.unnamePerson(id);
          changed();
        } else if (action === 'merge') {
          const target = chosen.slice().sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || b.photoCount - a.photoCount)[0];
          if (window.confirm(t('people.confirm.merge', { count: ids.length }))) {
            await window.api.mergePeople(target.id, ids.filter((id) => id !== target.id));
            setSelected([target.id]);
            changed();
          }
        }
      } catch (err) { S.noticeStore.set(t('people.err.change', { details: err.message })); }
    }
    const [cols, setCols] = useState(S.columnsStore ? S.columnsStore.get() : 5);
    useEffect(() => (S.columnsStore ? S.columnsStore.subscribe(setCols) : undefined), []);

    useEffect(() => {
      let alive = true;
      let pollTimer = null;
      async function resolveCovers(ids, attempt) {
        if (alive === false || ids.length === 0) return;
        const result = await window.api.getPeopleCovers(ids);
        if (alive === false) return;
        setCovers((prev) => Object.assign({}, prev, result));
        const missing = ids.filter((id) => result[id] == null);
        if (missing.length && attempt < COVER_POLL_MAX) {
          pollTimer = setTimeout(() => resolveCovers(missing, attempt + 1), COVER_POLL_MS);
        }
      }
      async function load() {
        try {
          const r = await window.api.listPeople({ scope: unnamed ? 'unnamed' : 'named' });
          if (alive === false) return;
          setPeople(r.people);
          if (scope !== 'unnamed') {
            const g = await window.api.listPeopleGroups();
            if (alive === false) return;
            setGroups(g);
            const ids = g.map((x) => x.coverItemId);
            if (ids.length) {
              const t = await window.api.getThumbnailPaths({ ids, size: 'sm' });
              if (alive) setGroupThumbs(t || {});
            }
          }
          setAnalysis(r.analysis);
          clearTimeout(pollTimer);
          resolveCovers(r.people.map((p) => p.id), 0);
        } catch (err) { console.error('People list failed:', err); }
      }
      load();
      const offPeople = S.peopleChangeStore.subscribe(load);
      const offLibrary = S.libraryChangeStore.subscribe(load);
      const offProgress = window.api.onProgress((p) => {
        if (p && p.taskId === 'face-analysis' && p.state !== 'people') {
          setAnalysis({ state: p.state, done: p.current, total: p.total });
        }
      });
      return () => { alive = false; clearTimeout(pollTimer); offPeople(); offLibrary(); offProgress(); };
    }, []);

    if (people == null) return null;
    const finding = analysis && (analysis.state === 'analyzing' || analysis.state === 'waiting' || analysis.state === 'starting')
      && analysis.total > 0 && analysis.done < analysis.total;
    const list = sortByName
      ? people.slice().sort((a, b) => (a.name == null) - (b.name == null) || String(a.name || '').localeCompare(String(b.name || '')) || b.photoCount - a.photoCount)
      : people;
    const w = cardWidth(cols);

    const heading = h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 14px' } },
      h('div', null,
        h('div', { style: { fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' } }, unnamed ? t('people.addPeople') : t('people.title')),
        unnamed && h('div', { style: { fontSize: '12px', marginTop: '3px', color: 'var(--text-secondary, #8e8e93)' } }, t('people.addPeople.hint'))),
      unnamed === false && people.length > 1 && h('button', {
        type: 'button', title: t('people.sort'),
        onClick: async (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          try {
            const res = await window.api.showPeopleSortMenu({ current: sortByName ? 'name' : 'custom', x: r.left, y: r.bottom + 4 });
            if (res && res.choice) setSortByName(res.choice === 'name');
          } catch (err) { S.noticeStore.set(t('err.menu', { details: err.message })); }
        },
        style: { marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--accent, #2f7ff7)', fontSize: '13px', cursor: 'pointer', padding: '2px 4px' },
      }, t('people.sort')));

    const empty = people.length === 0 && h('div', { style: { minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-secondary, #8e8e93)' } },
      h('div', { style: { fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' } }, unnamed ? t('people.everyoneNamed') : t('people.none')),
      h('div', { style: { fontSize: '13px' } }, unnamed ? t('people.none.unnamedHint') : t('people.none.namedHint')));

    const cards = list.map((p) => h('button', {
      key: p.id, type: 'button', title: t('people.cardTip', { name: p.name || t('people.unnamed'), count: p.photoCount }),
      onClick: (e) => {
        e.stopPropagation();
        if (e.metaKey || e.shiftKey) setSelected(selected.includes(p.id) ? selected.filter((id) => id !== p.id) : selected.concat(p.id));
        else setSelected([p.id]);
      },
      onContextMenu: (e) => onMenu(e, p),
      // Custom Order: drag a card onto another to move it there.
      draggable: unnamed === false && sortByName === false && naming == null,
      onDragStart: (e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move'; },
      onDragOver: (e) => { if (dragId.current != null) e.preventDefault(); },
      onDragEnd: () => { dragId.current = null; },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragId.current;
        dragId.current = null;
        if (from == null || from === p.id) return;
        const oldFrom = people.findIndex((x) => x.id === from), oldTo = people.findIndex((x) => x.id === p.id);
        const ids = people.map((x) => x.id).filter((id) => id !== from);
        ids.splice(ids.indexOf(p.id) + (oldFrom < oldTo ? 1 : 0), 0, from);
        setPeople(ids.map((id) => people.find((x) => x.id === id)));
        window.api.setPeopleOrder(ids).catch((err) => S.noticeStore.set(t('people.err.order', { details: err.message })));
      },
      onDblClick: () => S.personStore.set({ id: p.id }),
      style: {
        position: 'relative', width: w + 'px', aspectRatio: '3 / 4', padding: 0, border: 'none', borderRadius: '10px',
        overflow: 'hidden', cursor: 'pointer', background: 'var(--tile-placeholder, rgba(128,128,128,0.18))',
        opacity: p.hidden ? 0.45 : 1,
        boxShadow: selected.includes(p.id) ? '0 0 0 3px var(--accent, #2f7ff7)' : 'none',
      },
    },
      covers[p.id] && h('img', { src: covers[p.id], alt: '', draggable: false, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
      naming === p.id && h('input', {
        type: 'text', defaultValue: p.name || '', placeholder: t('people.addName'), maxLength: 100,
        ref: (el) => { if (el && el.dataset.focused !== '1') { el.dataset.focused = '1'; el.focus(); el.select(); } },
        onClick: (e) => e.stopPropagation(), onDblClick: (e) => e.stopPropagation(),
        onKeyDown: (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitName(p, e.currentTarget.value);
          else if (e.key === 'Escape') setNaming(null);
        },
        onBlur: (e) => { if (naming === p.id) commitName(p, e.currentTarget.value); },
        style: { position: 'absolute', left: '8px', right: '8px', bottom: '8px', zIndex: 2, padding: '6px 8px', fontSize: '13px',
          borderRadius: '6px', border: '1px solid var(--accent, #2f7ff7)', background: 'rgba(0,0,0,0.65)', color: '#fff', outline: 'none' },
      }),
      naming !== p.id && p.name && h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 12px 10px', textAlign: 'left',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', color: '#fff', fontSize: '13px', fontWeight: 700,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name)));

    return h('div', { ref: fadeIn, onClick: () => setSelected([]), style: { height: '100%', overflowY: 'auto', padding: '20px 32px 32px', boxSizing: 'border-box' } },
      unnamed === false && h('div', { style: { fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' } }, t('people.groups')),
      unnamed === false && (groups.length === 0
        ? h('div', { style: { borderRadius: '12px', background: 'rgba(128,128,128,0.12)', padding: '18px 20px', margin: '0 0 30px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' } }, t('people.noGroups')),
          h('div', { style: { fontSize: '12px', color: 'var(--text-secondary, #8e8e93)' } },
            t('people.noGroups.hint')))
        : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '24px', margin: '0 0 30px' } },
          groups.map((g) => {
            const key = g.ids.join(',');
            return h('button', {
              key, type: 'button', title: g.names.join(', ') + ' \u00B7 ' + g.photoCount + ' photos',
              onClick: (e) => { e.stopPropagation(); setGroupSel(key); },
              onDblClick: () => { if (S.groupStore) S.groupStore.set({ ids: g.ids, names: g.names }); },
              style: { position: 'relative', width: Math.round(w * 1.4) + 'px', aspectRatio: '4 / 3', padding: 0, border: 'none',
                borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', background: 'rgba(128,128,128,0.18)',
                boxShadow: groupSel === key ? '0 0 0 3px var(--accent, #2f7ff7)' : 'none' },
            },
              groupThumbs[g.coverItemId] && h('img', { src: groupThumbs[g.coverItemId], alt: '', draggable: false,
                style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
              h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 12px 10px', textAlign: 'left',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', color: '#fff', fontSize: '13px', fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                g.names.length === 2 ? g.names.join(' & ') : g.names.slice(0, -1).join(', ') + ' & ' + g.names[g.names.length - 1]));
          }))),
      heading,
      empty,
      people.length > 0 && h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '24px' } }, cards),
      finding && h('div', { style: { marginTop: '22px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary, #8e8e93)' } }, t('people.finding')));
  }

  window.__PhotosPeopleView = PeopleView;

  /** M10.6: recognised people in one photo, for the viewer (null on failure). */
  window.__PhotosPeopleForItem = (itemId) => ((S.peopleEnabledStore && S.peopleEnabledStore.get() === false)
    ? Promise.resolve([]) // M10.8: View > People off: no People section in the viewer
    : window.api.getPeopleForItem(itemId)
      // M8c.5: named people first, then unnamed; stable, so each group stays left to right.
      .then((rows) => (Array.isArray(rows) ? rows.slice().sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0)) : rows))
      .catch(() => null));

  /**
   * M10.6: People section below the photo in the viewer, above Places. Reuses
   * the Places panel's classes, so it slides with the same "sheet". One tile
   * per person, cropped from this photo; click opens that person's page.
   */
  function ViewerPeople({ item, sheet, height, list, onWheel }) {
    const [crops, setCrops] = useState({});
    const itemId = item ? item.id : null;
    useEffect(() => {
      // Covers are kept between photos (no flicker); keyed by person.
      if (itemId == null || list == null || list.length === 0) return undefined;
      let alive = true;
      let timer = null;
      // Each person is shown by their key photo (cover), the same everywhere.
      const ids = [...new Set(list.map((r) => r.personId))];
      let tries = 0;
      const poll = () => {
        window.api.getPeopleCovers(ids).then((r) => {
          if (alive === false) return;
          setCrops((prev) => Object.assign({}, prev, r));
          if (ids.some((id) => r[id] == null) && tries++ < 15) timer = setTimeout(poll, 1200);
        }).catch(() => {});
      };
      poll();
      return () => { alive = false; clearTimeout(timer); };
    }, [itemId, list]);

    const shown = list || [];
    const active = sheet > 0 && shown.length > 0;
    const open = (personId) => {
      // K12: remember the photo (and the page it was on), so the person page's
      // Back returns there, scrolled to this People section.
      const returnTo = {
        section: S.sectionStore.get(),
        person: S.personStore ? S.personStore.get() : null,
        group: S.groupStore ? S.groupStore.get() : null,
        mapArea: S.mapAreaStore ? S.mapAreaStore.get() : null,
        itemId,
        sheet: window.__PhotosViewerSheetValue ? window.__PhotosViewerSheetValue() : 0,
      };
      S.viewerStore.close();
      S.sectionStore.set('people');
      S.personStore.set({ id: personId, returnTo });
    };
    return h('div', {
      class: 'vp-panel', onWheel,
      style: { height: height + 'px', transform: 'translateY(' + (-sheet) + 'px)', visibility: active ? 'visible' : 'hidden' },
    },
      h('div', { class: 'vp-inner' },
        h('div', { class: 'vp-head' }, h('span', { class: 'vp-title' }, t('people.title'))),
        h('div', { style: { display: 'flex', gap: '28px', overflowX: 'auto', padding: '10px 0 6px' } },
          shown.map((p) => h('button', {
            key: p.faceId, type: 'button', title: p.name || t('people.unnamed'),
            onClick: () => open(p.personId),
            style: { flex: '0 0 auto', width: '136px', height: '136px', padding: 0, border: 'none', borderRadius: '10px',
              overflow: 'hidden', cursor: 'pointer', background: 'rgba(128,128,128,0.25)' },
          }, crops[p.personId] && h('img', { src: crops[p.personId], alt: '', draggable: false,
            style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }))))));
  }

  window.__PhotosViewerPeople = ViewerPeople;

  /**
   * M10.7: a person's faces ('faces') or their groups of very alike faces
   * ('review'), from the person page's ... menu. Corrections go through
   * people:* channels (database only).
   */
  function PersonFacesView({ personId, mode }) {
    const [info, setInfo] = useState(null);
    const [faces, setFaces] = useState(null);       // faces mode
    const [groups, setGroups] = useState(null);     // review mode
    const [suggestions, setSuggestions] = useState(null); // review mode: groups that may be this person
    // The toolbar's - / + (grid columns) scales the review faces too.
    const [cols, setCols] = useState(S.columnsStore ? S.columnsStore.get() : 5);
    useEffect(() => (S.columnsStore ? S.columnsStore.subscribe(setCols) : undefined), []);
    const zoom = (base) => Math.round(base * Math.min(4, Math.max(0.6, 7 / Math.max(1.75, Number(cols) || 5))));
    // The ... menu's Show setting: 'faces' = face crops, 'photos' = each face's whole photo.
    const [display, setDisplay] = useState(S.faceDisplayStore ? S.faceDisplayStore.get() : 'faces');
    useEffect(() => (S.faceDisplayStore ? S.faceDisplayStore.subscribe(setDisplay) : undefined), []);
    const [thumbs, setThumbs] = useState({}); // itemId -> small thumbnail path
    // A group's row shows samples; "+N" expands it in place to every face of the group.
    const [expanded, setExpanded] = useState({}); // clusterId -> [{ faceId, itemId }]
    async function toggleExpand(clusterId) {
      if (expanded[clusterId]) {
        setExpanded((m) => { const next = Object.assign({}, m); delete next[clusterId]; return next; });
        return;
      }
      try {
        const list = await window.api.getClusterFaces(clusterId);
        setExpanded((m) => Object.assign({}, m, { [clusterId]: list }));
      } catch (err) { S.noticeStore.set(t('people.err.group', { details: err.message })); }
    }
    const [crops, setCrops] = useState({});
    const [selected, setSelected] = useState([]);
    const wanted = useRef(new Set());
    const timer = useRef(null);
    const observer = useRef(null);
    const name = (info && info.name) || t('people.thisPerson');

    useEffect(() => {
      let alive = true;
      const load = async () => {
        try {
          const p = await window.api.getPerson(personId);
          if (alive === false) return;
          setInfo(p);
          if (mode === 'review') {
            const [g, sg] = await Promise.all([window.api.getPersonClusters(personId), window.api.getPersonSuggestions(personId)]);
            if (alive === false) return;
            setGroups(g);
            setSuggestions(sg);
            const all = g.concat(sg);
            const c = {};
            for (const x of all) for (const fc of x.faces) if (fc.crop) c[fc.faceId] = fc.crop;
            setCrops((prev) => Object.assign({}, prev, c));
            if (all.some((x) => x.faces.some((fc) => fc.crop == null))) { clearTimeout(timer.current); timer.current = setTimeout(load, 1500); }
          } else {
            const list = await window.api.getPersonFaces(personId);
            if (alive) setFaces(list);
          }
        } catch (err) { S.noticeStore.set(t('people.err.faces', { details: err.message })); }
      };
      load();
      const off = S.peopleChangeStore.subscribe(load);
      return () => { alive = false; off(); clearTimeout(timer.current); };
    }, [personId, mode]);

    // Faces mode: ask for crops of tiles that are on screen, in batches.
    const flush = () => {
      const ids = [...wanted.current].slice(0, 100);
      if (ids.length === 0) return;
      window.api.getFaceCrops(ids).then((r) => {
        const got = {};
        for (const id of ids) if (r[id]) { got[id] = r[id]; wanted.current.delete(id); }
        setCrops((prev) => Object.assign({}, prev, got));
        clearTimeout(timer.current);
        if (wanted.current.size) timer.current = setTimeout(flush, 1200);
      }).catch(() => {});
    };
    useEffect(() => {
      observer.current = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) wanted.current.add(Number(e.target.dataset.face));
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 60);
      }, { rootMargin: '200px' });
      return () => observer.current.disconnect();
    }, [personId]);
    const watch = (el) => { if (el && observer.current && el.dataset.watched !== '1') { el.dataset.watched = '1'; observer.current.observe(el); } };

    const changed = () => S.peopleChangeStore.bump();
    async function removeGroup(g) {
      if (window.confirm(t('people.confirm.removeGroup', { count: g.faceCount, name })) === false) return;
      try { await window.api.removeClusterFromPerson(personId, g.clusterId); } catch (err) { S.noticeStore.set(t('people.err.removeGroup', { details: err.message })); }
      changed();
    }

    async function answer(sg, yes) {
      setSuggestions((list) => (list || []).filter((x) => x.clusterId !== sg.clusterId));
      try {
        if (yes) await window.api.addClusterToPerson(personId, sg.clusterId);
        else await window.api.rejectClusterForPerson(personId, sg.clusterId);
      } catch (err) { S.noticeStore.set(t('people.err.update', { details: err.message })); }
      changed();
    }

    // Whole photos for the rows on show, when Show is Photos.
    useEffect(() => {
      if (mode !== 'review') return undefined;
      const ids = new Set();
      for (const x of (groups || []).concat(suggestions || [])) for (const fc of x.faces) if (fc.itemId) ids.add(fc.itemId);
      for (const k of Object.keys(expanded)) for (const fc of expanded[k]) ids.add(fc.itemId);
      const need = [...ids].filter((id) => thumbs[id] == null).slice(0, 500);
      if (need.length === 0) return undefined;
      let alive = true;
      window.api.getThumbnailPaths({ ids: need, size: 'sm' }).then((r) => {
        if (alive === false) return;
        const got = {};
        for (const id of need) if (r[id]) got[id] = r[id];
        if (Object.keys(got).length) setThumbs((prev) => Object.assign({}, prev, got));
      }).catch(() => {});
      return () => { alive = false; };
    }, [display, mode, groups, suggestions, expanded]);

    // Same framing as the grid's Show Faces: the face box enlarged 1.8x, kept inside the image.
    const reviewInset = (b) => {
      const k = 1.8, cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
      const w = Math.min(1, b[2] * k), hh = Math.min(1, b[3] * k);
      const l = Math.min(Math.max(0, cx - w / 2), 1 - w), t = Math.min(Math.max(0, cy - hh / 2), 1 - hh);
      const pct = (v) => (Math.max(0, v) * 100).toFixed(2) + '%';
      return 'inset(' + pct(t) + ' ' + pct(1 - l - w) + ' ' + pct(1 - t - hh) + ' ' + pct(l) + ')';
    };

    const tile = (faceId, size, extra, itemId, box) => h('div', Object.assign({
      key: faceId, 'data-face': faceId, ref: watch,
      style: { width: size + 'px', height: size + 'px', borderRadius: '8px', overflow: 'hidden', flex: '0 0 auto',
        background: 'rgba(128,128,128,0.22)', cursor: 'pointer',
        boxShadow: selected.includes(faceId) ? '0 0 0 3px var(--accent, #2f7ff7)' : 'none' },
    }, extra || {}), (itemId != null && thumbs[itemId])
      ? h('img', { src: thumbs[itemId], alt: '', draggable: false,
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          'object-view-box': (display === 'faces' && box) ? reviewInset(box) : 'inset(0% 0% 0% 0%)',
          transition: 'object-view-box 0.35s ease' } })
      : crops[faceId] && h('img', { src: crops[faceId], alt: '', draggable: false,
        // Crops are head-and-shoulders portraits; show the face region so it fills the tile.
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', 'object-view-box': 'inset(14% 20% 24% 20%)' } }));

    const moreTile = (clusterId, extra, size) => h('button', {
      key: 'more' + clusterId, type: 'button', onClick: () => toggleExpand(clusterId),
      style: { width: size + 'px', height: size + 'px', borderRadius: '8px', border: 'none', cursor: 'pointer', flex: '0 0 auto',
        background: 'rgba(128,128,128,0.22)', color: 'var(--text-primary)', fontSize: Math.max(13, Math.round(size / 5)) + 'px', fontWeight: 600 },
    }, expanded[clusterId] ? t('people.less') : '+' + extra);
    const rowFaces = (clusterId, samples, total, size) => {
      const list = expanded[clusterId] || samples;
      const tiles = list.map((x) => tile(x.faceId, size, null, x.itemId, x.box));
      if (total > samples.length) tiles.push(moreTile(clusterId, total - samples.length, size));
      return tiles;
    };

    const page = { height: '100%', overflowY: 'auto', padding: '20px 32px 32px', boxSizing: 'border-box' };
    const muted = { fontSize: '12px', color: 'var(--text-secondary, #8e8e93)' };

    if (mode === 'review') {
      if (groups == null) return null;
      return h('div', { ref: fadeIn, style: page },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' } },
          h('div', { style: { fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' } }, info && info.name ? t('people.review.title', { name: info.name }) : t('people.review.titleFaces')),
          h('button', { type: 'button', onClick: () => S.personViewStore.set('photos'),
            style: { border: 'none', background: 'var(--accent, #2f7ff7)', color: '#fff', borderRadius: '6px', padding: '4px 14px', cursor: 'pointer' } }, t('people.done'))),
        h('div', { style: Object.assign({ marginBottom: '16px' }, muted) }, t('people.review.hint')),
        h('div', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 10px' } }, t('people.isThis', { name })),
        (suggestions || []).length === 0
          ? h('div', { style: Object.assign({ marginBottom: '20px' }, muted) }, suggestions == null ? t('people.looking') : t('people.noMore'))
          : (suggestions || []).map((sg) => h('div', { key: 's' + sg.clusterId, style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } },
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', flex: '1 1 auto' } }, rowFaces(sg.clusterId, sg.faces, sg.faceCount, zoom(88))),
            h('div', { style: Object.assign({ minWidth: '60px' }, muted) }, t('people.faces', { count: sg.faceCount })),
            h('button', { type: 'button', onClick: () => answer(sg, true),
              style: { border: 'none', background: 'var(--accent, #2f7ff7)', color: '#fff', borderRadius: '6px', padding: '4px 14px', cursor: 'pointer' } }, t('people.yes')),
            h('button', { type: 'button', onClick: () => answer(sg, false),
              style: { border: '1px solid rgba(128,128,128,0.5)', background: 'transparent', color: 'var(--text-primary)', borderRadius: '6px', padding: '4px 14px', cursor: 'pointer' } }, t('people.no')))),
        h('div', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '22px 0 10px' } },
          info && info.name ? t('people.namedGroups', { name: info.name }) : t('people.thisPersons')),
        groups.map((g, i) => h('div', { key: g.clusterId, style: { marginBottom: '18px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' } }, t('people.groupN', { n: i + 1, faces: t('people.faces', { count: g.faceCount }) })),
            groups.length > 1 && h('button', { type: 'button', onClick: () => removeGroup(g),
              style: { border: '1px solid var(--accent, #2f7ff7)', background: 'transparent', color: 'var(--accent, #2f7ff7)', borderRadius: '6px', padding: '2px 10px', fontSize: '12px', cursor: 'pointer' } },
              t('people.not', { name }))),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, rowFaces(g.clusterId, g.faces, g.faceCount, zoom(96))))));
    }

    // M10.9: only 'review' is a separate screen; Show Faces zooms the normal grid instead.
    return null;
  }

  window.__PhotosPersonFacesView = PersonFacesView;
})();
