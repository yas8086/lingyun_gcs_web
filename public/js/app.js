'use strict';

/* 应用框架：顶栏 / 导航 / 内容区 / 状态栏 / 路由 / 快捷键 */
(function () {
  const App = window.App;
  App.viewsRegistry = App.viewsRegistry || {};

  const NAV = [
    { name: '监控', icon: 'nav-monitor', key: 'monitor' },
    { name: '自检', icon: 'nav-check', key: 'selfcheck' },
    { name: '飞控', icon: 'nav-flight', key: 'flight' },
    { name: '图示', icon: 'nav-topology', key: 'topo' },
    { name: '设置', icon: 'check-gear', key: 'settings' }
  ];

  let refs = {};
  let lastCheckFails = -1;

  function buildShell() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // ---- 顶栏 ----
    const top = document.createElement('div');
    top.className = 'topbar';
    top.innerHTML = `
      <div class="brand">
        <div class="brand-title">BT600 飞艇地面站</div>
        <div class="brand-sub" id="brandSub">电源系统监控 · 链路未连接</div>
      </div>
      <div class="topbar-spacer"></div>
      <div class="dev-lamps" id="devLamps"></div>
      <button class="btn ghost" id="btnDense">字体：大</button>
      <button class="btn ghost" id="btnTheme">深色</button>`;

    // ---- 导航 + 主区 ----
    const row = document.createElement('div');
    row.className = 'row-layout';
    const nav = document.createElement('nav');
    nav.className = 'nav';
    NAV.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'nav-item' + (i === 0 ? ' active' : '');
      btn.dataset.nav = String(i);
      btn.innerHTML = '<span class="nav-icon" style="-webkit-mask-image:url(img/' + item.icon + '.svg);mask-image:url(img/' + item.icon + '.svg)"></span><span>' + item.name + '</span>';
      btn.addEventListener('click', () => App.navigate(i));
      nav.appendChild(btn);
    });

    const main = document.createElement('div');
    main.className = 'main-col';
    const content = document.createElement('div');
    content.className = 'content';
    content.id = 'view-content';
    const status = document.createElement('div');
    status.className = 'statusbar';
    status.innerHTML = `
      <span class="sb-item" id="sbLink"><span class="sb-dot"></span><span id="sbLinkText">链路断开</span></span>
      <span class="sb-item" id="sbRate">数据率 -- Hz</span>
      <span class="sb-item" id="sbAlarm">告警 0</span>
      <span class="sb-item" id="sbUptime" title="从后端服务启动开始计时">运行时长 00:00:00</span>
      <span class="sb-msg" id="sbMsg">系统就绪</span>
      <span class="sb-item"><span>本地时间</span><span class="sb-time" id="sbClock">--:--:--</span></span>`;
    main.appendChild(content);
    main.appendChild(status);
    row.appendChild(nav);
    row.appendChild(main);
    app.appendChild(top);
    app.appendChild(row);

    refs = {
      brandSub: document.getElementById('brandSub'),
      devLamps: document.getElementById('devLamps'),
      btnDense: document.getElementById('btnDense'),
      btnTheme: document.getElementById('btnTheme'),
      nav,
      content,
      sbLink: document.getElementById('sbLink'),
      sbLinkText: document.getElementById('sbLinkText'),
      sbRate: document.getElementById('sbRate'),
      sbAlarm: document.getElementById('sbAlarm'),
      sbUptime: document.getElementById('sbUptime'),
      sbMsg: document.getElementById('sbMsg'),
      sbClock: document.getElementById('sbClock')
    };
    App.refs = refs;

    buildLamps();

    refs.btnDense.addEventListener('click', () => {
      App.state.theme.dense = !App.state.theme.dense;
      App.applyTheme();
      App.saveSettings();
      App.updateTopStatus();
    });
    refs.btnTheme.addEventListener('click', () => {
      App.state.theme.dark = !App.state.theme.dark;
      App.applyTheme();
      App.saveSettings();
      App.updateTopStatus();
    });

    refs.btnTheme.textContent = App.state.theme.dark ? '浅色' : '深色';
    refs.btnDense.textContent = App.state.theme.dense ? '字体：小' : '字体：大';

    refs.brandSub.addEventListener('click', (e) => {
      e.stopPropagation();
      if (App.state.activeLamp === 'status') {
        App.hideLampPopover();
        App.updateTopStatus();
      } else {
        App.showStatusPopover(refs.brandSub);
        App.updateTopStatus();
      }
    });
  }

  function buildLamps() {
    const list = [['bms', 'BMS'], ['mppt1', '主 MPPT'], ['mppt2', '副 MPPT'], ['dcdc', 'DCDC'], ['backup', '备用电源']];
    refs.devLamps.innerHTML = '';
    for (const [key, name] of list) {
      const b = document.createElement('button');
      b.className = 'lamp';
      b.dataset.dev = key;
      b.innerHTML = '<span class="dot"></span><span>' + name + '</span>';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (App.state.activeLamp === key) {
          App.hideLampPopover();
          App.updateTopStatus();
        } else {
          App.showLampPopover(b, key);
          App.updateTopStatus();
        }
      });
      refs.devLamps.appendChild(b);
    }
  }

  App.updateTopStatus = function () {
    if (!refs.devLamps) return;
    const st = App.state.status || {};
    for (const lamp of refs.devLamps.querySelectorAll('.lamp')) {
      const key = lamp.dataset.dev;
      const on = !!(st.devices && st.devices[key]);
      lamp.classList.toggle('on', on);
      lamp.classList.toggle('off', !on);
      lamp.classList.toggle('active', App.state.activeLamp === key);
    }
    const online = !!st.linkOnline;
    const sourceText = st.source === 'mqtt' ? 'MQTT' : st.source === 'unconfigured' ? '未配置' : '模拟源';
    let sub = '电源系统监控 · 数据链路 ' + (online ? sourceText : '未连接');
    if (st.source === 'mqtt' && st.mqttConnected === false) sub = '电源系统监控 · MQTT 重连中';
    if (st.source === 'unconfigured') sub = '电源系统监控 · MQTT 未配置（打开 /setup）';
    refs.brandSub.textContent = sub;
    refs.brandSub.classList.toggle('active', App.state.activeLamp === 'status');
    if (refs.btnTheme) refs.btnTheme.textContent = App.state.theme.dark ? '浅色' : '深色';
    if (refs.btnDense) refs.btnDense.textContent = App.state.theme.dense ? '字体：小' : '字体：大';
  };

  App.applyStatusWidgets = function () {
    const map = {
      link: '#sbLink', rate: '#sbRate', alarm: '#sbAlarm', uptime: '#sbUptime'
    };
    for (const [k, sel] of Object.entries(map)) {
      const el = document.querySelector(sel);
      if (el) el.style.display = App.state.statusWidgets.indexOf(k) >= 0 ? '' : 'none';
    }
  };

  App.updateStatusBar = function () {
    if (!refs.sbLink) return;
    App.applyStatusWidgets();
    const st = App.state.status || {};
    const online = !!st.linkOnline;
    refs.sbLink.querySelector('.sb-dot').className = 'sb-dot' + (online ? ' on' : '');
    refs.sbLinkText.textContent = online ? '链路正常' : '链路断开';
    refs.sbLinkText.style.color = online ? 'var(--ok)' : 'var(--err)';
    refs.sbRate.textContent = '数据率 ' + App.fmt(st.dataRate, 1) + ' Hz';
    refs.sbAlarm.textContent = '告警 ' + (st.alarmsUnconfirmed || 0);
    refs.sbAlarm.style.color = (st.alarmsUnconfirmed || 0) > 0 ? 'var(--err)' : 'var(--ok)';
    refs.sbUptime.textContent = '运行时长 ' + App.fmtUptime(st.uptimeSec || 0);
    refs.sbMsg.textContent = App.state.lastMsg || '';
    refs.sbClock.textContent = App.fmtClock();
  };

  App.navigate = function (index) {
    const idx = Math.max(0, Math.min(NAV.length - 1, Number(index) || 0));
    const old = App.state.activeView;
    if (old && typeof old.destroy === 'function') {
      try { old.destroy(); } catch (e) { /* ignore */ }
    }
    App.state.activeView = null;
    App.state.nav = idx;
    refs.nav.querySelectorAll('.nav-item').forEach((b, i) => b.classList.toggle('active', i === idx));
    refs.content.innerHTML = '';
    const view = App.viewsRegistry[NAV[idx].key];
    if (!view) {
      refs.content.innerHTML = '<div class="card pad">页面未实现</div>';
      return;
    }
    try {
      App.state.activeView = view.render(refs.content);
    } catch (e) {
      console.error(e);
      refs.content.innerHTML = '<div class="card pad">页面渲染失败：' + App.esc(e.message) + '</div>';
    }
    App.refreshUI();
  };

  App.themeChanged = function () {
    App.applyTheme();
    App.updateTopStatus();
    const v = App.state.activeView;
    if (v && typeof v.update === 'function') v.update();
  };

  // ===== 自检全局节拍（10s 重跑，与桌面端一致） =====
  function startCheckTicker() {
    const run = () => {
      if (!App.CheckEngine) return;
      App.CheckEngine.runAll();
      const fails = App.CheckEngine.failCount;
      if (fails !== lastCheckFails) {
        App.addLog('info', fails === 0 ? '整机自检：全部通过' : '整机自检：' + fails + ' 项未通过', '自检');
        lastCheckFails = fails;
      }
      const v = App.state.activeView;
      if (v && v.key === 'selfcheck') App.refreshUI();
    };
    setTimeout(run, 600);
    setInterval(run, 10000);
  }

  // ===== 快捷键 =====
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.key >= '1' && e.key <= '5') {
        App.navigate(Number(e.key) - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('gcs-toggle-curve'));
      } else if (e.key === 't' || e.key === 'T') {
        App.state.theme.dark = !App.state.theme.dark;
        App.themeChanged();
        App.saveSettings();
      } else if (e.key === 'd' || e.key === 'D') {
        App.state.theme.dense = !App.state.theme.dense;
        App.themeChanged();
        App.saveSettings();
      }
    });
  }

  function clock() {
    if (refs.sbClock) {
      refs.sbClock.textContent = App.fmtClock();
      refs.sbUptime.textContent = '运行时长 ' + App.fmtUptime((App.state.status || {}).uptimeSec || 0);
    }
  }

  App.init = function () {
    App.loadSettings();
    App.applyTheme();
    buildShell();
    bindShortcuts();
    if (App.CheckEngine) App.CheckEngine.init();
    startCheckTicker();
    App.connectStream();
    App.navigate(0);
    App.updateStatusBar();
    clock();
    setInterval(clock, 1000);
    document.addEventListener('gcs-state', () => {
      App.updateTopStatus();
      App.updateStatusBar();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})();
