/*
 * Anonymous usage analytics (Umami, cookieless). Loaded by the landing page
 * and the player; reads window.EUREKA_CONFIG from config.js.
 *
 * window.eurekaTrack(name, data) is always defined and never throws. It does
 * nothing when analytics is off: no website id, a host that isn't ours, or a
 * visitor who sends Do Not Track / Global Privacy Control. Events fired
 * before Umami's script has loaded are queued and flushed on load.
 *
 * Callers pass only catalog facts (sim id, language, round, score), never
 * free text, file names, or ?src= URLs. Query strings are stripped from page
 * views (data-exclude-search) for the same reason.
 */
(function () {
  'use strict';
  var C = window.EUREKA_CONFIG || {};
  var queue = [];
  var ready = false;

  function devHost() {
    try { return localStorage.getItem('eureka-telemetry-dev') === '1'; } catch (e) { return false; }
  }
  function ourHost() {
    return (C.hosts || []).indexOf(location.hostname) >= 0 || devHost();
  }
  function optedOut() {
    var n = navigator;
    return n.globalPrivacyControl === true || n.doNotTrack === '1' || window.doNotTrack === '1' || n.msDoNotTrack === '1';
  }

  var on = !!(C.umamiWebsiteId && C.umamiScript && ourHost() && !optedOut());

  function send(name, data) {
    try { window.umami.track(name, data || {}); } catch (e) { }
  }

  window.eurekaTrack = function (name, data) {
    if (devHost() && window.console) console.debug('[analytics]', name, data || {});
    if (!on) return;
    if (ready && window.umami) send(name, data);
    else if (queue.length < 50) queue.push([name, data]);
  };
  /* other scripts (the benchmark card) need the same host + opt-out gate */
  window.eurekaTelemetryAllowed = function () { return ourHost(); };

  if (!on) return;
  var s = document.createElement('script');
  s.defer = true;
  s.src = C.umamiScript;
  s.setAttribute('data-website-id', C.umamiWebsiteId);
  s.setAttribute('data-do-not-track', 'true');
  s.setAttribute('data-exclude-search', 'true');
  s.setAttribute('data-exclude-hash', 'true');
  /* always: in dev mode the script loads, but Umami itself refuses to send from a host not listed */
  s.setAttribute('data-domains', (C.hosts || []).join(','));
  s.onload = function () {
    ready = true;
    while (queue.length) { var q = queue.shift(); send(q[0], q[1]); }
  };
  s.onerror = function () { on = false; queue.length = 0; };
  document.head.appendChild(s);
})();
