/*
 * Eureka Express Open Player — host chrome logic.
 * Catalog browsing/filtering, loading a simulation (from the catalog, a URL,
 * or a dropped/picked file), and assembling+driving the sandboxed iframe that
 * actually runs it. Talks to the sim iframe only via postMessage.
 *
 * Navigation model: three mutually-exclusive views —
 *   'catalog'  full-width toolbar + card grid, the browsing surface
 *   'preview'  detail screen for one simulation, shown before it runs
 *   'play'     minimal bar + full-viewport sandboxed iframe
 * Every loading path (catalog card, Random, Open JSON, drag & drop, the
 * ?sim=/?src= deep links) lands on 'preview' first; only the Preview view's
 * Play button — or Restart while already playing — enters 'play'.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var manifest = null, filtered = [];
  var activeCat = '', activeLvl = '', activeDur = '', activeTopic = '', activeSimLang = '', query = '', activeSort = '';
  var current = null;      // {data, srcName, manifestSim, langs}
  var lastProgress = null; // last progress message, so the bar can be re-rendered on a language switch
  var view = 'catalog';    // 'catalog' | 'preview' | 'play'
  var chartSrc = null;     // Chart.js source text (inlined into each iframe)
  var shimSrc = null;      // USF runtime shim source text (inlined into each iframe)
  var CATCOLORS = { business: '#3b82f6', education: '#8b5cf6', finance: '#10b981', sustainability: '#14b8a6', hospitality: '#f59e0b', tourism: '#f43f5e' };
  var CATEMOJI = { business: '💼', education: '🎓', finance: '📈', sustainability: '🌿', hospitality: '🏨', tourism: '✈️' };
  var LVLCOLORS = { basic: '#34d399', intermediate: '#f59e0b', advanced: '#f87171' };
  var DURGROUPS = [
    { id: '1-2', icon: '⚡', color: '#38bdf8', min: 1, max: 2 },
    { id: '3-4', icon: '📋', color: '#a78bfa', min: 3, max: 4 },
    { id: '5+', icon: '🏆', color: '#fb923c', min: 5, max: 999 }
  ];
  var TOPIC_KEYS = [
    { id: 'marketing', icon: '📢', color: '#ec4899' },
    { id: 'strategy', icon: '♟️', color: '#7c3aed' },
    { id: 'innovation', icon: '💡', color: '#f59e0b' },
    { id: 'digital', icon: '🤖', color: '#3b82f6' },
    { id: 'leadership', icon: '🧭', color: '#06b6d4' },
    { id: 'negotiation', icon: '🤝', color: '#10b981' },
    { id: 'governance', icon: '⚖️', color: '#6366f1' },
    { id: 'operations', icon: '⚙️', color: '#64748b' },
    { id: 'crisis', icon: '🚨', color: '#ef4444' },
    { id: 'ethics', icon: '🌍', color: '#14b8a6' }
  ];
  var TOPIC_TERMS = {
    marketing: ['marketing', 'brand', 'branding', 'market', 'advertis', 'campaign', 'consumer', 'retail', 'pricing', 'crm', 'b2b', 'b2c', 'fmcg'],
    strategy: ['strategy', 'strategic', 'positioning', 'competitive', 'portfolio', 'roadmap', 'expansion', 'merger', 'acquisition', 'capstone', 'corporat'],
    innovation: ['innovation', 'innovat', 'disrupt', 'transform', 'startup', 'venture', 'prototype', 'r&d', 'new product', 'agile'],
    digital: ['digital', 'ai ', 'artificial intelligence', 'fintech', 'neobank', 'platform', 'software', 'cloud', 'data', 'cyber', 'blockchain', 'tech', 'saas', 'erp'],
    leadership: ['leadership', 'hr ', 'human resource', 'talent', 'culture', 'team', 'people', 'workforce', 'diversity', 'inclusion', 'coaching', 'org'],
    negotiation: ['negotiation', 'negotiate', 'deal', 'contract', 'mediation', 'procurement', 'supplier', 'labour', 'salary'],
    governance: ['governance', 'esg', 'compliance', 'board', 'regulation', 'policy', 'audit', 'risk', 'ethics', 'accountability'],
    operations: ['operations', 'supply chain', 'logistics', 'process', 'manufacturing', 'production', 'inventory', 'lean', 'six sigma', 'warehouse'],
    crisis: ['crisis', 'emergency', 'disaster', 'incident', 'recovery', 'turnaround', 'bankruptcy', 'restructur', 'pandemic'],
    ethics: ['ethics', 'ethical', 'csr', 'triple bottom', 'sdg', 'climate', 'carbon', 'green', 'circular', 'social impact']
  };

  /* ───────── i18n: player chrome ─────────
     One preference ("eureka-lang") drives three things: this chrome, which
     language a simulation starts in, and the catalog's language filter. It is
     shared with the landing page and the interactive cases, so a visitor who
     picks Español once stays in Español across the whole site. */
  var UI = {
    en: {
      tagline: 'Standalone runtime for Express simulation JSONs',
      openJson: 'Open JSON', openJsonTitle: 'Open a simulation JSON from disk',
      search: 'Search simulations…  ( / )', searchAria: 'Search simulations',
      catFilterLabel: 'Category', levelFilterLabel: 'Level', durFilterLabel: 'Duration', langFilterLabel: 'Language',
      all: 'All', any: 'Any',
      sortTitle: 'Sort results', sortDefault: 'Default order', sortName: 'Name A–Z', sortRounds: 'Rounds: fewest first',
      random: 'Random', randomTitle: 'Load a random simulation',
      count: '{n} simulation', countN: '{n} simulations',
      clearFilters: 'Clear filters',
      noMatches: 'No matches — try a different search or filter.',
      noCatalog: 'Catalog unavailable — drag & drop a JSON to play.',
      welcomeH: 'Play an Express simulation',
      welcomeP1: 'Every Express simulation is a single self-contained JSON file (<code>view</code> + <code>css</code> + <code>js</code>). This player embeds an open-source implementation of the USF runtime, so the sims run entirely in your browser — no backend, no account, no network calls.',
      welcomeP2: '<b>Pick one from the catalog</b> above, <b>drag &amp; drop</b> a <code>.json</code> anywhere on this page, or use <b>Open JSON</b>.',
      serveHint: 'The catalog couldn\'t be loaded (<code>manifest.json</code>). If you opened this file directly from disk, drag &amp; drop still works. For the full catalog + charts, use the hosted player at <a href="https://open.eurekasimulations.com/player/">open.eurekasimulations.com/player</a> &mdash; or serve this folder over HTTP (<code>python -m http.server</code> from the repo root, then open <code>http://localhost:8000/player/</code>).',
      surprise: 'Surprise me',
      foot: 'Simulations © Eureka Simulations — shared under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. Player code included, same license.',
      drop: 'Drop a simulation JSON to play it',
      backToCatalog: '← Catalog', backToCatalogTitle: 'Back to catalog',
      playBar: '▶ Play', playSim: '▶ Play simulation',
      previewLiveLabel: 'Simulation preview · read-only', previewLiveTitle: 'Simulation preview',
      noSim: 'No simulation loaded', simLangAria: 'Simulation language',
      hint: 'Hint', hintTitle: 'Ask the built-in coach for a hint',
      restart: 'Restart', session: 'Session',
      exportTitle: 'Download decisions & results as JSON',
      fullAria: 'Fullscreen', dismissAria: 'Dismiss',
      round: 'round', rounds: 'rounds',
      roundProgress: 'Round {n}/{m}',
      errLoad: 'Could not load {file} — {msg}',
      errFetch: 'Could not fetch {url} — {msg} (CORS?)',
      errJson: '{file} is not valid JSON: {msg}',
      errShape: '{file} does not look like an Express simulation (needs "view", "css", "js").',
      errSim: 'Simulation error — {msg}',
      errShim: 'Could not load the simulation runtime (js/usf-shim.js) — try reloading the page.',
      noHint: 'No hint available right now — make a move first.',
      done: '🏁 Simulation complete',
      onlyLang: 'This simulation only ships in {langs} — playing it in {lang}.',
      cats: { business: 'business', education: 'education', finance: 'finance', sustainability: 'sustainability', hospitality: 'hospitality', tourism: 'tourism', other: 'other' },
      lvls: { basic: 'basic', intermediate: 'intermediate', advanced: 'advanced' },
      langNames: { en: 'English', es: 'Spanish' },
      topics: { marketing: 'Marketing', strategy: 'Strategy', innovation: 'Innovation', digital: 'Digital & AI', leadership: 'Leadership', negotiation: 'Negotiation', governance: 'Governance', operations: 'Operations', crisis: 'Crisis Mgmt', ethics: 'Ethics' },
      durGroups: {
        '1-2': { label: 'Quick', hint: '1–2 rounds' },
        '3-4': { label: 'Standard', hint: '3–4 rounds' },
        '5+': { label: 'Extended', hint: '5+ rounds' }
      }
    },
    es: {
      tagline: 'Motor autónomo para los JSON de simulaciones Express',
      openJson: 'Abrir JSON', openJsonTitle: 'Abrir una simulación JSON desde el disco',
      search: 'Buscar simulaciones…  ( / )', searchAria: 'Buscar simulaciones',
      catFilterLabel: 'Categoría', levelFilterLabel: 'Nivel', durFilterLabel: 'Duración', langFilterLabel: 'Idioma',
      all: 'Todas', any: 'Cualquiera',
      sortTitle: 'Ordenar resultados', sortDefault: 'Orden por defecto', sortName: 'Nombre A–Z', sortRounds: 'Rondas: menos primero',
      random: 'Aleatoria', randomTitle: 'Cargar una simulación al azar',
      count: '{n} simulación', countN: '{n} simulaciones',
      clearFilters: 'Quitar filtros',
      noMatches: 'Sin resultados — prueba otra búsqueda o filtro.',
      noCatalog: 'Catálogo no disponible — arrastra un JSON para jugar.',
      welcomeH: 'Juega una simulación Express',
      welcomeP1: 'Cada simulación Express es un único archivo JSON autocontenido (<code>view</code> + <code>css</code> + <code>js</code>). Este reproductor incorpora una implementación abierta del runtime USF, así que las simulaciones se ejecutan enteramente en tu navegador: sin servidor, sin cuenta, sin llamadas de red.',
      welcomeP2: '<b>Elige una del catálogo</b> arriba, <b>arrastra y suelta</b> un <code>.json</code> en cualquier punto de esta página, o usa <b>Abrir JSON</b>.',
      serveHint: 'No se pudo cargar el catálogo (<code>manifest.json</code>). Si abriste este archivo directamente desde el disco, arrastrar y soltar sigue funcionando. Para el catálogo completo y los gráficos, usa el reproductor alojado en <a href="https://open.eurekasimulations.com/player/">open.eurekasimulations.com/player</a> &mdash; o sirve esta carpeta por HTTP (<code>python -m http.server</code> desde la raíz del repositorio, y abre <code>http://localhost:8000/player/</code>).',
      surprise: 'Sorpréndeme',
      foot: 'Simulaciones © Eureka Simulations — publicadas bajo <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. El código del reproductor va incluido, con la misma licencia.',
      drop: 'Suelta un JSON de simulación para jugarlo',
      backToCatalog: '← Catálogo', backToCatalogTitle: 'Volver al catálogo',
      playBar: '▶ Jugar', playSim: '▶ Jugar la simulación',
      previewLiveLabel: 'Vista previa · solo lectura', previewLiveTitle: 'Vista previa de la simulación',
      noSim: 'Ninguna simulación cargada', simLangAria: 'Idioma de la simulación',
      hint: 'Pista', hintTitle: 'Pide una pista al coach integrado',
      restart: 'Reiniciar', session: 'Sesión',
      exportTitle: 'Descargar decisiones y resultados en JSON',
      fullAria: 'Pantalla completa', dismissAria: 'Cerrar',
      round: 'ronda', rounds: 'rondas',
      roundProgress: 'Ronda {n}/{m}',
      errLoad: 'No se pudo cargar {file} — {msg}',
      errFetch: 'No se pudo obtener {url} — {msg} (¿CORS?)',
      errJson: '{file} no es un JSON válido: {msg}',
      errShape: '{file} no parece una simulación Express (necesita "view", "css", "js").',
      errSim: 'Error en la simulación — {msg}',
      errShim: 'No se pudo cargar el runtime de la simulación (js/usf-shim.js) — intenta recargar la página.',
      noHint: 'No hay pista disponible ahora mismo — haz primero una jugada.',
      done: '🏁 Simulación completada',
      onlyLang: 'Esta simulación solo está disponible en {langs} — se juega en {lang}.',
      cats: { business: 'negocios', education: 'educación', finance: 'finanzas', sustainability: 'sostenibilidad', hospitality: 'hostelería', tourism: 'turismo', other: 'otros' },
      lvls: { basic: 'básico', intermediate: 'intermedio', advanced: 'avanzado' },
      langNames: { en: 'inglés', es: 'español' },
      topics: { marketing: 'Marketing', strategy: 'Estrategia', innovation: 'Innovación', digital: 'Digital e IA', leadership: 'Liderazgo', negotiation: 'Negociación', governance: 'Gobernanza', operations: 'Operaciones', crisis: 'Gestión de crisis', ethics: 'Ética' },
      durGroups: {
        '1-2': { label: 'Rápida', hint: '1–2 rondas' },
        '3-4': { label: 'Estándar', hint: '3–4 rondas' },
        '5+': { label: 'Extendida', hint: '5+ rondas' }
      }
    }
  };
  var UI_LANGS = Object.keys(UI);
  var lang = UI[document.documentElement.lang] ? document.documentElement.lang : 'en';

  function T(key, params) {
    var s = UI[lang][key];
    if (s == null) s = UI.en[key];
    if (s == null) return key;
    if (params) for (var k in params) s = String(s).split('{' + k + '}').join(params[k]);
    return s;
  }
  function catLabel(c) { return (UI[lang].cats[c] || c); }
  function lvlLabel(l) { return (UI[lang].lvls[l] || l); }
  function langName(l) { return (UI[lang].langNames[l] || l.toUpperCase()); }
  function topicLabel(id) { return (UI[lang].topics[id] || id); }
  function durLabel(id) { return ((UI[lang].durGroups[id] || {}).label || id); }
  function durHint(id) { return ((UI[lang].durGroups[id] || {}).hint || ''); }

  /* Re-render every translated string in the chrome. Cheap enough to just run
     the whole thing on each switch — the page is small and it keeps the
     dynamic bits (counts, chips, cards) honest. */
  function applyUI() {
    document.documentElement.lang = lang;
    document.title = 'Eureka Express — ' + (lang === 'es' ? 'Reproductor abierto de simulaciones' : 'Open Simulation Player');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.innerHTML = T(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', T(el.getAttribute('data-i18n-ph'))); });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.setAttribute('title', T(el.getAttribute('data-i18n-title'))); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', T(el.getAttribute('data-i18n-aria'))); });
    document.querySelectorAll('.lang-switch [data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
    });
    if (manifest) { buildFilters(); applyFilter(); }
    if (current && view === 'preview') renderPreviewMeta();
    if (view === 'play' && current) {
      $('simMeta').textContent = playMetaLine(current.data, current.manifestSim);
      if (lastProgress) showProgress(lastProgress);
    }
  }

  /* The one place the preference is written. Sims already running are asked to
     switch too, so the chrome and the simulation never disagree. */
  function setLang(next, opts) {
    if (UI_LANGS.indexOf(next) < 0 || next === lang) return;
    lang = next;
    try { localStorage.setItem('eureka-lang', lang); } catch (e) {}
    applyUI();
    syncUrl();
    if (!(opts && opts.fromSim)) tellSim(lang);
  }
  function tellSim(l) {
    var f = $('frame');
    if (current && f.contentWindow) f.contentWindow.postMessage({ usfHost: true, type: 'setLang', lang: l }, '*');
  }
  function simLangs(s) { return (s && s.langs && s.langs.length) ? s.langs : ['en']; }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function deent(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'"); } // some sim names ship pre-encoded entities
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } // escape regex metacharacters (for building a literal-match RegExp out of user text)
  function highlightText(raw, q) {
    // Find match boundaries in the RAW (unescaped) text first, then esc() each segment
    // independently — never esc() the whole string and then splice <mark> into it, since
    // that can split a multi-character entity (e.g. "&amp;") across the tag boundary and
    // leave the literal encoded text visible instead of the real character.
    if (!q) return esc(raw);
    var re;
    try { re = new RegExp(reEsc(q), 'ig'); } catch (e) { return esc(raw); }
    var out = '', last = 0, m;
    while ((m = re.exec(raw))) {
      out += esc(raw.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-length matches
    }
    return out + esc(raw.slice(last));
  }
  function highlightName(rawName) { return highlightText(deent(rawName), query.trim()); }
  function descSnippet(rawDesc, q) {
    // Only called when the query matched a sim via its (hidden) description rather than
    // its name — surfaces *why* it matched instead of showing an unexplained result.
    if (!q || !rawDesc) return '';
    var desc = deent(rawDesc);
    var idx = desc.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return '';
    var start = Math.max(0, idx - 24), end = Math.min(desc.length, idx + q.length + 40);
    var snippet = (start > 0 ? '…' : '') + desc.slice(start, end) + (end < desc.length ? '…' : '');
    return highlightText(snippet, q);
  }
  function escScript(s) { return String(s).replace(/<\/(script|style)/gi, function (m) { return '<\\/' + m.slice(2); }); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2800); }
  function notice(msg, kind) { var n = $('notice'); $('noticeTx').textContent = msg; n.className = kind || 'info'; }
  $('noticeX').onclick = function () { $('notice').className = ''; };

  /* ───────── view routing ───────── */
  function setView(v) {
    view = v;
    $('viewCatalog').classList.toggle('active', v === 'catalog');
    $('viewPreview').classList.toggle('active', v === 'preview');
    $('viewPlay').classList.toggle('active', v === 'play');
    window.scrollTo(0, 0);
  }
  function goToCatalog() {
    if (view === 'play') { try { $('frame').srcdoc = 'about:blank'; } catch (e) { } }
    if (view === 'preview') { try { $('previewLive').srcdoc = 'about:blank'; } catch (e) { } }
    $('btnPlayBar').style.display = 'none';
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
    setView('catalog');
    // Lazy-render the grid the first time the user returns to catalog
    // (skipped on initial load when a ?sim= or ?src= param was present)
    if (manifest && !$('grid').firstChild) applyFilter();
  }
  $('btnBackToCatalog').onclick = goToCatalog;
  $('btnMenu').onclick = goToCatalog;

  /* ───────── catalog ───────── */
  function loadManifest() {
    fetch('manifest.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (m) {
      manifest = m;
      buildFilters();
      $('welcome').style.display = 'none';
      $('grid').style.display = '';
      $('btnWelcomeRandom').style.display = 'inline-block';
      var p = new URLSearchParams(location.search);
      var simId = p.get('sim'), srcUrl = p.get('src');
      if (simId) {
        // Load the sim directly — skip rendering the catalog to avoid the flash
        var hit = m.sims.find(function (s) { return s.id === simId || s.file.indexOf(simId) === 0; });
        if (hit) { loadFromManifest(hit); return; }
      } else if (srcUrl) {
        loadFromUrl(srcUrl); return;
      }
      // No deep-link: render catalog normally
      applyFilter();
    }).catch(function () {
      $('grid').style.display = 'none';
      $('welcome').style.display = 'flex';
      $('serveHint').style.display = 'block';
      $('count').textContent = T('noCatalog');
    });
  }

  function buildFilters() {
    var cats = {}, lvlCounts = {}, durCounts = {}, langCounts = {};
    manifest.sims.forEach(function (s) {
      cats[s.cat] = (cats[s.cat] || 0) + 1;
      if (s.level) lvlCounts[s.level] = (lvlCounts[s.level] || 0) + 1;
      var p = s.periods || 0;
      DURGROUPS.forEach(function (g) { if (p >= g.min && p <= g.max) durCounts[g.id] = (durCounts[g.id] || 0) + 1; });
      simLangs(s).forEach(function (l) { langCounts[l] = (langCounts[l] || 0) + 1; });
    });

    function mkBtn(container, label, count, color, emoji, onclick, titleTxt) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'catbtn';
      if (color) btn.style.setProperty('--cc', color);
      if (titleTxt) btn.title = titleTxt;
      btn.innerHTML =
        (emoji ? '<span class="catbtn-ic">' + emoji + '</span>' : '') +
        '<span class="catbtn-lbl">' + esc(label) + '</span>' +
        (count != null ? '<span class="catbtn-cnt">' + count + '</span>' : '');
      btn.onclick = onclick;
      container.appendChild(btn);
      return btn;
    }

    // ── Category + Topic (merged into one chip row) ──
    var chips = $('chips'); chips.innerHTML = '';
    var allCat = mkBtn(chips, T('all'), manifest.sims.length, '#64748b', '', function () { activeCat = ''; activeTopic = ''; selChip(allCat); applyFilter(); });
    allCat.classList.add('on'); allCat.dataset.filterAll = '1';
    // Data-driven categories
    Object.keys(cats).sort().forEach(function (c) {
      var btn = mkBtn(chips, catLabel(c), cats[c], CATCOLORS[c] || '#64748b', CATEMOJI[c] || '', function () { activeCat = c; activeTopic = ''; selChip(btn); applyFilter(); });
      btn.dataset.filterCat = c;
      if (c === activeCat) { allCat.classList.remove('on'); selChip(btn, true); }
    });
    // Thin visual divider
    var sep = document.createElement('span'); sep.className = 'chip-sep'; chips.appendChild(sep);
    // Keyword-based topic chips
    TOPIC_KEYS.forEach(function (t) {
      var terms = TOPIC_TERMS[t.id] || [t.id];
      var cnt = manifest.sims.filter(function (s) {
        var hay = (s.name + ' ' + (s.desc || '')).toLowerCase();
        return terms.some(function (k) { return hay.indexOf(k) >= 0; });
      }).length;
      if (!cnt) return;
      var lbl = topicLabel(t.id);
      var btn = mkBtn(chips, lbl, cnt, t.color, t.icon, function () { activeTopic = t.id; activeCat = ''; selChip(btn); applyFilter(); }, lbl);
      btn.dataset.filterTopic = t.id;
      if (t.id === activeTopic) selChip(btn, true);
    });

    // ── Level ──
    var lvlC = $('lvlChips'); lvlC.innerHTML = '';
    var allLvl = mkBtn(lvlC, T('any'), null, '#64748b', '', function () { activeLvl = ''; selChip(allLvl); applyFilter(); });
    allLvl.classList.add('on'); allLvl.dataset.filterAll = '1';
    ['basic', 'intermediate', 'advanced'].forEach(function (l) {
      if (!lvlCounts[l]) return;
      var btn = mkBtn(lvlC, lvlLabel(l), lvlCounts[l], LVLCOLORS[l] || '#64748b', '', function () { activeLvl = l; selChip(btn); applyFilter(); });
      btn.dataset.filterLvl = l;
      if (l === activeLvl) { allLvl.classList.remove('on'); selChip(btn, true); }
    });

    // ── Duration ──
    var durC = $('durChips'); durC.innerHTML = '';
    var allDurBtn = mkBtn(durC, T('any'), null, '#64748b', '', function () { activeDur = ''; selChip(allDurBtn); applyFilter(); });
    allDurBtn.classList.add('on'); allDurBtn.dataset.filterAll = '1';
    DURGROUPS.forEach(function (g) {
      if (!durCounts[g.id]) return;
      var btn = mkBtn(durC, durLabel(g.id), durCounts[g.id], g.color, g.icon, function () { activeDur = g.id; selChip(btn); applyFilter(); }, durHint(g.id));
      btn.dataset.filterDur = g.id;
      if (g.id === activeDur) { allDurBtn.classList.remove('on'); selChip(btn, true); }
    });

    // ── Language (which languages a simulation actually ships in) ──
    var langC = $('langChips'); langC.innerHTML = '';
    var allLang = mkBtn(langC, T('any'), null, '#64748b', '', function () { activeSimLang = ''; selChip(allLang); applyFilter(); });
    allLang.classList.add('on'); allLang.dataset.filterAll = '1';
    Object.keys(langCounts).sort().forEach(function (l) {
      var btn = mkBtn(langC, langName(l), langCounts[l], '#64748b', '', function () { activeSimLang = l; selChip(btn); applyFilter(); });
      btn.dataset.filterLang = l;
      if (l === activeSimLang) { allLang.classList.remove('on'); selChip(btn, true); }
    });
  }
  /* Recalculate chip counts after every filter change — each count shows how many
     results you'd get if you selected that option with all other active filters kept. */
  function refreshCounts() {
    if (!manifest) return;
    var q = query.trim().toLowerCase();
    function countWith(oCat, oLvl, oDur, oTopic, oLang) {
      return manifest.sims.filter(function (s) {
        if (oCat && s.cat !== oCat) return false;
        if (oLvl && s.level !== oLvl) return false;
        if (oDur) {
          var p = s.periods || 0;
          var dg = DURGROUPS.find(function (g) { return g.id === oDur; });
          if (dg && (p < dg.min || p > dg.max)) return false;
        }
        if (oTopic) {
          var terms = TOPIC_TERMS[oTopic] || [oTopic];
          var hay = (s.name + ' ' + (s.desc || '')).toLowerCase();
          if (!terms.some(function (k) { return hay.indexOf(k) >= 0; })) return false;
        }
        if (oLang && simLangs(s).indexOf(oLang) < 0) return false;
        if (q && (s.name + ' ' + s.id + ' ' + (s.desc || '')).toLowerCase().indexOf(q) < 0) return false;
        return true;
      }).length;
    }
    function applyToChip(btn, n) {
      var cntEl = btn.querySelector('.catbtn-cnt');
      if (!cntEl) return;
      cntEl.textContent = n;
      var dim = n === 0 && !btn.classList.contains('on');
      btn.style.opacity = dim ? '0.3' : '';
      btn.style.pointerEvents = dim ? 'none' : '';
    }
    // Category + Topic chips
    $('chips').querySelectorAll('.catbtn').forEach(function (btn) {
      var d = btn.dataset;
      if (d.filterAll) applyToChip(btn, countWith('', activeLvl, activeDur, '', activeSimLang));
      else if (d.filterCat) applyToChip(btn, countWith(d.filterCat, activeLvl, activeDur, '', activeSimLang));
      else if (d.filterTopic) applyToChip(btn, countWith('', activeLvl, activeDur, d.filterTopic, activeSimLang));
    });
    // Level chips
    $('lvlChips').querySelectorAll('.catbtn').forEach(function (btn) {
      var d = btn.dataset;
      if (d.filterAll) applyToChip(btn, countWith(activeCat, '', activeDur, activeTopic, activeSimLang));
      else if (d.filterLvl) applyToChip(btn, countWith(activeCat, d.filterLvl, activeDur, activeTopic, activeSimLang));
    });
    // Duration chips
    $('durChips').querySelectorAll('.catbtn').forEach(function (btn) {
      var d = btn.dataset;
      if (d.filterAll) applyToChip(btn, countWith(activeCat, activeLvl, '', activeTopic, activeSimLang));
      else if (d.filterDur) applyToChip(btn, countWith(activeCat, activeLvl, d.filterDur, activeTopic, activeSimLang));
    });
    // Language chips
    $('langChips').querySelectorAll('.catbtn').forEach(function (btn) {
      var d = btn.dataset;
      if (d.filterAll) applyToChip(btn, countWith(activeCat, activeLvl, activeDur, activeTopic, ''));
      else if (d.filterLang) applyToChip(btn, countWith(activeCat, activeLvl, activeDur, activeTopic, d.filterLang));
    });
  }
  function selChip(el, keepOpen) {
    el.parentNode.querySelectorAll('.catbtn').forEach(function (c) { c.classList.remove('on'); });
    el.classList.add('on');
    // Update the parent dropdown label and close the panel
    var panel = el.closest('.filterdrop-panel');
    if (!panel) return;
    var drop = panel.parentNode;
    var lbl = drop.querySelector('.filterdrop-lbl');
    if (lbl) lbl.textContent = (el.querySelector('.catbtn-lbl') || {}).textContent || '';
    var dropBtn = drop.querySelector('.filterdrop-btn');
    var isDefault = el === el.parentNode.querySelector('.catbtn');
    if (dropBtn) dropBtn.classList.toggle('has-filter', !isDefault);
    if (!keepOpen) {
      panel.classList.remove('open');
      if (dropBtn) dropBtn.classList.remove('open');
    }
  }

  function sortSims(arr) {
    // Never mutate the manifest's sims array (or the array passed in) — always sort a copy.
    var copy = arr.slice();
    if (activeSort === 'name') {
      copy.sort(function (a, b) { return deent(a.name || '').localeCompare(deent(b.name || ''), undefined, { sensitivity: 'base' }); });
    } else if (activeSort === 'rounds') {
      copy.sort(function (a, b) { return (a.periods || 0) - (b.periods || 0); });
    }
    // '' (relevance/default) — keep the manifest's own order, already preserved by filter().
    return copy;
  }

  function filtersActive() { return !!(activeCat || activeLvl || activeDur || activeTopic || activeSimLang || query.trim()); }
  function updateClearBtn() { $('btnClear').style.display = filtersActive() ? 'inline-block' : 'none'; }
  function resetFilters() {
    query = ''; $('search').value = '';
    activeLvl = ''; activeDur = ''; activeCat = ''; activeTopic = ''; activeSimLang = '';
    ['chips', 'lvlChips', 'durChips', 'langChips'].forEach(function (id) {
      var c = $(id); if (!c) return;
      var first = c.querySelector('.catbtn'); if (first) selChip(first, true); // keepOpen=true so panels stay closed
    });
    applyFilter();
  }
  $('btnClear').onclick = resetFilters;

  function renderEmptyState() {
    var d = document.createElement('div');
    d.className = 'emptystate';
    d.appendChild(document.createTextNode(T('noMatches')));
    if (filtersActive()) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'clearbtn'; b.textContent = '✕ ' + T('clearFilters');
      b.onclick = resetFilters;
      d.appendChild(document.createElement('br'));
      d.appendChild(b);
    }
    $('grid').appendChild(d);
  }

  function applyFilter() {
    if (!manifest) return;
    var q = query.trim().toLowerCase();
    filtered = manifest.sims.filter(function (s) {
      if (activeCat && s.cat !== activeCat) return false;
      if (activeLvl && s.level !== activeLvl) return false;
      if (activeDur) {
        var p = s.periods || 0;
        var dg = DURGROUPS.find(function (g) { return g.id === activeDur; });
        if (dg && (p < dg.min || p > dg.max)) return false;
      }
      if (activeTopic) {
        var terms = TOPIC_TERMS[activeTopic] || [activeTopic];
        var hay = (s.name + ' ' + (s.desc || '')).toLowerCase();
        if (!terms.some(function (k) { return hay.indexOf(k) >= 0; })) return false;
      }
      if (activeSimLang && simLangs(s).indexOf(activeSimLang) < 0) return false;
      if (q && (s.name + ' ' + s.id + ' ' + (s.desc || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    filtered = sortSims(filtered);
    kbdIndex = -1;
    $('count').textContent = T(filtered.length === 1 ? 'count' : 'countN', { n: filtered.length });
    updateClearBtn();
    refreshCounts();
    $('grid').innerHTML = '';
    if (!filtered.length) { renderEmptyState(); return; }
    renderGrid();
  }

  /* Render all filtered cards at once in a single DocumentFragment so the
     browser does one layout pass. CSS content-visibility:auto on .simcard
     then skips painting of off-screen cards natively — no JS scroll handling
     needed and no DOM churn during scroll. */
  function renderGrid() {
    var frag = document.createDocumentFragment();
    filtered.forEach(function (s) { frag.appendChild(cardEl(s)); });
    $('grid').appendChild(frag);
  }

  function cardEl(s) {
    var d = document.createElement('div');
    d.className = 'simcard'; d.dataset.id = s.id;
    var color = CATCOLORS[s.cat] || '#64748b';
    var cover = s.svg
      ? '<img loading="lazy" src="' + esc(s.svg) + '" alt="">'
      : '<div class="tileinit" style="background:' + color + '">' + esc((s.name || '?').charAt(0).toUpperCase()) + '</div>';
    var lvlHtml = s.level ? '<span class="lvlbadge lvl-' + esc(s.level) + '">' + esc(lvlLabel(s.level)) + '</span>' : '';
    var ls = simLangs(s);
    var langHtml = '<span class="lg" title="' + esc(ls.map(langName).join(' · ')) + '">' + esc(ls.join('·')) + '</span>';
    var q = query.trim();
    var nameHtml = highlightName(s.name);
    var snippet = (q && nameHtml.indexOf('<mark>') < 0) ? descSnippet(s.desc, q) : ''; // surface why a desc-only match hit
    d.innerHTML = '<div class="cardcover">' + cover + '</div>' +
      '<div class="cardbody">' +
      '<div class="cardname">' + nameHtml + '</div>' +
      '<div class="cardtags"><span class="catpill" style="background:' + color + '">' + esc(catLabel(s.cat)) + '</span>' + lvlHtml + langHtml + '</div>' +
      (s.periods ? '<div class="cardrounds">' + s.periods + ' ' + T(s.periods === 1 ? 'round' : 'rounds') + '</div>' : '') +
      (snippet ? '<div class="cardsnip">' + snippet + '</div>' : '') +
      '</div>';
    d.onclick = function () { loadFromManifest(s); };
    return d;
  }

  /* ───────── loading sims → always lands on Preview ───────── */
  function loadFromManifest(s) {
    fetch(s.path).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { showPreview(data, s.file, s); })
      .catch(function (e) { notice(T('errLoad', { file: s.file, msg: e.message }), 'err'); });
  }
  function loadFromUrl(url) {
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { showPreview(d, url.split('/').pop(), null); })
      .catch(function (e) { notice(T('errFetch', { url: url, msg: e.message }), 'err'); });
  }
  function loadFromFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try { showPreview(JSON.parse(rd.result), file.name, null); }
      catch (e) { notice(T('errJson', { file: file.name, msg: e.message }), 'err'); }
    };
    rd.readAsText(file);
  }

  /* Keep ?sim= and ?lang= together so any URL a user copies replays exactly. */
  function syncUrl() {
    try {
      var p = new URLSearchParams(location.search);
      if (current && current.manifestSim) p.set('sim', current.manifestSim.id); else p.delete('sim');
      p.set('lang', lang);
      history.replaceState(null, '', '?' + p.toString());
    } catch (e) {}
  }

  /* ───────── preview ───────── */
  function showPreview(data, srcName, manifestSim) {
    if (!data || typeof data !== 'object' || !data.js || !data.view) {
      notice(T('errShape', { file: srcName || 'File' }), 'err');
      return;
    }
    current = { data: data, srcName: srcName, manifestSim: manifestSim || null, langs: manifestSim ? simLangs(manifestSim) : null };
    $('notice').className = '';
    renderPreview();
    setView('preview');
    syncUrl();
  }

  function renderPreview() {
    var d = current.data, s = current.manifestSim;
    var svg = s && s.svg;
    var color = CATCOLORS[(s && s.cat) || ''] || '#64748b';
    var name = deent(d.name || current.srcName || 'Simulation');

    $('previewCover').innerHTML = svg
      ? '<img src="' + esc(svg) + '" alt="">'
      : '<div class="tileinit" style="background:' + color + '">' + esc(name.charAt(0).toUpperCase()) + '</div>';
    $('previewName').textContent = name;
    renderPreviewMeta();
    $('previewDesc').textContent = deent(d.description || '');
    $('previewBarTitle').textContent = name;
    $('btnPlayBar').style.display = 'inline-block';

    // Build a static HTML+CSS preview (no JS — renders the initial UI layout)
    // Scrollbar is hidden via CSS but scroll still works via mouse wheel
    var prevDoc = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>*{box-sizing:border-box}html{margin:0;overflow-x:hidden}body{margin:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none}body::-webkit-scrollbar{display:none}<\/style>' +
      '<style>' + escScript(d.css || '') + '<\/style><\/head>' +
      '<body>' + (d.view || '') + '<\/body><\/html>';
    $('previewLive').srcdoc = prevDoc;
    requestAnimationFrame(updatePreviewScale);
  }

  /* Just the translatable pills — re-run on a language switch without
     rebuilding the cover/name/description or reloading the preview iframe. */
  function renderPreviewMeta() {
    var d = current.data, s = current.manifestSim;
    var cat = ((s && s.cat) || d.category || '').toLowerCase();
    var level = ((s && s.level) || d.level || '').toLowerCase();
    var rounds = (s && s.periods) || d.max_periods || 0;
    var id = (s && s.id) || d.externalid || '';
    var color = CATCOLORS[cat] || '#64748b';
    var meta = [];
    if (cat) meta.push('<span class="catpill" style="background:' + color + '">' + esc(catLabel(cat)) + '</span>');
    if (level) meta.push('<span class="lvlbadge lvl-' + esc(level) + '">' + esc(lvlLabel(level)) + '</span>');
    if (rounds) meta.push('<span>' + rounds + ' ' + T(rounds === 1 ? 'round' : 'rounds') + '</span>');
    if (id) meta.push('<span>#' + esc(id) + '</span>');
    if (current.langs) meta.push('<span class="lg" title="' + esc(current.langs.map(langName).join(' · ')) + '">' + esc(current.langs.join('·')) + '</span>');
    $('previewMeta').innerHTML = meta.join('');
  }

  function updatePreviewScale() {
    var clip = $('previewLiveClip'), frame = $('previewLive');
    if (!clip || !frame) return;
    var w = clip.clientWidth;
    if (!w) return;
    var scale = Math.min(1, w / 960);
    frame.style.transform = 'scale(' + scale + ')';
    clip.style.height = Math.round(600 * scale) + 'px';
  }
  $('btnPlay').onclick = function () { playCurrent(); };
  $('btnPlayBar').onclick = function () { playCurrent(); };

  /* ───────── runtime (Play view) ───────── */
  function playMetaLine(d, s) {
    var cat = ((s && s.cat) || d.category || '').toLowerCase();
    var level = ((s && s.level) || d.level || '').toLowerCase();
    return [d.externalid ? '#' + d.externalid : '', cat ? catLabel(cat) : '', level ? lvlLabel(level) : ''].filter(Boolean).join(' · ');
  }
  function playCurrent() {
    if (!current) return;
    var d = current.data;
    $('simTitle').removeAttribute('data-i18n');   // holds the sim's own name from here on
    $('simTitle').textContent = deent(d.name || current.srcName || 'Simulation');
    $('simTitle').title = d.description || '';
    $('simMeta').textContent = playMetaLine(d, current.manifestSim);
    ['btnHint', 'btnRestart', 'btnExport', 'btnFull'].forEach(function (b) { $(b).style.display = 'inline-block'; });
    $('progress').style.display = 'inline-block';
    $('progress').textContent = '…';
    $('langs').innerHTML = '';
    lastProgress = null;
    setView('play');
    buildFrame();
  }

  function buildFrame() {
    if (!shimSrc) return; // shim still loading; playCurrent()/restart will retry once it's ready
    var d = current.data;
    /* The USF shim picks its starting language from <html lang>, so a sim that
       ships the preferred language opens in it — no click needed. Sims whose
       language support we don't know (dropped file, ?src=) fall back to the shim's own default. */
    var startLang = (!current.langs || current.langs.indexOf(lang) >= 0) ? lang : 'en';
    var doc = '<!DOCTYPE html><html lang="' + esc(startLang) + '"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>html{-webkit-text-size-adjust:100%}body{margin:0}</style>' +
      '<style>' + escScript(d.css || '') + '</style></head><body>' +
      (d.view || '') +
      (chartSrc ? '<script>' + escScript(chartSrc) + '<\/script>' : '') +
      '<script>window.__USF_MAX_PERIODS__=' + (parseInt(d.max_periods, 10) || 5) + ';<\/script>' +
      '<script>' + escScript(shimSrc) + '<\/script>' +
      '<script>' + escScript(d.js || '') + '<\/script>' +
      '</body></html>';
    $('frame').srcdoc = doc;
  }

  /* messages from the sim iframe */
  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    /* only the sandboxed sim frame may drive the chrome */
    if (!m.usfPlayer || ev.source !== $('frame').contentWindow) return;
    if (m.type === 'ready') {
      current.langs = (m.langs && m.langs.length) ? m.langs : ['en'];
      renderSimLangs(m.langs || [], m.lang);
      /* a ?src= sim may simply not have the preferred language */
      if (m.lang !== lang && current.langs.indexOf(lang) < 0) {
        notice(T('onlyLang', { langs: current.langs.map(langName).join(', '), lang: langName(m.lang) }), 'info');
      }
    }
    if (m.type === 'lang') {
      renderSimLangs(current && current.langs ? current.langs : [m.lang], m.lang);
      /* switching the sim switches the chrome too — one language, one page */
      if (m.lang !== lang) setLang(m.lang, { fromSim: true });
    }
    if (m.type === 'progress') { lastProgress = m; showProgress(m); }
    if (m.type === 'hint' && m.text) toast('💡 ' + m.text);
    if (m.type === 'hint' && m.empty) toast(T('noHint'));
    if (m.type === 'finished') toast(T('done'));
    if (m.type === 'restart') buildFrame();
    if (m.type === 'error') notice(T('errSim', { msg: m.message }), 'err');
    if (m.type === 'session') {
      var d = current ? current.data : {};
      var payload = Object.assign({ simulation: { externalid: d.externalid, name: d.name, category: d.category, level: d.level } }, m.session);
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'express-session-' + (d.externalid || 'sim') + '-' + Date.now() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }
  });

  /* Per-simulation language buttons: what THIS sim ships, with the active one
     marked. Always rendered (even for a single language) so the catalog's
     promise — "playable in the languages it supports" — is visible in the bar. */
  function renderSimLangs(langs, active) {
    var L = $('langs');
    L.innerHTML = '';
    (langs.length ? langs : ['en']).forEach(function (lg) {
      var b = document.createElement('button');
      b.className = 'lbtn' + (lg === active ? ' on' : '');
      b.textContent = lg;
      b.title = langName(lg);
      b.setAttribute('aria-pressed', String(lg === active));
      b.onclick = function () { tellSim(lg); };
      L.appendChild(b);
    });
  }
  function showProgress(m) {
    var pEl = $('progress');
    pEl.textContent = m.finished ? '✔ ' + m.maxPeriods + '/' + m.maxPeriods : T('roundProgress', { n: m.period, m: m.maxPeriods });
    pEl.classList.remove('bump'); void pEl.offsetWidth; pEl.classList.add('bump'); // restart the tick animation each round
  }

  /* ───────── chrome buttons ───────── */
  $('btnRestart').onclick = function () { if (current) buildFrame(); };
  $('btnHint').onclick = function () { $('frame').contentWindow.postMessage({ usfHost: true, type: 'requestHint' }, '*'); };
  $('btnExport').onclick = function () { $('frame').contentWindow.postMessage({ usfHost: true, type: 'requestSession' }, '*'); };
  $('btnFull').onclick = function () {
    var f = $('frame');
    // requestFullscreen() returns a Promise that rejects (e.g. Permissions-Policy, platform
    // restrictions) without ever throwing synchronously — catch it so a denial doesn't surface
    // as an unhandled rejection in the console.
    try { Promise.resolve((f.requestFullscreen || f.webkitRequestFullscreen || function () { }).call(f)).catch(function () { }); }
    catch (e) { }
  };
  function randomSim() { if (manifest && manifest.sims.length) loadFromManifest(manifest.sims[Math.floor(Math.random() * manifest.sims.length)]); }
  $('btnRandom').onclick = randomSim;
  $('btnWelcomeRandom').onclick = randomSim;

  /* Dropdown filter panels: toggle on button click, close on outside click or Escape */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.filterdrop-btn');
    var inside = e.target.closest('.filterdrop');
    if (!inside) {
      document.querySelectorAll('.filterdrop-panel.open').forEach(function (p) { p.classList.remove('open'); });
      document.querySelectorAll('.filterdrop-btn.open').forEach(function (b) { b.classList.remove('open'); });
      return;
    }
    if (btn && !e.target.closest('.catbtn')) {
      var panel = btn.nextElementSibling;
      var wasOpen = panel.classList.contains('open');
      document.querySelectorAll('.filterdrop-panel.open').forEach(function (p) { p.classList.remove('open'); });
      document.querySelectorAll('.filterdrop-btn.open').forEach(function (b) { b.classList.remove('open'); });
      if (!wasOpen) { panel.classList.add('open'); btn.classList.add('open'); }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.filterdrop-panel.open').forEach(function (p) { p.classList.remove('open'); });
      document.querySelectorAll('.filterdrop-btn.open').forEach(function (b) { b.classList.remove('open'); });
    }
  });

  $('search').addEventListener('input', function () { query = this.value; applyFilter(); });
  $('sort').addEventListener('change', function () { activeSort = this.value; applyFilter(); });
  document.querySelectorAll('.lang-switch [data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang')); });
  });

  /* keyboard, game-menu style: / to search, arrow keys to move through cards, Enter to open one.
     Only active in the Catalog view — Preview/Play have no result list to navigate. */
  var kbdIndex = -1;
  function setKbdFocus(i) {
    var cards = $('grid').querySelectorAll('.simcard');
    cards.forEach(function (c) { c.classList.remove('kbd'); });
    if (i < 0 || i >= cards.length) { kbdIndex = -1; return; }
    kbdIndex = i;
    cards[i].classList.add('kbd');
    cards[i].scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && view === 'catalog' && document.activeElement !== $('search')) { e.preventDefault(); $('search').focus(); return; }
    if (view !== 'catalog') return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // let native field navigation happen
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    var cards = $('grid').querySelectorAll('.simcard');
    if (!cards.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setKbdFocus(Math.min(cards.length - 1, kbdIndex + 1)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setKbdFocus(Math.max(0, kbdIndex - 1)); }
    else if (kbdIndex >= 0 && cards[kbdIndex]) { cards[kbdIndex].click(); }
  });

  /* drag & drop + file picker — both route into Preview via loadFromFile()/showPreview() */
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'dragleave' && e.relatedTarget) return;
      document.body.classList.remove('dragging');
      if (ev === 'drop' && e.dataTransfer.files.length) loadFromFile(e.dataTransfer.files[0]);
    });
  });
  $('filePick').addEventListener('change', function () { if (this.files.length) loadFromFile(this.files[0]); this.value = ''; });

  /* USF shim: required — sims can't run without it */
  fetch('js/usf-shim.js').then(function (r) { if (!r.ok) throw 0; return r.text(); })
    .then(function (t) { shimSrc = t; if (current && view === 'play') buildFrame(); })
    .catch(function () { notice(T('errShim'), 'err'); });

  /* Chart.js: vendor copy first, CDN fallback; sims degrade gracefully without it */
  fetch('vendor/chart.umd.min.js').then(function (r) { if (!r.ok) throw 0; return r.text(); })
    .catch(function () {
      return fetch('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js')
        .then(function (r) { if (!r.ok) throw 0; return r.text(); });
    })
    .then(function (t) { chartSrc = t; if (current && view === 'play') buildFrame(); })
    .catch(function () { console.warn('Chart.js unavailable — sims will run without charts.'); });

  window.addEventListener('resize', function () {
    if (view === 'preview') requestAnimationFrame(updatePreviewScale);
  });

  /* A ?lang= deep link is an explicit choice — remember it like a click. */
  try { localStorage.setItem('eureka-lang', lang); } catch (e) {}
  applyUI();
  loadManifest();
})();
