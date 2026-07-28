/* ── i18n for the bits that live outside the DOM: head metadata, aria
   labels, and the links that carry the language into the player ── */
(function () {
  var META = {
    en: {
      title: 'Open Simulations — 500 free business simulations for teaching | Eureka Express',
      desc: "500 openly licensed business simulations for teaching — strategy, finance, operations, negotiation, hospitality, sustainability, AI. Playable in your browser, free for personal use. And a short case study on what happens when the cost of content goes to zero.",
      ogTitle: 'Open Simulations — 500 free business simulations for teaching',
      ogDesc: 'Openly licensed, playable in your browser, reviewed and replay-tested. Free for personal use; licensed for the classroom. Plus: a case study on content whose marginal cost just hit zero.',
      ogLocale: 'en_US',
      statsAria: 'Catalog statistics',
      cats: { business: 'business', finance: 'finance', education: 'education', sustainability: 'sustainability', hospitality: 'hospitality', tourism: 'tourism', other: 'other' }
    },
    es: {
      title: 'Simulaciones Abiertas — 500 simulaciones de empresa gratuitas para enseñar | Eureka Express',
      desc: '500 simulaciones de empresa con licencia abierta para enseñar: estrategia, finanzas, operaciones, negociación, hostelería, sostenibilidad e IA. Jugables en tu navegador, gratis para uso personal. Y un breve caso sobre qué pasa cuando el coste del contenido cae a cero.',
      ogTitle: 'Simulaciones Abiertas — 500 simulaciones de empresa gratuitas para enseñar',
      ogDesc: 'Licencia abierta, jugables en tu navegador, revisadas y probadas en replay. Gratis para uso personal; licenciadas para el aula. Además: un caso sobre un contenido cuyo coste marginal acaba de llegar a cero.',
      ogLocale: 'es_ES',
      statsAria: 'Estadísticas del catálogo',
      cats: { business: 'negocios', finance: 'finanzas', education: 'educación', sustainability: 'sostenibilidad', hospitality: 'hostelería', tourism: 'turismo', other: 'otros' }
    }
  };

  function getLang() { return document.documentElement.getAttribute('data-lang') === 'es' ? 'es' : 'en'; }
  function set(id, attr, v) { var el = document.getElementById(id); if (el) el.setAttribute(attr, v); }

  /* Carry the language into the player so a shared link opens in the same one. */
  function relinkPlayer(lang) {
    document.querySelectorAll('a[href*="player/"]').forEach(function (a) {
      var base = a.getAttribute('data-href') || a.getAttribute('href');
      a.setAttribute('data-href', base);
      var parts = base.split('?');
      var p = new URLSearchParams(parts[1] || '');
      p.set('lang', lang);
      a.setAttribute('href', parts[0] + '?' + p.toString());
    });
  }

  function applyLang(lang) {
    if (lang !== 'en' && lang !== 'es') lang = 'en';
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang);
    try { localStorage.setItem('eureka-lang', lang); } catch (e) { }
    var M = META[lang];
    document.title = M.title;
    set('metaDesc', 'content', M.desc);
    set('ogTitle', 'content', M.ogTitle);
    set('ogDesc', 'content', M.ogDesc);
    set('ogLocale', 'content', M.ogLocale);
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', M[el.getAttribute('data-i18n-aria')] || el.getAttribute('aria-label'));
    });
    document.querySelectorAll('.lang-switch [data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
    });
    relinkPlayer(lang);
    try {
      var p = new URLSearchParams(location.search);
      p.set('lang', lang);
      history.replaceState(null, '', location.pathname + '?' + p.toString());
    } catch (e) { }
  }

  document.querySelectorAll('.lang-switch [data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.getAttribute('data-set-lang')); });
  });
  applyLang(getLang());

  /* Progressive enhancement: refresh stats + category chips from the live
     manifest. Static fallbacks above are correct as of the last release.
     Chips render both languages at once — the CSS shows the active one. */
  try {
    fetch('player/manifest.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m || !m.count) return;
      var c = document.getElementById('stat-count'); if (c) c.textContent = m.count;
      var cats = m.categories || {};
      var keys = Object.keys(cats);
      var sc = document.getElementById('stat-cats'); if (sc) sc.textContent = keys.length;
      var chips = document.getElementById('chips');
      if (chips && keys.length) {
        keys.sort(function (a, b) { return cats[b] - cats[a]; });
        chips.innerHTML = keys.map(function (k) {
          var en = (META.en.cats[k] || k), es = (META.es.cats[k] || k);
          return '<span class="chip"><b>' + cats[k] + '</b> <span class="lang-en">' + en + '</span><span class="lang-es">' + es + '</span></span>';
        }).join('');
      }
    }).catch(function () { });
  } catch (e) { }
})();
