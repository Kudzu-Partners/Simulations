/*
 * Generic USF runtime shim — injected into the sandboxed iframe with each
 * simulation. Implements the framework contract that all Express sims code
 * against: USF.SimulationAdapter, USF.SimulationFramework (t/i18n, uiManager
 * bindings, period loop, undo, history table, Chart.js charts, hints,
 * performance summary) plus USF.Utils. Communicates with the host page via
 * postMessage only (the iframe is a sandboxed opaque origin).
 *
 * Fetched as text by player.js and injected verbatim into each sim's iframe
 * srcdoc — it never executes in the host page itself.
 */
(function () {
  'use strict';

  function post(msg) {
    try {
      parent.postMessage(Object.assign({
        usfPlayer: true
      }, msg), '*');
    } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    post({
      type: 'error',
      message: String((e && e.message) || 'Script error')
    });
  });

  function getPath(obj, path) {
    if (obj == null || !path) return undefined;
    return String(path).split('.').reduce(function (o, k) {
      return (o == null ? undefined : o[k]);
    }, obj);
  }

  function deep(o) {
    try {
      return JSON.parse(JSON.stringify(o));
    } catch (e) {
      return o;
    }
  }

  /* ── base adapter: every method has a safe default ── */
  class SimulationAdapter {
    initialize() {}
    setupUI() {}
    validateDecisions() {
      return true;
    }
    calculateResults() {
      return {};
    }
    getTranslations() {
      return {
        en: {}
      };
    }
    getChartConfig() {
      return null;
    }
    getChartData() {
      return null;
    }
    getHistoryTableConfig() {
      return null;
    }
    getPerformanceSummary() {
      return null;
    }
    getHint() {
      return null;
    }
    getPresets() {
      return null;
    }
  }

  var Utils = {
    formatCurrency: function (v, cur) {
      return (cur || '$') + Math.round(+v || 0).toLocaleString();
    },
    formatPercent: function (v) {
      return ((+v || 0) * 100).toFixed(1) + '%';
    },
    formatNumber: function (v, d) {
      return (+v || 0).toLocaleString(undefined, {
        maximumFractionDigits: d == null ? 1 : d
      });
    },
    clamp: function (v, a, b) {
      return Math.min(b, Math.max(a, v));
    },
    debounce: function (fn, ms) {
      var t;
      return function () {
        var a = arguments,
          s = this;
        clearTimeout(t);
        t = setTimeout(function () {
          fn.apply(s, a);
        }, ms);
      };
    }
  };

  class SimulationFramework {
    initialize(adapter, opts) {
      var self = this;
      if (!window.mySimulation) window.mySimulation = this; // some sims keep the instance local but call window.mySimulation.t()
      this.adapter = adapter;
      this.opts = opts || {};
      this.bindings = [];
      this.history = [];
      this.snapshots = [];
      this.charts = {};
      this._busy = false;
      this._finished = false;

      try {
        this.trans = adapter.getTranslations() || {
          en: {}
        };
      } catch (e) {
        this.trans = {
          en: {}
        };
      }
      var langs = Object.keys(this.trans);
      var docLang = (document.documentElement.lang || '').toLowerCase().slice(0, 2);
      this.lang = langs.indexOf(docLang) >= 0 ? docLang : (langs.indexOf('en') >= 0 ? 'en' : (langs[0] || 'en'));
      document.documentElement.lang = this.lang;

      this.uiManager = {
        bind: function (id, path, fmt) {
          self.bindings.push({
            id: id,
            path: path,
            fmt: fmt
          });
        },
        bindDisplay: function (id, path, fmt) {
          self.bindings.push({
            id: id,
            path: path,
            fmt: fmt
          });
        },
        registerStatusCard: function (id, path, fmt) {
          if (typeof path === 'string') self.bindings.push({
            id: id,
            path: path,
            fmt: fmt
          });
        },
        showNotification: function (msg, type) {
          self.toast(msg, type);
        },
        applyTranslations: function () {
          self.applyTranslations();
        },
        refreshTranslations: function () {
          self.applyTranslations();
        },
        translateUI: function () {
          self.applyTranslations();
        }
      };

      this.state = {
        currentPeriod: 1,
        maxPeriods: this.opts.maxPeriods || window.__USF_MAX_PERIODS__ || 5,
        decisions: {},
        domainState: {},
        results: null
      };

      try {
        adapter.initialize(this.state);
      } catch (e) {
        this._err('initialize', e);
      }
      try {
        adapter.setupUI(this.uiManager);
      } catch (e) {
        this._err('setupUI', e);
      }
      this.applyTranslations();
      this.setupCharts();
      this.refresh();
      this.updateCharts();
      this.renderHistory();

      var next = document.getElementById('nextPeriodBtn');
      if (next) next.addEventListener('click', function () {
        self.submitPeriod();
      });
      var undo = document.getElementById('undoBtn');
      if (undo) undo.addEventListener('click', function () {
        self.undo();
      });

      post({
        type: 'ready',
        langs: langs,
        lang: this.lang,
        maxPeriods: this.state.maxPeriods
      });
      post({
        type: 'progress',
        period: Math.min(this.state.currentPeriod, this.state.maxPeriods),
        maxPeriods: this.state.maxPeriods,
        finished: false
      });
    }

    /* ── i18n ── */
    t(key, params) {
      var tbl = this.trans[this.lang] || this.trans.en || {};
      var s = (tbl[key] != null) ? tbl[key] : ((this.trans.en || {})[key] != null ? this.trans.en[key] : key);
      if (params)
        for (var k in params) s = String(s).split('{' + k + '}').join(params[k]);
      return s;
    }
    setLang(lang) {
      if (!this.trans[lang]) return;
      this.lang = lang;
      document.documentElement.lang = lang;
      this.applyTranslations();
      this.refresh();
      this.updateCharts();
      this.renderHistory();
      post({
        type: 'lang',
        lang: lang
      });
    }
    applyTranslations() {
      var self = this;
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        el.innerHTML = self.t(el.getAttribute('data-i18n'));
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
        el.setAttribute('placeholder', self.t(el.getAttribute('data-i18n-placeholder')));
      });
      document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
        el.setAttribute('title', self.t(el.getAttribute('data-i18n-title')));
      });
    }

    /* ── data bindings ── */
    refresh() {
      var self = this;
      this.bindings.forEach(function (b) {
        var el = document.getElementById(b.id);
        if (!el) return;
        var val = getPath(self.state, b.path);
        if (val === undefined) return;
        if (b.id === 'currentDay') val = Math.min(val, self.state.maxPeriods);
        try {
          el.textContent = b.fmt ? b.fmt(val) : val;
        } catch (e) {
          el.textContent = val;
        }
      });
      var cur = document.getElementById('currentDay');
      if (cur && !this.bindings.some(function (b) {
          return b.id === 'currentDay';
        })) {
        cur.textContent = Math.min(this.state.currentPeriod, this.state.maxPeriods);
      }
      var mx = document.getElementById('maxPeriods');
      if (mx && !this.bindings.some(function (b) {
          return b.id === 'maxPeriods';
        })) {
        mx.textContent = this.state.maxPeriods;
      }
      var next = document.getElementById('nextPeriodBtn');
      if (next) {
        var done = this._finished || this.state.currentPeriod > this.state.maxPeriods;
        next.disabled = done;
        next.style.opacity = done ? 0.55 : 1;
      }
      var undo = document.getElementById('undoBtn');
      if (undo) {
        undo.disabled = !this.history.length;
        undo.style.opacity = this.history.length ? 1 : 0.55;
      }
    }

    /* ── charts (Chart.js optional) ── */
    setupCharts() {
      if (typeof Chart === 'undefined') return;
      var cfg = null;
      try {
        cfg = this.adapter.getChartConfig();
      } catch (e) {
        this._err('getChartConfig', e);
      }
      if (!cfg) return;
      for (var id in cfg) {
        var cv = document.getElementById(id);
        if (!cv || !cv.getContext) continue;
        try {
          this.charts[id] = new Chart(cv.getContext('2d'), cfg[id]);
        } catch (e) {
          this._err('chart:' + id, e);
        }
      }
    }
    updateCharts() {
      if (!Object.keys(this.charts).length) return;
      var data = null;
      try {
        data = this.adapter.getChartData(this.state);
      } catch (e) {
        this._err('getChartData', e);
      }
      if (!data) return;
      for (var id in data) {
        var ch = this.charts[id];
        if (!ch || !data[id]) continue;
        if (data[id].labels) ch.data.labels = data[id].labels;
        (data[id].datasets || []).forEach(function (ds, i) {
          if (ch.data.datasets[i]) Object.assign(ch.data.datasets[i], ds);
          else ch.data.datasets.push(ds);
        });
        try {
          ch.update();
        } catch (e) {}
      }
    }

    /* ── history table ── */
    renderHistory() {
      var table = document.getElementById('usfHistoryTable');
      if (!table) return;
      var cols = null;
      try {
        cols = this.adapter.getHistoryTableConfig();
      } catch (e) {
        this._err('getHistoryTableConfig', e);
      }
      if (!cols || !cols.length) return;
      var self = this;
      var head = '<thead><tr>' + cols.map(function (c) {
        return '<th>' + (c.i18nKey ? self.t(c.i18nKey) : (c.label || c.key || '')) + '</th>';
      }).join('') + '</tr></thead>';
      var body = '<tbody>' + this.history.map(function (entry) {
        return '<tr>' + cols.map(function (c) {
          var v = getPath(entry, c.key);
          if (v === undefined) v = getPath(entry.results, c.key);
          if (v === undefined) v = getPath(entry.decisions, c.key);
          if (v === undefined) v = '';
          try {
            return '<td>' + (c.formatter ? c.formatter(v, entry) : v) + '</td>';
          } catch (e) {
            return '<td>' + v + '</td>';
          }
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
      table.innerHTML = head + body;
    }

    /* ── period loop ── */
    submitPeriod() {
      if (this._busy || this._finished || this.state.currentPeriod > this.state.maxPeriods) return;
      this._busy = true;
      try {
        var ok = false;
        try {
          ok = this.adapter.validateDecisions(this.state.decisions);
        } catch (e) {
          this._err('validateDecisions', e);
          ok = false;
        }
        if (!ok) {
          this._busy = false;
          return;
        }

        this.snapshots.push(deep(this.state.domainState));
        var res;
        try {
          res = this.adapter.calculateResults(this.state);
        } catch (e) {
          this._err('calculateResults', e);
          this.snapshots.pop();
          this._busy = false;
          return;
        }
        this.state.results = res;
        this.history.push({
          period: this.state.currentPeriod,
          decisions: deep(this.state.decisions),
          results: res,
          domainState: deep(this.state.domainState)
        });
        this.state.currentPeriod++;

        this.refresh();
        this.updateCharts();
        this.renderHistory();

        var hint = null;
        try {
          hint = this.adapter.getHint(this.state, res);
        } catch (e) {}
        if (hint) post({
          type: 'hint',
          text: String(hint)
        });

        post({
          type: 'progress',
          period: Math.min(this.state.currentPeriod, this.state.maxPeriods),
          maxPeriods: this.state.maxPeriods,
          finished: this.state.currentPeriod > this.state.maxPeriods
        });
        if (this.state.currentPeriod > this.state.maxPeriods) this.finish();
      } finally {
        this._busy = false;
      }
    }

    undo() {
      if (!this.history.length || this._busy) return;
      this.history.pop();
      this.state.domainState = this.snapshots.pop();
      this.state.currentPeriod = Math.max(1, this.state.currentPeriod - 1);
      this.state.results = this.history.length ? this.history[this.history.length - 1].results : null;
      this._finished = false;
      var ov = document.getElementById('usfp-overlay');
      if (ov) ov.remove();
      this.refresh();
      this.updateCharts();
      this.renderHistory();
      post({
        type: 'progress',
        period: Math.min(this.state.currentPeriod, this.state.maxPeriods),
        maxPeriods: this.state.maxPeriods,
        finished: false
      });
    }

    /* ── completion ── */
    finish() {
      this._finished = true;
      var summary = null;
      try {
        summary = this.adapter.getPerformanceSummary(this.history);
      } catch (e) {
        this._err('getPerformanceSummary', e);
      }
      post({
        type: 'finished',
        summary: deep(summary),
        periods: this.history.length
      });
      this.showSummary(summary);
      this.refresh();
    }

    showSummary(summary) {
      var old = document.getElementById('usfp-overlay');
      if (old) old.remove();
      var ov = document.createElement('div');
      ov.id = 'usfp-overlay';
      var inner = '<div class="usfp-card"><div class="usfp-h">🏁 ' + this._esc(this.t('completion_title') !== 'completion_title' ? this.t('completion_title') : 'Simulation complete') + '</div>';
      inner += '<div class="usfp-sub">' + this.history.length + ' / ' + this.state.maxPeriods + '</div>';
      inner += this._renderSummary(summary);
      inner += '<div class="usfp-btns"><button id="usfp-close">✕</button><button id="usfp-again">↺</button></div></div>';
      ov.innerHTML = inner;
      document.body.appendChild(ov);
      document.getElementById('usfp-close').onclick = function () {
        ov.remove();
      };
      document.getElementById('usfp-again').onclick = function () {
        post({
          type: 'restart'
        });
      };
    }
    _renderSummary(v, depth) {
      depth = depth || 0;
      if (v == null || depth > 3) return '';
      var self = this;
      if (Array.isArray(v)) {
        return '<ul class="usfp-ul">' + v.map(function (x) {
          return '<li>' + (typeof x === 'object' ? self._renderSummary(x, depth + 1) : self._esc(self._tt(x))) + '</li>';
        }).join('') + '</ul>';
      }
      if (typeof v === 'object') {
        var rows = '';
        for (var k in v) {
          var val = v[k];
          if (val == null) continue;
          var label = self._esc(self._tt(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, function (c) {
            return c.toUpperCase();
          }));
          if (typeof val === 'object') rows += '<div class="usfp-row"><b>' + label + '</b>' + self._renderSummary(val, depth + 1) + '</div>';
          else rows += '<div class="usfp-row"><b>' + label + '</b><span>' + self._esc(self._tt(val)) + '</span></div>';
        }
        return rows;
      }
      return '<div class="usfp-row"><span>' + self._esc(self._tt(v)) + '</span></div>';
    }
    _tt(x) { // translate values that look like i18n keys
      if (typeof x === 'string' && /^[a-z][a-z0-9_]+$/.test(x)) {
        var t = this.t(x);
        return t;
      }
      return x;
    }
    _esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    /* ── misc ── */
    toast(msg, type) {
      var t = document.createElement('div');
      t.className = 'usfp-toast usfp-' + (type || 'info');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () {
        t.classList.add('usfp-show');
      }, 15);
      setTimeout(function () {
        t.classList.remove('usfp-show');
        setTimeout(function () {
          t.remove();
        }, 350);
      }, 3200);
    }
    _err(where, e) {
      post({
        type: 'error',
        message: where + ': ' + String((e && e.message) || e)
      });
      if (window.console) console.error('[USF]', where, e);
    }
    getSession() {
      return {
        exportedAt: new Date().toISOString(),
        lang: this.lang,
        maxPeriods: this.state.maxPeriods,
        periodsPlayed: this.history.length,
        history: deep(this.history),
        finalState: deep(this.state.domainState),
        summary: (function (self) {
          try {
            return deep(self.adapter.getPerformanceSummary(self.history));
          } catch (e) {
            return null;
          }
        })(this)
      };
    }
  }

  window.USF = {
    SimulationAdapter: SimulationAdapter,
    SimulationFramework: SimulationFramework,
    Utils: Utils
  };
  window.SimulationAdapter = SimulationAdapter; // legacy alias
  window.SimulationFramework = SimulationFramework; // legacy alias

  /* host ↔ iframe protocol */
  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (!d.usfHost || !window.mySimulation) return;
    if (d.type === 'setLang') window.mySimulation.setLang(d.lang);
    if (d.type === 'requestSession') post({
      type: 'session',
      session: window.mySimulation.getSession()
    });
    if (d.type === 'requestHint') {
      var h = null;
      try {
        h = window.mySimulation.adapter.getHint(window.mySimulation.state, window.mySimulation.state.results);
      } catch (e) {}
      post({
        type: 'hint',
        text: h ? String(h) : '',
        empty: !h
      });
    }
  });

  /* overlay + toast styling (self-contained, prefixed) */
  var st = document.createElement('style');
  st.textContent = '#usfp-overlay{position:fixed;inset:0;z-index:99990;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)}' +
    '.usfp-card{background:#fff;color:#0f172a;border-radius:16px;max-width:560px;width:92%;max-height:82vh;overflow-y:auto;padding:26px 30px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:system-ui,sans-serif;position:relative}' +
    '.usfp-h{font-size:20px;font-weight:800;margin-bottom:2px}' +
    '.usfp-sub{font-size:12px;color:#64748b;margin-bottom:14px}' +
    '.usfp-row{display:flex;gap:10px;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px}' +
    '.usfp-row b{color:#334155;font-weight:600;flex:0 1 auto}.usfp-row span{text-align:right}' +
    '.usfp-ul{margin:6px 0;padding-left:20px;font-size:13.5px;line-height:1.55;color:#334155}' +
    '.usfp-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}' +
    '.usfp-btns button{border:none;border-radius:9px;padding:8px 16px;font-size:14px;cursor:pointer;background:#e2e8f0}' +
    '#usfp-again{background:#0ea5e9;color:#fff;font-weight:700}' +
    '.usfp-toast{position:fixed;bottom:16px;left:50%;transform:translate(-50%,20px);opacity:0;transition:all .3s;z-index:99999;background:#0f172a;color:#fff;padding:10px 18px;border-radius:9px;font-size:13px;font-family:system-ui,sans-serif;max-width:80%;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
    '.usfp-show{transform:translate(-50%,0);opacity:1}' +
    '.usfp-success{background:#065f46}.usfp-warning{background:#92400e}.usfp-error{background:#7f1d1d}';
  document.head.appendChild(st);
})();