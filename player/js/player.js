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
  /* Active catalog filters, '' for any. Category and topic share one dropdown,
     so picking one clears the other. */
  var F = { cat: '', topic: '', area: '', prog: '', time: '', lvl: '', dur: '', lang: '' };
  var query = '', activeSort = '';
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
  /* Teaching facts build_manifest.py records per sim, from its `teaching` block or else
     its case: `area`, an Axis A discipline of the MECE case-method taxonomy (A1–A12);
     `programs`, audience groups; `minutes` of class time. */
  var AREAS = [
    { id: 'A7', icon: '♟️', color: '#7c3aed' },
    { id: 'A2', icon: '📈', color: '#10b981' },
    { id: 'A1', icon: '🧾', color: '#0ea5e9' },
    { id: 'A4', icon: '📢', color: '#ec4899' },
    { id: 'A5', icon: '⚙️', color: '#64748b' },
    { id: 'A6', icon: '🤖', color: '#3b82f6' },
    { id: 'A8', icon: '🧭', color: '#06b6d4' },
    { id: 'A9', icon: '👥', color: '#8b5cf6' },
    { id: 'A10', icon: '🚀', color: '#f59e0b' },
    { id: 'A11', icon: '🌿', color: '#14b8a6' },
    { id: 'A3', icon: '🌐', color: '#a3a3a3' },
    { id: 'A12', icon: '🎯', color: '#ef4444' }
  ];
  var PROGRAMS = ['secondary', 'ug', 'master', 'exec'];
  var TIMEGROUPS = [
    { id: '60', min: 1, max: 60 },
    { id: '80', min: 61, max: 80 },
    { id: '90', min: 81, max: 9999 }
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
      catFilterLabel: 'Category', levelFilterLabel: 'Difficulty', durFilterLabel: 'Rounds', langFilterLabel: 'Language',
      areaFilterLabel: 'Discipline', progFilterLabel: 'Program', timeFilterLabel: 'Class time',
      factNote: 'From the case study — {n} of {m} simulations state it.',
      all: 'All', any: 'Any',
      sortTitle: 'Sort results', sortDefault: 'Default order', sortName: 'Name A–Z', sortRounds: 'Rounds: fewest first',
      random: 'Random', randomTitle: 'Load a random simulation',
      count: '{n} simulation', countN: '{n} simulations',
      clearFilters: 'Clear filters',
      noMatches: 'No matches — try a different search or filter.',
      noCatalog: 'Catalog unavailable — drag & drop a JSON to play.',
      welcomeH: 'Play an Express simulation',
      welcomeP1: 'Every Express simulation is a single self-contained JSON file (<code>view</code> + <code>css</code> + <code>js</code>). This player embeds an open-source implementation of the USF runtime, so the sims run entirely in your browser — no account, no cookies. We count anonymous visits, and comparing your score with other players is opt-in (<a href="../privacy.html?lang=en">privacy</a>).',
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
      caseBtn: 'Case study', caseBtnIn: 'Case study (in {lang})', caseShort: 'Case', caseShortIn: 'Case (in {lang})',
      caseTitle: 'Read the case study this simulation is built on', caseHeading: 'Case study', caseCloseAria: 'Close the case study',
      caseRights: '© 2026 Kudzu Partners / Eureka Express — all rights reserved. The case is shared to be read alongside the simulation; unlike the simulations, it is not covered by the CC BY-NC-SA licence.',
      caseLoading: 'Loading the case…', caseErr: 'Could not load the case study — {msg}',
      caseTeacher: 'For the teacher: learning objectives and simulation guide',
      access: 'Request access for my class', accessTitle: 'Classroom use takes a class license — ask Eureka for one',
      teachLevel: 'Recommended level', teachTime: 'Class time', teachDisc: 'Disciplines', teachObjH: 'Learning objectives',
      teachSrc: 'From the case study.', teachSrcIn: 'From the case study, written in {lang}.',
      teachSrcSim: 'From the simulation\'s teaching sheet.', teachSrcSimIn: 'From the simulation\'s teaching sheet; some objectives only in {lang}.', minutes: '{n} min',
      copyObj: 'Copy objectives', copyObjTitle: 'Copy the objectives as a numbered list, for a syllabus or a course proposal',
      copiedObj: 'Objectives copied', copySelect: 'Objectives selected — press Ctrl+C to copy',
      cats: { business: 'business', education: 'education', finance: 'finance', sustainability: 'sustainability', hospitality: 'hospitality', tourism: 'tourism', other: 'other' },
      lvls: { basic: 'basic', intermediate: 'intermediate', advanced: 'advanced' },
      langNames: { en: 'English', es: 'Spanish', pt: 'Portuguese' },
      topics: { marketing: 'Marketing', strategy: 'Strategy', innovation: 'Innovation', digital: 'Digital & AI', leadership: 'Leadership', negotiation: 'Negotiation', governance: 'Governance', operations: 'Operations', crisis: 'Crisis Mgmt', ethics: 'Ethics' },
      areas: { A1: 'Accounting & control', A2: 'Finance', A3: 'Economics & business environment', A4: 'Marketing', A5: 'Operations & supply chain', A6: 'Information systems & digital', A7: 'Strategy', A8: 'Organizational behavior & leadership', A9: 'Human resources', A10: 'Entrepreneurship', A11: 'Ethics, governance & society', A12: 'General management' },
      programs: { secondary: 'Secondary school', ug: 'Undergraduate', master: 'Master\'s & MBA', exec: 'Executive education' },
      audiences: { secondary: 'Secondary school', 'ug-intro': 'Undergraduate, first years', 'ug-advanced': 'Undergraduate, final years', 'masters-core': 'Master\'s & MBA core', 'masters-elective': 'Master\'s & MBA elective', 'exec-ed': 'Executive education' },
      timeGroups: { '60': 'Up to 60 min', '80': '61–80 min', '90': 'Over 80 min' },
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
      catFilterLabel: 'Categoría', levelFilterLabel: 'Dificultad', durFilterLabel: 'Rondas', langFilterLabel: 'Idioma',
      areaFilterLabel: 'Disciplina', progFilterLabel: 'Programa', timeFilterLabel: 'Tiempo en clase',
      factNote: 'Según el caso de estudio — lo indican {n} de {m} simulaciones.',
      all: 'Todas', any: 'Cualquiera',
      sortTitle: 'Ordenar resultados', sortDefault: 'Orden por defecto', sortName: 'Nombre A–Z', sortRounds: 'Rondas: menos primero',
      random: 'Aleatoria', randomTitle: 'Cargar una simulación al azar',
      count: '{n} simulación', countN: '{n} simulaciones',
      clearFilters: 'Quitar filtros',
      noMatches: 'Sin resultados — prueba otra búsqueda o filtro.',
      noCatalog: 'Catálogo no disponible — arrastra un JSON para jugar.',
      welcomeH: 'Juega una simulación Express',
      welcomeP1: 'Cada simulación Express es un único archivo JSON autocontenido (<code>view</code> + <code>css</code> + <code>js</code>). Este reproductor incorpora una implementación abierta del runtime USF, así que las simulaciones se ejecutan enteramente en tu navegador: sin cuenta y sin cookies. Contamos visitas anónimas, y comparar tu puntuación con la de otros jugadores es opcional (<a href="../privacy.html?lang=es">privacidad</a>).',
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
      caseBtn: 'Caso de estudio', caseBtnIn: 'Caso de estudio (en {lang})', caseShort: 'Caso', caseShortIn: 'Caso (en {lang})',
      caseTitle: 'Lee el caso de estudio en el que se basa esta simulación', caseHeading: 'Caso de estudio', caseCloseAria: 'Cerrar el caso de estudio',
      caseRights: '© 2026 Kudzu Partners / Eureka Express — todos los derechos reservados. El caso se comparte para leerlo junto a la simulación; a diferencia de las simulaciones, no está bajo la licencia CC BY-NC-SA.',
      caseLoading: 'Cargando el caso…', caseErr: 'No se pudo cargar el caso de estudio — {msg}',
      caseTeacher: 'Para el profesor: objetivos de aprendizaje y guía de la simulación',
      access: 'Solicitar acceso para mi clase', accessTitle: 'El uso en clase requiere una licencia — pídela a Eureka',
      teachLevel: 'Nivel recomendado', teachTime: 'Tiempo en clase', teachDisc: 'Disciplinas', teachObjH: 'Objetivos de aprendizaje',
      teachSrc: 'Según el caso de estudio.', teachSrcIn: 'Según el caso de estudio, redactado en {lang}.',
      teachSrcSim: 'Según la ficha docente de la simulación.', teachSrcSimIn: 'Según la ficha docente de la simulación; algunos objetivos solo están en {lang}.', minutes: '{n} min',
      copyObj: 'Copiar objetivos', copyObjTitle: 'Copia los objetivos como lista numerada, para la guía docente o una propuesta de asignatura',
      copiedObj: 'Objetivos copiados', copySelect: 'Objetivos seleccionados — pulsa Ctrl+C para copiar',
      cats: { business: 'negocios', education: 'educación', finance: 'finanzas', sustainability: 'sostenibilidad', hospitality: 'hostelería', tourism: 'turismo', other: 'otros' },
      lvls: { basic: 'básico', intermediate: 'intermedio', advanced: 'avanzado' },
      langNames: { en: 'inglés', es: 'español', pt: 'portugués' },
      topics: { marketing: 'Marketing', strategy: 'Estrategia', innovation: 'Innovación', digital: 'Digital e IA', leadership: 'Liderazgo', negotiation: 'Negociación', governance: 'Gobernanza', operations: 'Operaciones', crisis: 'Gestión de crisis', ethics: 'Ética' },
      areas: { A1: 'Contabilidad y control', A2: 'Finanzas', A3: 'Economía y entorno', A4: 'Marketing', A5: 'Operaciones y cadena de suministro', A6: 'Sistemas de información y digital', A7: 'Estrategia', A8: 'Comportamiento organizativo y liderazgo', A9: 'Recursos humanos', A10: 'Emprendimiento', A11: 'Ética, gobierno y sociedad', A12: 'Dirección general' },
      programs: { secondary: 'Secundaria y bachillerato', ug: 'Grado', master: 'Máster y MBA', exec: 'Executive Education' },
      audiences: { secondary: 'Secundaria y bachillerato', 'ug-intro': 'Grado, primeros cursos', 'ug-advanced': 'Grado, últimos cursos', 'masters-core': 'Máster y MBA, troncal', 'masters-elective': 'Máster y MBA, optativa', 'exec-ed': 'Executive Education' },
      timeGroups: { '60': 'Hasta 60 min', '80': '61–80 min', '90': 'Más de 80 min' },
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
  function areaLabel(id) { return (UI[lang].areas[id] || id); }
  function progLabel(id) { return (UI[lang].programs[id] || id); }
  function timeLabel(id) { return (UI[lang].timeGroups[id] || id); }

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
    if (current && view === 'preview') { renderPreviewName(); renderPreviewMeta(); renderTeach(); }
    if (current) renderCaseButtons();
    document.querySelectorAll('#caseBody details.caseTeacher > summary').forEach(function (s) { s.textContent = T('caseTeacher'); });
    if (view === 'play' && current) {
      $('simTitle').textContent = currentName();
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
    if (!current) return;
    ['frame', 'previewLive'].forEach(function (id) {
      var f = $(id);
      if (f.contentWindow) f.contentWindow.postMessage({ usfHost: true, type: 'setLang', lang: l }, '*');
    });
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
  /* A sim's name in the page language: its own translated title from the
     manifest (`names`), else the catalog name, which ships in one language. */
  function simName(s) { return (s.names && s.names[lang]) || s.name || ''; }
  function currentName() {
    var s = current.manifestSim;
    return deent((s && simName(s)) || current.data.name || current.srcName || 'Simulation');
  }
  /* what search matches: every name a sim goes by, its id and description */
  function searchText(s) {
    var names = s.names ? Object.keys(s.names).map(function (k) { return s.names[k]; }).join(' ') : '';
    return (s.name + ' ' + names + ' ' + s.id + ' ' + (s.desc || '')).toLowerCase();
  }
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

  /* ───────── anonymous analytics (js/analytics.js) ─────────
     Catalog facts only: a sim from a dropped file or a ?src= URL is 'custom',
     never its name or address. `via` says how the current sim was opened. */
  var via = 'catalog';
  function track(name, data) { if (window.eurekaTrack) window.eurekaTrack(name, data); }
  function simId() { return (current && current.manifestSim) ? current.manifestSim.id : 'custom'; }

  /* ───────── view routing ───────── */
  function setView(v) {
    view = v;
    closeCase();
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
        if (hit) { via = 'link'; loadFromManifest(hit); return; }
      } else if (srcUrl) {
        via = 'url'; loadFromUrl(srcUrl); return;
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

  function topicHit(s, id) {
    var terms = TOPIC_TERMS[id] || [id];
    var hay = (s.name + ' ' + (s.desc || '')).toLowerCase();
    return terms.some(function (k) { return hay.indexOf(k) >= 0; });
  }
  function inRange(n, groups, id) {
    var g = groups.find(function (x) { return x.id === id; });
    return !g || (n >= g.min && n <= g.max);
  }
  /* One test for the grid and for every chip count. f is a filter state like F
     plus q, the lower-cased search text; missing keys mean any. A sim whose case
     doesn't state its programs or class time never matches those filters. */
  function matches(s, f) {
    if (f.cat && s.cat !== f.cat) return false;
    if (f.topic && !topicHit(s, f.topic)) return false;
    if (f.area && s.area !== f.area) return false;
    if (f.prog && (s.programs || []).indexOf(f.prog) < 0) return false;
    if (f.time && !(s.minutes && inRange(s.minutes, TIMEGROUPS, f.time))) return false;
    if (f.lvl && s.level !== f.lvl) return false;
    if (f.dur && !inRange(s.periods || 0, DURGROUPS, f.dur)) return false;
    if (f.lang && simLangs(s).indexOf(f.lang) < 0) return false;
    if (f.q && searchText(s).indexOf(f.q) < 0) return false;
    return true;
  }
  /* the active filters, with some keys overridden (to count what a chip would give) */
  function filterState(over) {
    return Object.assign({}, F, { q: query.trim().toLowerCase() }, over || {});
  }
  function countMatches(f) { return manifest.sims.filter(function (s) { return matches(s, f); }).length; }

  /* Which filter keys each chip row sets; the category row carries the topics too. */
  var CHIP_ROWS = { chips: ['cat', 'topic'], areaChips: ['area'], progChips: ['prog'], timeChips: ['time'], lvlChips: ['lvl'], durChips: ['dur'], langChips: ['lang'] };

  function buildFilters() {
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
    function tag(btn, key, val) { btn.dataset.fkey = key; btn.dataset.fval = val; return btn; }
    /* "Any" first, then one chip per option that some sim has; counts are kept
       current by refreshCounts(). */
    function row(id, key, opts) {
      var c = $(id); c.innerHTML = '';
      var any = tag(mkBtn(c, T('any'), null, '#64748b', '', function () { F[key] = ''; selChip(any); applyFilter(); }), key, '');
      any.classList.add('on'); any.dataset.filterAll = '1';
      opts.forEach(function (o) {
        var probe = {}; probe[key] = o.val;
        var n = countMatches(probe);
        if (!n) return;
        var btn = tag(mkBtn(c, o.label, n, o.color || '#64748b', o.icon || '', function () { F[key] = o.val; selChip(btn); applyFilter(); }, o.title), key, o.val);
        if (F[key] === o.val) selChip(btn, true);
      });
    }

    // ── Category + Topic (merged into one chip row) ──
    var cats = {};
    manifest.sims.forEach(function (s) { cats[s.cat] = (cats[s.cat] || 0) + 1; });
    var chips = $('chips'); chips.innerHTML = '';
    var allCat = tag(mkBtn(chips, T('all'), manifest.sims.length, '#64748b', '', function () { F.cat = ''; F.topic = ''; selChip(allCat); applyFilter(); }), 'cat', '');
    allCat.classList.add('on'); allCat.dataset.filterAll = '1';
    // Data-driven categories
    Object.keys(cats).sort().forEach(function (c) {
      var btn = tag(mkBtn(chips, catLabel(c), cats[c], CATCOLORS[c] || '#64748b', CATEMOJI[c] || '', function () { F.cat = c; F.topic = ''; selChip(btn); applyFilter(); }), 'cat', c);
      if (c === F.cat) selChip(btn, true);
    });
    // Thin visual divider
    var sep = document.createElement('span'); sep.className = 'chip-sep'; chips.appendChild(sep);
    // Keyword-based topic chips
    TOPIC_KEYS.forEach(function (t) {
      var cnt = countMatches({ topic: t.id });
      if (!cnt) return;
      var lbl = topicLabel(t.id);
      var btn = tag(mkBtn(chips, lbl, cnt, t.color, t.icon, function () { F.topic = t.id; F.cat = ''; selChip(btn); applyFilter(); }, lbl), 'topic', t.id);
      if (t.id === F.topic) selChip(btn, true);
    });

    // ── Teaching facts from the cases ──
    row('areaChips', 'area', AREAS.map(function (a) { return { val: a.id, label: areaLabel(a.id), color: a.color, icon: a.icon }; }));
    row('progChips', 'prog', PROGRAMS.map(function (p) { return { val: p, label: progLabel(p) }; }));
    row('timeChips', 'time', TIMEGROUPS.map(function (g) { return { val: g.id, label: timeLabel(g.id) }; }));
    /* programs and class time are only known where the case states them — say how often */
    var m = manifest.sims.length;
    $('progNote').textContent = T('factNote', { n: manifest.sims.filter(function (s) { return s.programs; }).length, m: m });
    $('timeNote').textContent = T('factNote', { n: manifest.sims.filter(function (s) { return s.minutes; }).length, m: m });

    // ── Difficulty, rounds, language ──
    row('lvlChips', 'lvl', ['basic', 'intermediate', 'advanced'].map(function (l) { return { val: l, label: lvlLabel(l), color: LVLCOLORS[l] }; }));
    row('durChips', 'dur', DURGROUPS.map(function (g) { return { val: g.id, label: durLabel(g.id), color: g.color, icon: g.icon, title: durHint(g.id) }; }));
    // which languages a simulation actually ships in
    var langs = {};
    manifest.sims.forEach(function (s) { simLangs(s).forEach(function (l) { langs[l] = 1; }); });
    row('langChips', 'lang', Object.keys(langs).sort().map(function (l) { return { val: l, label: langName(l) }; }));
  }
  /* Recalculate chip counts after every filter change — each count shows how many
     results you'd get if you selected that option with all other active filters kept. */
  function refreshCounts() {
    if (!manifest) return;
    function applyToChip(btn, n) {
      var cntEl = btn.querySelector('.catbtn-cnt');
      if (!cntEl) return;
      cntEl.textContent = n;
      var dim = n === 0 && !btn.classList.contains('on');
      btn.style.opacity = dim ? '0.3' : '';
      btn.style.pointerEvents = dim ? 'none' : '';
    }
    Object.keys(CHIP_ROWS).forEach(function (id) {
      var clear = {};
      CHIP_ROWS[id].forEach(function (k) { clear[k] = ''; });
      $(id).querySelectorAll('.catbtn').forEach(function (btn) {
        if (!btn.querySelector('.catbtn-cnt')) return;
        var over = Object.assign({}, clear);
        if (btn.dataset.fval) over[btn.dataset.fkey] = btn.dataset.fval;
        applyToChip(btn, countMatches(filterState(over)));
      });
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
      copy.sort(function (a, b) { return deent(simName(a)).localeCompare(deent(simName(b)), undefined, { sensitivity: 'base' }); });
    } else if (activeSort === 'rounds') {
      copy.sort(function (a, b) { return (a.periods || 0) - (b.periods || 0); });
    }
    // '' (relevance/default) — keep the manifest's own order, already preserved by filter().
    return copy;
  }

  function filtersActive() { return Object.keys(F).some(function (k) { return F[k]; }) || !!query.trim(); }
  function updateClearBtn() { $('btnClear').style.display = filtersActive() ? 'inline-block' : 'none'; }
  function resetFilters() {
    query = ''; $('search').value = '';
    Object.keys(F).forEach(function (k) { F[k] = ''; });
    Object.keys(CHIP_ROWS).forEach(function (id) {
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
    var f = filterState();
    filtered = sortSims(manifest.sims.filter(function (s) { return matches(s, f); }));
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
    var img = s.cover || s.svg;
    var cover = img
      ? '<img loading="lazy" src="' + esc(img) + '" alt="">'
      : '<div class="tileinit" style="background:' + color + '">' + esc((s.name || '?').charAt(0).toUpperCase()) + '</div>';
    var lvlHtml = s.level ? '<span class="lvlbadge lvl-' + esc(s.level) + '">' + esc(lvlLabel(s.level)) + '</span>' : '';
    var ls = simLangs(s);
    var langHtml = '<span class="lg" title="' + esc(ls.map(langName).join(' · ')) + '">' + esc(ls.join('·')) + '</span>';
    var caseHtml = s.case ? '<span class="casemark" title="' + esc(T('caseBtn')) + '" aria-label="' + esc(T('caseBtn')) + '">📄</span>' : '';
    var q = query.trim();
    var nameHtml = highlightName(simName(s));
    var snippet = (q && nameHtml.indexOf('<mark>') < 0) ? descSnippet(s.desc, q) : ''; // surface why a desc-only match hit
    d.innerHTML = '<div class="cardcover">' + cover + '</div>' +
      '<div class="cardbody">' +
      '<div class="cardname">' + nameHtml + '</div>' +
      '<div class="cardtags"><span class="catpill" style="background:' + color + '">' + esc(catLabel(s.cat)) + '</span>' + lvlHtml + langHtml + caseHtml + '</div>' +
      (s.periods ? '<div class="cardrounds">' + s.periods + ' ' + T(s.periods === 1 ? 'round' : 'rounds') +
        (s.minutes ? ' · ' + esc(T('minutes', { n: s.minutes })) : '') + '</div>' : '') +
      (snippet ? '<div class="cardsnip">' + snippet + '</div>' : '') +
      '</div>';
    d.onclick = function () { via = 'catalog'; loadFromManifest(s); };
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
    via = 'file';
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
    renderCaseButtons();
    loadTeach();
    setView('preview');
    syncUrl();
    track('sim_preview', { sim: simId(), via: via });
    via = 'catalog';
  }

  function renderPreview() {
    var d = current.data, s = current.manifestSim;
    var svg = s && (s.cover || s.svg);
    var color = CATCOLORS[(s && s.cat) || ''] || '#64748b';
    var name = currentName();

    $('previewCover').innerHTML = svg
      ? '<img src="' + esc(svg) + '" alt="">'
      : '<div class="tileinit" style="background:' + color + '">' + esc(name.charAt(0).toUpperCase()) + '</div>';
    renderPreviewName();
    renderPreviewMeta();
    $('previewDesc').textContent = deent(d.description || '');
    $('btnPlayBar').style.display = 'inline-block';
    $('btnAccess').href = 'https://www.eurekasimulations.com/basics/?utm_source=open_site&utm_medium=player&utm_campaign=class_access' +
      (s ? '&utm_content=sim-' + encodeURIComponent(s.id) : '');
    renderPreviewFrame();
  }

  /* The preview runs the sim itself, so it opens in the page language with its
     opening numbers filled in, but read-only: PREVIEW_GUARD swallows every click,
     key and focus before the sim sees it (the wheel still scrolls) and pins the
     view to the top. Its messages never reach the chrome — the listener below
     only trusts the Play frame. Until the runtime shim has loaded, a static
     HTML+CSS render stands in; the shim's loader swaps the live one in.
     Scrollbar is hidden via CSS but scroll still works via mouse wheel. */
  var PREVIEW_STYLE = '<style>*{box-sizing:border-box}html{margin:0;overflow-x:hidden}body{margin:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none}body::-webkit-scrollbar{display:none}<\/style>';
  var PREVIEW_GUARD = '<script>(function(){' +
    'function stop(e){e.preventDefault();e.stopImmediatePropagation();}' +
    "['pointerdown','mousedown','mouseup','click','dblclick','keydown','keypress','touchend','submit'].forEach(function(t){window.addEventListener(t,stop,true);});" +
    "window.addEventListener('focusin',function(e){if(e.target&&e.target.blur)e.target.blur();},true);" +
    "if('scrollRestoration' in history)history.scrollRestoration='manual';" +
    "window.addEventListener('load',function(){window.scrollTo(0,0);});" +
    '})();<\/script>';
  function renderPreviewFrame() {
    var d = current.data;
    $('previewLive').srcdoc = shimSrc
      ? simDoc(d, simStartLang(), PREVIEW_STYLE, PREVIEW_GUARD)
      : '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' + PREVIEW_STYLE +
        '<style>' + escScript(d.css || '') + '<\/style><\/head>' +
        '<body>' + previewView(d.view || '') + '<\/body><\/html>';
    requestAnimationFrame(updatePreviewScale);
  }

  /* The static fallback preview has no runtime, so a designer default would show as if it had
     been chosen, including answers the EQIL guard clears at play time. Strip the
     defaults here: lists render blank, boxes and radios unticked. Disabled inputs
     (mandatory items) keep their state. */
  function previewView(html) {
    return String(html)
      .replace(/<(option|input)\b[^>]*>/gi, function (tag) {
        if (/\sdisabled\b/i.test(tag)) return tag;
        return tag.replace(/\s(selected|checked)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?(?=[\s\/>])/gi, '');
      })
      .replace(/<select\b[^>]*>/gi, function (tag) { return tag + '<option value="" selected hidden></option>'; });
  }

  function renderPreviewName() {
    var name = currentName();
    $('previewName').textContent = name;
    $('previewBarTitle').textContent = name;
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
  $('btnAccess').addEventListener('click', function () { track('access_click', { sim: simId(), lang: lang }); });

  /* ───────── case study reader ─────────
     cases/{id}.md is the teaching case a sim is built on. Unlike the sims it is
     all rights reserved (see LICENSE.md), which the reader states above the
     text. Raw HTML in the markdown is shown as text, never rendered; links
     open in a new tab. */
  var caseMd = window.marked ? new marked.Marked({
    gfm: true,
    renderer: { html: function (html) { return esc(html); } }
  }) : null;
  var caseLoaded = null, caseReturnFocus = null, caseTexts = {};
  /* one fetch per case: the preview's teaching facts and the reader share it */
  function caseText(path) {
    if (!caseTexts[path]) {
      caseTexts[path] = fetch(path).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (md) { return md.replace(/\r\n?/g, '\n'); }); // some cases ship CRLF
      caseTexts[path].catch(function () { delete caseTexts[path]; });
    }
    return caseTexts[path];
  }

  /* Cases open with a catalogue header for the source library, in one of two
     shapes: a fenced block of "Key:   value" lines under the title (Case Code,
     Length, Companion materials, Keywords…), or bold lines around the title —
     "**Case Code:** … · **Companion simulation:** …" (or its Spanish and
     Portuguese "**Código del/de/do caso:**"), sometimes "**Track:** …", and
     "**Time required: 80 minutes**" / "**Tiempo de clase: 80 minutos**". It is
     internal bookkeeping, not part of the story, so the reader drops it,
     keeping only the subtitle; the preview reads the fields a teacher needs. */
  var CASE_FENCE = /^(#[^\n]*\n+)```[^\n]*\n([\s\S]*?)\n```[ \t]*\n/;
  var CASE_BOLD = /^((?:#[^\n]*\n+)?)((?:\*\*(?:Case [Cc]ode|Código d[eo]l? caso|Track|Time required|Tiempo de clase)[^\n]*\n+)+)/;
  function caseHeader(md) {
    var m = md.match(CASE_FENCE), f = {};
    if (m) {
      m[2].split('\n').forEach(function (ln) {
        var kv = ln.match(/^([A-Za-z][A-Za-z ()\/]*?):\s+(.+)$/);
        if (kv) f[kv[1].trim()] = kv[2].trim();
      });
    }
    var t = md.match(/\*\*Time required:\s*([^*\n]+?)\s*\*\*/) || md.match(/\*\*Tiempo de clase:\s*([^*\n]+?)\s*\*\*/);
    if (t && !f['Time required']) f['Time required'] = t[1];
    return f;
  }
  function stripCaseHeader(md) {
    var sub = caseHeader(md).Subtitle;
    md = md.replace(CASE_FENCE, function (all, title) { return title + (sub ? '*' + sub + '*\n\n' : ''); });
    return md.replace(CASE_BOLD, '$1').replace(/^---\n+/, ''); // header-first cases leave a rule on top
  }
  /* Two sections are written for the teacher, not for the reader of the story:
     the learning objectives, and the appendix that maps the case to the sim's
     rounds and carries the debrief prompts. The reader moves them into one
     closed block at the end. A section runs to the next "## " heading or "---"
     rule; removing one leaves two rules in a row, which collapse to one. */
  var TEACHER_SECTIONS = /^##\s+(?:Learning Objectives|Appendix: Simulation Linkage)\b[^\n]*\n[\s\S]*?(?=^##\s|^---[ \t]*$|(?![\s\S]))/gm;
  function splitTeacher(md) {
    var teacher = [];
    var story = md.replace(TEACHER_SECTIONS, function (sec) { teacher.push(sec.trim()); return ''; })
      .replace(/^---[ \t]*\n\s*(?=^---[ \t]*$)/gm, '');
    return { story: story, teacher: teacher.join('\n\n') };
  }
  function caseObjectives(md) {
    var sec = md.match(/^##\s+Learning Objectives[^\n]*\n([\s\S]*?)(?=\n---|\n##\s)/m);
    if (!sec) return [];
    var out = [], re = /^\s*\d+\.\s+(.+)$/gm, m;
    while ((m = re.exec(sec[1]))) out.push(m[1].replace(/\*+/g, '').trim());
    return out;
  }
  function splitList(s) { return s ? s.split(/\s*;\s*/).filter(Boolean) : []; }

  /* ───────── teaching facts on the preview ───────── */
  /* Two sources. The sim's own `teaching` block (kudzu Express_Teaching_Block_Spec)
     carries codes and text in each language, so it is read again on every render;
     without one, the case header gives free text in the case's language. */
  function loadTeach() {
    var s = current.manifestSim, block = current.data.teaching;
    current.teach = null;
    if (block && typeof block === 'object' && Array.isArray(block.objectives)) {
      current.teach = { block: block };
      renderTeach();
      return;
    }
    renderTeach();
    if (!s || !s.case) return;
    caseText(s.case).then(function (md) {
      if (!current || current.manifestSim !== s) return; // moved on while it loaded
      var h = caseHeader(md);
      current.teach = { level: splitList(h.Level), time: h['Time required'] || '', disc: splitList(h['Discipline(s)']), obj: caseObjectives(md), lang: s.caseLang || 'en' };
      renderTeach();
    }).catch(function () { });
  }
  /* What the preview shows, in one shape: labels, minutes or the case's time text,
     and objectives as {text, lang}. Text the block lacks in the page language falls
     back to English. */
  function teachView(t) {
    if (!t) return null;
    if (!t.block) {
      return { level: t.level, time: t.time, disc: t.disc, factsLang: t.lang, srcLang: t.lang, fromSim: false,
        obj: t.obj.map(function (o) { return { text: o, lang: t.lang }; }) };
    }
    var b = t.block, d = b.discipline || {};
    var tops = [d.primary].concat(d.secondary || []).map(function (c) { return String(c || '').split('.')[0]; })
      .filter(function (a, i, all) { return UI[lang].areas[a] && all.indexOf(a) === i; });
    var obj = b.objectives.map(function (o) {
      var tx = (o && o.text) || {};
      return tx[lang] ? { text: tx[lang], lang: lang } : { text: tx.en || '', lang: 'en' };
    }).filter(function (o) { return o.text; });
    return {
      level: (b.audience || []).filter(function (a) { return UI[lang].audiences[a]; }).map(function (a) { return UI[lang].audiences[a]; }),
      minutes: (b.duration && b.duration.class_minutes) || 0,
      disc: tops.map(areaLabel), factsLang: lang, fromSim: true, obj: obj,
      srcLang: obj.some(function (o) { return o.lang !== lang; }) ? 'en' : lang
    };
  }
  function renderTeach() {
    var t = teachView(current && current.teach);
    var has = t && (t.level.length || t.time || t.minutes || t.disc.length || t.obj.length);
    $('previewTeach').hidden = !has;
    if (!has) return;
    var factsLangAttr = ' lang="' + esc(t.factsLang) + '"';
    function chips(arr) { return arr.map(function (x) { return '<span class="teachchip"' + factsLangAttr + '>' + esc(x) + '</span>'; }).join(''); }
    var facts = [];
    if (t.level.length) facts.push('<div><dt>' + esc(T('teachLevel')) + '</dt><dd>' + chips(t.level) + '</dd></div>');
    var timeHtml = '';
    if (t.minutes) timeHtml = esc(T('minutes', { n: t.minutes }));
    else if (t.time) {
      var mins = t.time.match(/^(\d+(?:\s*[–-]\s*\d+)?)\s*minut[eo]s?\s*(.*)$/i);
      timeHtml = mins ? esc(T('minutes', { n: mins[1].replace(/\s+/g, '') })) + (mins[2] ? ' <span' + factsLangAttr + '>' + esc(mins[2]) + '</span>' : '') : '<span' + factsLangAttr + '>' + esc(t.time) + '</span>';
    }
    if (timeHtml) facts.push('<div><dt>' + esc(T('teachTime')) + '</dt><dd class="teachtime">' + timeHtml + '</dd></div>');
    if (t.disc.length) facts.push('<div><dt>' + esc(T('teachDisc')) + '</dt><dd>' + chips(t.disc) + '</dd></div>');
    $('teachFacts').innerHTML = facts.join('');
    $('teachObjWrap').hidden = !t.obj.length;
    $('teachObj').removeAttribute('lang');
    $('teachObj').innerHTML = t.obj.map(function (o) { return '<li lang="' + esc(o.lang) + '">' + esc(o.text) + '</li>'; }).join('');
    var src = t.fromSim ? 'teachSrcSim' : 'teachSrc';
    $('teachSrc').textContent = t.srcLang !== lang ? T(src + 'In', { lang: langName(t.srcLang) }) : T(src);
  }
  /* A numbered list with the sim's name on top, ready to paste into a syllabus.
     Where the clipboard is refused, the list is selected instead. */
  $('btnCopyObj').onclick = function () {
    var t = teachView(current && current.teach);
    if (!t || !t.obj.length) return;
    var text = T('teachObjH') + ' — ' + currentName() + ' (Eureka Express #' + simId() + ')\n' +
      t.obj.map(function (o, i) { return (i + 1) + '. ' + o.text; }).join('\n');
    track('objectives_copy', { sim: simId() });
    function selectList() {
      var r = document.createRange(), sel = window.getSelection();
      r.selectNodeContents($('teachObj'));
      sel.removeAllRanges(); sel.addRange(r);
      toast(T('copySelect'));
    }
    try { navigator.clipboard.writeText(text).then(function () { toast(T('copiedObj')); }, selectList); }
    catch (e) { selectList(); }
  };

  function caseSim() { return (caseMd && current && current.manifestSim && current.manifestSim.case) ? current.manifestSim : null; }
  /* the case ships in one language — say so on the button when it isn't the page's */
  function caseLabel(key) {
    var s = caseSim();
    return (s.caseLang && s.caseLang !== lang) ? T(key + 'In', { lang: langName(s.caseLang) }) : T(key);
  }
  function renderCaseButtons() {
    var s = caseSim();
    $('btnCase').style.display = s ? 'inline-block' : 'none';
    $('btnCaseBar').style.display = s ? 'inline-block' : 'none';
    if (!s) return;
    $('btnCase').querySelector('.caseLabel').textContent = caseLabel('caseBtn');
    $('btnCaseBar').querySelector('.caseBarLabel').textContent = caseLabel('caseShort');
  }
  function openCase() {
    var s = caseSim();
    if (!s) return;
    track('case_open', { sim: s.id, from: view });
    caseReturnFocus = document.activeElement;
    $('caseModal').hidden = false;
    $('caseClose').focus();
    if (caseLoaded === s.case) return;
    var body = $('caseBody');
    body.setAttribute('lang', s.caseLang || 'en');
    body.textContent = T('caseLoading');
    body.scrollTop = 0;
    caseText(s.case)
      .then(function (md) {
        if (caseSim() !== s) return; // moved on to another sim while it loaded
        var parts = splitTeacher(stripCaseHeader(md));
        body.innerHTML = caseMd.parse(parts.story) + (parts.teacher
          ? '<details class="caseTeacher"><summary>' + esc(T('caseTeacher')) + '</summary>' + caseMd.parse(parts.teacher) + '</details>'
          : '');
        body.querySelectorAll('a[href]').forEach(function (a) {
          var href = a.getAttribute('href');
          if (!/^(https?:|mailto:|#)/i.test(href)) { a.removeAttribute('href'); return; }
          if (href.charAt(0) !== '#') { a.target = '_blank'; a.rel = 'noopener'; }
        });
        caseLoaded = s.case;
      })
      .catch(function (e) { body.textContent = T('caseErr', { msg: e.message }); });
  }
  function closeCase() {
    if ($('caseModal').hidden) return;
    $('caseModal').hidden = true;
    if (caseReturnFocus && caseReturnFocus.focus) caseReturnFocus.focus();
    caseReturnFocus = null;
  }
  $('btnCase').onclick = openCase;
  $('btnCaseBar').onclick = openCase;
  $('caseClose').onclick = closeCase;
  $('caseModal').addEventListener('click', function (e) { if (e.target === this) closeCase(); });
  /* Escape closes; Tab stays inside the dialog while it is open */
  document.addEventListener('keydown', function (e) {
    if ($('caseModal').hidden) return;
    if (e.key === 'Escape') { closeCase(); return; }
    if (e.key !== 'Tab') return;
    var f = $('caseModal').querySelectorAll('button, a[href]');
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!$('caseModal').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

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
    $('simTitle').textContent = currentName();
    $('simTitle').title = d.description || '';
    $('simMeta').textContent = playMetaLine(d, current.manifestSim);
    ['btnHint', 'btnRestart', 'btnExport', 'btnFull'].forEach(function (b) { $(b).style.display = 'inline-block'; });
    renderCaseButtons();
    $('progress').style.display = 'inline-block';
    $('progress').textContent = '…';
    $('langs').innerHTML = '';
    lastProgress = null;
    setView('play');
    buildFrame();
    var s = current.manifestSim;
    track('sim_play', { sim: simId(), lang: lang, level: ((s && s.level) || d.level || '').toLowerCase() });
  }

  /* The USF shim picks its starting language from <html lang>, so a sim that
     ships the preferred language opens in it — no click needed. Sims whose
     language support we don't know (dropped file, ?src=) fall back to the shim's own default. */
  function simStartLang() { return (!current.langs || current.langs.indexOf(lang) >= 0) ? lang : 'en'; }
  /* One runnable document for both the Play frame and the live preview;
     the preview adds its own style and the read-only guard script. */
  function simDoc(d, startLang, extraHead, extraBody) {
    return '<!DOCTYPE html><html lang="' + esc(startLang) + '"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>html{-webkit-text-size-adjust:100%}body{margin:0}</style>' + (extraHead || '') +
      '<style>' + escScript(d.css || '') + '</style></head><body>' +
      (extraBody || '') +
      (d.view || '') +
      (chartSrc ? '<script>' + escScript(chartSrc) + '<\/script>' : '') +
      '<script>window.__USF_MAX_PERIODS__=' + (parseInt(d.max_periods, 10) || 5) + ';<\/script>' +
      '<script>' + escScript(shimSrc) + '<\/script>' +
      '<script>' + escScript(d.js || '') + '<\/script>' +
      '</body></html>';
  }
  function buildFrame() {
    if (!shimSrc) return; // shim still loading; playCurrent()/restart will retry once it's ready
    $('frame').srcdoc = simDoc(current.data, simStartLang());
    if (window.EurekaBenchmark) window.EurekaBenchmark.reset();
  }

  /* messages from the sim iframe */
  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    /* only the sandboxed sim frame may drive the chrome */
    if (!m.usfPlayer || ev.source !== $('frame').contentWindow) return;
    if (m.type === 'ready') {
      current.simLang = m.lang;
      current.langs = (m.langs && m.langs.length) ? m.langs : ['en'];
      renderSimLangs(m.langs || [], m.lang);
      /* a ?src= sim may simply not have the preferred language */
      if (m.lang !== lang && current.langs.indexOf(lang) < 0) {
        notice(T('onlyLang', { langs: current.langs.map(langName).join(', '), lang: langName(m.lang) }), 'info');
      }
    }
    if (m.type === 'lang') {
      if (current.simLang && m.lang !== current.simLang) track('sim_lang', { sim: simId(), to: m.lang });
      current.simLang = m.lang;
      renderSimLangs(current && current.langs ? current.langs : [m.lang], m.lang);
      /* switching the sim switches the chrome too — one language, one page */
      if (m.lang !== lang) setLang(m.lang, { fromSim: true });
    }
    if (m.type === 'progress') {
      /* a round played (not the opening state, not an undo) */
      if (lastProgress && !m.finished && m.period > lastProgress.period) track('sim_round', { sim: simId(), round: m.period - 1, of: m.maxPeriods });
      lastProgress = m; showProgress(m);
    }
    if (m.type === 'hint' && m.text) toast('💡 ' + m.text);
    if (m.type === 'hint' && m.empty) toast(T('noHint'));
    if (m.type === 'finished') {
      toast(T('done'));
      var score = (typeof m.score === 'number' && isFinite(m.score)) ? Math.round(m.score * 10) / 10 : null;
      track('sim_finish', { sim: simId(), lang: current.simLang || lang, rounds: m.periods, score: score });
      /* opt-in comparison: catalog sims only — a custom sim has no peers to compare with */
      if (window.EurekaBenchmark && current.manifestSim && score !== null) {
        window.EurekaBenchmark.offer({
          sim: current.manifestSim.id, lang: current.simLang || lang, level: current.manifestSim.level || '',
          periods: m.periods, score: score, summary: m.summary
        });
      }
    }
    if (m.type === 'restart') { track('sim_restart', { sim: simId(), from: 'summary' }); buildFrame(); }
    if (m.type === 'error') notice(T('errSim', { msg: m.message }), 'err');
    if (m.type === 'session') {
      track('session_export', { sim: simId() });
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
  $('btnRestart').onclick = function () {
    if (!current) return;
    track('sim_restart', { sim: simId(), from: 'bar', round: lastProgress ? lastProgress.period : 0 });
    buildFrame();
  };
  $('btnHint').onclick = function () { track('hint', { sim: simId() }); $('frame').contentWindow.postMessage({ usfHost: true, type: 'requestHint' }, '*'); };
  $('btnExport').onclick = function () { $('frame').contentWindow.postMessage({ usfHost: true, type: 'requestSession' }, '*'); };
  $('btnFull').onclick = function () {
    var f = $('frame');
    // requestFullscreen() returns a Promise that rejects (e.g. Permissions-Policy, platform
    // restrictions) without ever throwing synchronously — catch it so a denial doesn't surface
    // as an unhandled rejection in the console.
    try { Promise.resolve((f.requestFullscreen || f.webkitRequestFullscreen || function () { }).call(f)).catch(function () { }); }
    catch (e) { }
  };
  function randomSim() { via = 'random'; if (manifest && manifest.sims.length) loadFromManifest(manifest.sims[Math.floor(Math.random() * manifest.sims.length)]); }
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
    .then(function (t) {
      shimSrc = t;
      if (current && view === 'play') buildFrame();
      if (current && view === 'preview') renderPreviewFrame();
    })
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
