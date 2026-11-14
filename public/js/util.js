'use strict';

/* 全局状态、格式化与通用工具 */
(function () {
  const App = window.App = window.App || {};

  App.state = {
    telemetry: {},
    status: {},
    alarms: [],
    logs: [],
    curve: [],
    sources: {},
    sessions: [],
    ready: false,
    nav: 0,
    rtcPlaying: true,
    stripCollapsed: false,
    logFilter: 'all',
    logVersion: 0,
    lastMsg: '系统就绪',
    activeLamp: '',
    map: {
      zoom: 14,
      centerLon: 120.029,
      centerLat: 30.365,
      layer: 0,
      follow: true,
      track: [],
      home: { lon: 120.029, lat: 30.365 },
      hasRealPos: false
    },
    theme: {
      dark: false,
      accent: 'blue',
      dense: false,
      contrast: false
    },
    units: {
      temp: 0,       // 0=℃ 1=℉
      pressure: 0    // 0=kPa 1=Pa 2=bar 3=psi
    },
    hiddenModules: [],
    statusWidgets: ['link', 'rate', 'alarm', 'uptime'],
    activeView: null
  };

  const LS_KEY = 'lingyun_gcs_web_settings_v1';

  App.loadSettings = function () {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        Object.assign(App.state.theme, s.theme || {});
        Object.assign(App.state.units, s.units || {});
        if (Array.isArray(s.hiddenModules)) App.state.hiddenModules = s.hiddenModules;
        if (Array.isArray(s.statusWidgets)) App.state.statusWidgets = s.statusWidgets;
      }
    } catch (e) { /* ignore */ }
  };

  App.saveSettings = function () {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        theme: App.state.theme,
        units: App.state.units,
        hiddenModules: App.state.hiddenModules,
        statusWidgets: App.state.statusWidgets
      }));
    } catch (e) { /* ignore */ }
  };

  App.applyTheme = function () {
    const t = App.state.theme;
    document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
    document.documentElement.dataset.accent = t.accent;
    document.documentElement.dataset.dense = t.dense ? '1' : '0';
    document.documentElement.dataset.contrast = t.contrast ? '1' : '0';
  };

  App.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  App.h = function (tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children !== undefined && children !== null) {
      if (Array.isArray(children)) {
        for (const c of children) {
          if (c === null || c === undefined || c === false) continue;
          el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
      } else if (typeof children === 'string') {
        el.textContent = children;
      } else {
        el.appendChild(children);
      }
    }
    return el;
  };

  App.$ = function (sel, root) { return (root || document).querySelector(sel); };
  App.$$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  App.fmt = function (v, dp) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '--';
    const n = Number(v);
    if (!Number.isFinite(n)) return '--';
    return dp === undefined ? String(n) : n.toFixed(dp);
  };
  App.fmtInt = function (v) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '--';
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n)) : '--';
  };

  App.tel = function () { return App.state.telemetry || {}; };
  App.dev = function (key) { return (App.state.telemetry || {})[key] || {}; };
  App.val = function (dev, key) {
    const d = App.dev(dev);
    const v = d[key];
    return (typeof v === 'number' && Number.isFinite(v)) ? v : NaN;
  };
  App.online = function (key) {
    const st = App.state.status || {};
    if (key === 'link') return !!st.linkOnline;
    // 链路超过 6 秒无数据：所有设备按离线呈现，避免把最后已知值当作实时值
    if (st.linkOnline === false) return false;
    if (key === 'temp' || key === 'pressure') {
      const d = App.dev(key);
      const nodes = Array.isArray(d.nodes) ? d.nodes : [];
      return nodes.some((n) => n && n.online !== 0 && n.online !== false);
    }
    const d = App.dev(key);
    if (!d || Object.keys(d).length === 0) return false;
    return d.online !== false;
  };
  App.isModuleHidden = function (key) { return App.state.hiddenModules.indexOf(key) >= 0; };

  App.fmtClock = function (d) {
    const t = d || new Date();
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
  };

  App.fmtUptime = function (sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s % 3600 / 60)) + ':' + p(s % 60);
  };

  App.fmtDuration = function (ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const p = (n) => (n < 10 ? '0' + n : String(n));
    const h = Math.floor(s / 3600);
    return (h > 0 ? p(h) + ':' : '') + p(Math.floor(s % 3600 / 60)) + ':' + p(s % 60);
  };

  App.tempUnit = function () { return App.state.units.temp === 1 ? '℉' : '℃'; };
  App.toTemp = function (c) {
    if (c === null || c === undefined || !Number.isFinite(Number(c))) return '--';
    return App.state.units.temp === 1 ? (Number(c) * 9 / 5 + 32).toFixed(1) : Number(c).toFixed(1);
  };
  App.pressureText = function (pa) {
    if (pa === null || pa === undefined || !Number.isFinite(Number(pa))) return '--';
    const v = Number(pa);
    switch (App.state.units.pressure) {
      case 1: return Math.round(v) + ' Pa';
      case 2: return (v / 100000).toFixed(3) + ' bar';
      case 3: return (v / 6894.7573).toFixed(1) + ' psi';
      default: return (v / 1000).toFixed(1) + ' kPa';
    }
  };
  App.pressureUnit = function () {
    return ['kPa', 'Pa', 'bar', 'psi'][App.state.units.pressure] || 'kPa';
  };

  App.icon = function (name, cls) {
    return '<span class="icon ' + (cls || '') + '" style="-webkit-mask-image:url(img/' + name + '.svg);mask-image:url(img/' + name + '.svg)"></span>';
  };

  // ===== Toast =====
  App.toast = function (msg, type) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const el = App.h('div', { class: 'toast ' + (type || 'ok'), text: String(msg) });
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, 3000);
  };

  // ===== 日志 =====
  App.addLog = function (type, msg, source) {
    const entry = { type, msg: String(msg), time: App.fmtClock(), source: source || '' };
    App.state.logs.push(entry);
    if (App.state.logs.length > 500) App.state.logs.shift();
    App.state.lastMsg = String(msg);
    App.state.logVersion++;
  };

  App.addAlarm = function (level, msg, source) {
    // 后端生成的告警会经 SSE 送达；此处仅用于前端本地操作提示（不重复造告警）
    App.addLog('alarm', '[' + level + '] ' + msg, source || '操作');
  };

  App.alarmState = function (aid) {
    const a = (App.state.alarms || []).find((x) => x.aid === aid);
    return !!(a && a.state !== '未确认');
  };

  App.filteredLogs = function () {
    const src = App.state.logs || [];
    const arr = App.state.logFilter === 'alarm' ? src.filter((x) => x.type === 'alarm') : src;
    return arr.slice().reverse();
  };

  App.logColor = function (type) {
    return type === 'ok' ? 'var(--ok)'
      : type === 'warn' ? 'var(--warn)'
      : type === 'err' ? 'var(--err)'
      : type === 'alarm' ? 'var(--err)' : 'var(--primary)';
  };

  App.logTag = function (e) {
    return e.type === 'alarm' ? '[' + (e.lv || '告警') + ']' : '[' + String(e.type || 'info').toUpperCase() + ']';
  };

  // ===== 弹窗 =====
  App.modal = function (opts) {
    const root = document.getElementById('modal-root');
    const mask = App.h('div', { class: 'modal-mask' });
    const card = App.h('div', { class: 'modal-card ' + (opts.cardClass || '') });
    const head = App.h('div', { class: 'modal-head' }, [
      App.h('div', { class: 'mt', text: opts.title || '' }),
      App.h('button', {
        class: 'modal-close', html: '&times;', onclick: () => close()
      })
    ]);
    const body = App.h('div', { class: 'modal-body' });
    if (opts.body) body.appendChild(opts.body);
    card.appendChild(head);
    card.appendChild(body);
    if (opts.footer) {
      const foot = App.h('div', { class: 'modal-foot' });
      for (const btn of opts.footer) foot.appendChild(btn);
      card.appendChild(foot);
    }
    mask.appendChild(card);
    if (opts.closeOnMask !== false) {
      mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    }
    root.appendChild(mask);
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    function close() {
      document.removeEventListener('keydown', onKey);
      mask.remove();
      if (opts.onClose) opts.onClose();
    }
    if (opts.onOpen) opts.onOpen(card, close);
    return { close, card, body };
  };

  App.button = function (label, cls, onClick) {
    return App.h('button', { class: 'btn ' + (cls || ''), text: label, onclick: onClick });
  };

  App.confirm = function (opts) {
    let m;
    m = App.modal({
      title: opts.title,
      closeOnMask: opts.closeOnMask !== false,
      body: App.h('div', { class: 'col', style: { gap: '8px' } }, [
        App.h('div', { style: { fontSize: 'var(--fs-body)', fontWeight: '600' }, text: opts.message || '' }),
        opts.detail ? App.h('div', { class: 'set-note', text: opts.detail }) : null
      ]),
      footer: [
        App.button('取消', 'ghost', () => m.close()),
        App.button(opts.okText || '确定', opts.danger ? 'danger' : 'primary', () => {
          m.close();
          if (opts.onOk) opts.onOk();
        })
      ]
    });
    return m;
  };
})();
