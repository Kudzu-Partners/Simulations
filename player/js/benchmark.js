/*
 * "Compare your run": opt-in benchmarking at the end of a simulation.
 *
 * player.js calls EurekaBenchmark.offer(run) when a catalog sim finishes and
 * EurekaBenchmark.reset() whenever it builds a new play frame. The card asks
 * first; nothing leaves the browser unless the player presses Compare. Then
 * one call to the Supabase function submit_run() stores the run and returns
 * aggregate comparisons (see supabase/migrations). If the service is off or
 * unreachable, the card says so and the game is untouched.
 *
 * Reads window.EUREKA_CONFIG (config.js); off unless supabaseUrl and
 * supabaseAnonKey are set and the host is ours (analytics.js decides that).
 */
(function () {
  'use strict';
  var C = window.EUREKA_CONFIG || {};
  var MIN_RUNS = 10;      // fewer other runs than this: say "recorded", don't show a percentile
  var MIN_CLASS = 2;      // a class comparison needs at least this many classmates
  var MAX_SUMMARY = 12000; // characters of JSON; bigger summaries are sent without it
  var PREFS_KEY = 'eureka-bench-prefs';
  var LEVELS = ['ug', 'masters', 'mba', 'professional', 'other'];

  var TX = {
    en: {
      h: 'Compare your run',
      intro: 'See how your score of <b>{score}</b> compares with other players of this simulation. Optional and anonymous.',
      nick: 'Nickname', nickHint: 'Optional. Anything you like, shown only to your class.',
      level: 'Your level', levelPick: 'Choose…',
      levels: { ug: 'Undergraduate', masters: 'Master’s', mba: 'MBA', professional: 'Professional / executive', other: 'Other' },
      code: 'Class code', codeHint: 'Optional, if your lecturer gave you one.',
      go: 'Compare my run', no: 'No thanks', close: 'Close', closeAria: 'Close the comparison',
      sending: 'Comparing…',
      privacy: 'Stores your score, rounds, language, level, and the nickname and class code you enter. No account, no cookies, no IP address. <a href="{href}" target="_blank" rel="noopener">Privacy</a>',
      needLevel: 'Choose your level first.',
      badCode: 'That class code wasn’t found or has expired. Check it, or leave it blank.',
      wrongSim: 'That class code is for a different simulation.',
      limited: 'Too many comparisons from your network in the last hour. Try again later.',
      offline: 'Couldn’t reach the comparison service. Your game is unaffected.',
      yourScore: 'Your score',
      everyone: 'Everyone', peers: 'At your level ({level})', klass: 'Your class',
      runs: '{n} other runs', run: '1 other run',
      beat: 'Better than {p}%', median: 'median {m}', rank: '#{r} of {n}',
      early: 'Your run is recorded. Not enough runs yet to compare ({n} so far). Check back after more people play.',
      again: 'Play again with a different strategy and compare.'
    },
    es: {
      h: 'Compara tu partida',
      intro: 'Mira cómo queda tu puntuación de <b>{score}</b> frente a la de otros jugadores de esta simulación. Opcional y anónimo.',
      nick: 'Apodo', nickHint: 'Opcional. El que quieras; solo lo ve tu clase.',
      level: 'Tu nivel', levelPick: 'Elige…',
      levels: { ug: 'Grado', masters: 'Máster', mba: 'MBA', professional: 'Profesional / directivo', other: 'Otro' },
      code: 'Código de clase', codeHint: 'Opcional, si tu profesor te dio uno.',
      go: 'Comparar mi partida', no: 'No, gracias', close: 'Cerrar', closeAria: 'Cerrar la comparación',
      sending: 'Comparando…',
      privacy: 'Guarda tu puntuación, rondas, idioma, nivel y el apodo y código de clase que escribas. Sin cuenta, sin cookies, sin dirección IP. <a href="{href}" target="_blank" rel="noopener">Privacidad</a>',
      needLevel: 'Elige primero tu nivel.',
      badCode: 'No encontramos ese código de clase o ha caducado. Revísalo o déjalo en blanco.',
      wrongSim: 'Ese código de clase es de otra simulación.',
      limited: 'Demasiadas comparaciones desde tu red en la última hora. Inténtalo más tarde.',
      offline: 'No se pudo conectar con el servicio de comparación. Tu partida no se ve afectada.',
      yourScore: 'Tu puntuación',
      everyone: 'Todos', peers: 'De tu nivel ({level})', klass: 'Tu clase',
      runs: '{n} partidas más', run: '1 partida más',
      beat: 'Mejor que el {p}%', median: 'mediana {m}', rank: 'n.º {r} de {n}',
      early: 'Tu partida queda registrada. Aún no hay suficientes partidas para comparar ({n} por ahora). Vuelve cuando haya jugado más gente.',
      again: 'Juega otra vez con otra estrategia y compara.'
    }
  };

  function enabled() {
    return !!(C.supabaseUrl && C.supabaseAnonKey && window.eurekaTelemetryAllowed && window.eurekaTelemetryAllowed());
  }
  function L() { return TX[document.documentElement.lang] || TX.en; }
  function t(key, p) {
    var s = L()[key] || TX.en[key] || key;
    Object.keys(p || {}).forEach(function (k) { s = s.split('{' + k + '}').join(p[k]); });
    return s;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '–';
    return n.toLocaleString(document.documentElement.lang || 'en', { maximumFractionDigits: 1 });
  }
  function track(name, data) { if (window.eurekaTrack) window.eurekaTrack(name, data); }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { } }
  function privacyHref() { return new URL('../privacy.html', location.href).pathname + '?lang=' + (document.documentElement.lang || 'en'); }

  var el = null, run = null, done = false;

  function panel() {
    if (el) return el;
    el = document.createElement('aside');
    el.id = 'bench';
    el.hidden = true;
    el.setAttribute('aria-labelledby', 'benchH');
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    (document.getElementById('viewPlay') || document.body).appendChild(el);
    return el;
  }
  function hide() { if (el) el.hidden = true; }
  function frame(body) {
    return '<header><h2 id="benchH">' + esc(t('h')) + '</h2>' +
      '<button type="button" class="bench-x" aria-label="' + esc(t('closeAria')) + '">✕</button></header>' +
      '<div class="bench-body" aria-live="polite">' + body + '</div>';
  }
  function wireClose() {
    el.querySelectorAll('.bench-x, .bench-close').forEach(function (b) { b.onclick = hide; });
  }

  function renderAsk(errorKey) {
    var p = loadPrefs();
    var lv = L().levels;
    var opts = '<option value="">' + esc(t('levelPick')) + '</option>' + LEVELS.map(function (k) {
      return '<option value="' + k + '"' + (p.level === k ? ' selected' : '') + '>' + esc(lv[k]) + '</option>';
    }).join('');
    panel().innerHTML = frame(
      '<p>' + t('intro', { score: esc(fmt(run.score)) }) + '</p>' +
      '<label for="benchNick">' + esc(t('nick')) + '</label>' +
      '<input id="benchNick" type="text" maxlength="30" autocomplete="off" value="' + esc(p.nick || '') + '">' +
      '<small>' + esc(t('nickHint')) + '</small>' +
      '<label for="benchLevel">' + esc(t('level')) + '</label>' +
      '<select id="benchLevel">' + opts + '</select>' +
      '<label for="benchCode">' + esc(t('code')) + '</label>' +
      '<input id="benchCode" type="text" maxlength="6" autocomplete="off" spellcheck="false" value="' + esc(p.code || '') + '">' +
      '<small>' + esc(t('codeHint')) + '</small>' +
      (errorKey ? '<p class="bench-err" role="alert">' + esc(t(errorKey)) + '</p>' : '') +
      '<div class="bench-actions"><button type="button" class="bench-go">' + esc(t('go')) + '</button>' +
      '<button type="button" class="bench-no">' + esc(t('no')) + '</button></div>' +
      '<p class="bench-fine">' + t('privacy', { href: esc(privacyHref()) }) + '</p>');
    wireClose();
    el.querySelector('.bench-go').onclick = submit;
    el.querySelector('.bench-no').onclick = function () { track('bench_decline', { sim: run.sim }); hide(); };
    el.hidden = false;
  }

  function renderMessage(key) {
    panel().innerHTML = frame('<p>' + esc(t(key)) + '</p><div class="bench-actions"><button type="button" class="bench-close">' + esc(t('close')) + '</button></div>');
    wireClose();
    el.hidden = false;
  }

  function pct(g) { return g.n ? Math.round(100 * (g.below + g.equal / 2) / g.n) : 0; }
  function row(label, g, extra) {
    return '<div class="bench-row"><div class="bench-lbl"><b>' + esc(label) + '</b><span>' +
      esc(g.n === 1 ? t('run') : t('runs', { n: fmt(g.n) })) + (extra ? ' · ' + esc(extra) : '') + '</span></div>' +
      '<div class="bench-bar" role="img" aria-label="' + esc(t('beat', { p: pct(g) })) + '"><i style="width:' + pct(g) + '%"></i></div>' +
      '<div class="bench-pct">' + esc(t('beat', { p: pct(g) })) + '</div></div>';
  }

  function renderResult(r) {
    var all = r.all || { n: 0 }, peers = r.peers || { n: 0 }, cohort = r.cohort;
    var body = '<div class="bench-score"><span>' + esc(t('yourScore')) + '</span><b>' + esc(fmt(run.score)) + '</b></div>';
    var any = false;
    if (cohort && cohort.n >= MIN_CLASS) {
      var rank = cohort.n - cohort.below - cohort.equal + 1;
      body += row(cohort.label ? t('klass') + ' · ' + cohort.label : t('klass'), cohort, t('rank', { r: fmt(rank), n: fmt(cohort.n + 1) }));
      any = true;
    }
    if (all.n >= MIN_RUNS) { body += row(t('everyone'), all, t('median', { m: fmt(all.median) })); any = true; }
    if (peers.n >= MIN_RUNS && peers.n < all.n) {
      body += row(t('peers', { level: L().levels[r.level] || r.level }), peers, t('median', { m: fmt(peers.median) }));
    }
    body += any ? '<p class="bench-fine">' + esc(t('again')) + '</p>' : '<p>' + esc(t('early', { n: fmt(all.n + 1) })) + '</p>';
    body += '<div class="bench-actions"><button type="button" class="bench-close">' + esc(t('close')) + '</button></div>';
    panel().innerHTML = frame(body);
    wireClose();
    el.hidden = false;
  }

  function summaryFor(s) {
    try { var j = JSON.stringify(s); return (j && j.length <= MAX_SUMMARY) ? s : null; } catch (e) { return null; }
  }

  /* A new-style sb_publishable_ key goes in `apikey` only; a legacy anon JWT also as the Bearer token. */
  function authHeaders() {
    var h = { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey };
    if (/^eyJ/.test(C.supabaseAnonKey)) h.Authorization = 'Bearer ' + C.supabaseAnonKey;
    return h;
  }

  function submit() {
    var nick = el.querySelector('#benchNick').value.trim().slice(0, 30);
    var level = el.querySelector('#benchLevel').value;
    var code = el.querySelector('#benchCode').value.trim().toUpperCase();
    savePrefs({ nick: nick, level: level, code: code }); // also keeps what was typed if we re-render with an error
    if (LEVELS.indexOf(level) < 0) { renderAsk('needLevel'); return; }
    var go = el.querySelector('.bench-go');
    go.disabled = true; go.textContent = t('sending');
    track('bench_submit', { sim: run.sim, level: level, cohort: !!code });

    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/submit_run', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        p_sim_id: run.sim, p_lang: run.lang, p_level: level, p_score: run.score, p_periods: run.periods,
        p_nickname: nick || null, p_join_code: code || null, p_summary: summaryFor(run.summary)
      }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (r) {
      clearTimeout(timer);
      if (r && r.error === 'unknown_code') { renderAsk('badCode'); return; }
      if (r && r.error === 'wrong_sim') { renderAsk('wrongSim'); return; }
      if (r && r.error === 'rate_limited') { renderMessage('limited'); return; }
      if (!r || !r.run_id) throw new Error('bad response');
      done = true;
      renderResult(r);
    }).catch(function (e) {
      clearTimeout(timer);
      console.warn('[benchmark] comparison unavailable (game unaffected):', e);
      renderMessage('offline');
    });
  }

  window.EurekaBenchmark = {
    /* run: { sim, lang, level, periods, score, summary } */
    offer: function (r) {
      if (!enabled() || done || !r || typeof r.score !== 'number') return;
      run = r;
      renderAsk();
      track('bench_shown', { sim: r.sim });
    },
    reset: function () { done = false; run = null; hide(); }
  };
})();
