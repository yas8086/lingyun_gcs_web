'use strict';

/* 监控页：飞艇横幅 / 电源总览 / 设备卡 / 采集节点 / 运行日志 */
(function () {
  const App = window.App;

  const TILE_SPECS = {
    mppt1: [['charge_i', '充电电流', ' A', 1], ['today', '日发电量', ' kWh', 2], ['fault_m', '故障码', '', 0], ['pv_v', '光伏电压', ' V', 1], ['total', '总发电量', ' kWh', 1]],
    mppt2: [['charge_i', '充电电流', ' A', 1], ['today', '日发电量', ' kWh', 2], ['fault_m', '故障码', '', 0], ['pv_v', '光伏电压', ' V', 1], ['total', '总发电量', ' kWh', 1]],
    bms: [['max_t', '最高温度', ' ℃', 1], ['max_v', '最高单体', ' V', 1], ['min_v', '最低单体', ' V', 1], ['diff_v', '单体压差', ' V', 2]],
    backup: [['pack_i', '总电流', ' A', 1], ['soh', '健康度 SOH', ' %', 0], ['max_t', '最高温度', ' ℃', 1], ['diff_v', '单体压差', ' V', 2], ['fault', '故障码', '', 0]],
    dcdc: [['out_i', '输出电流', ' A', 1], ['temp', '散热温度', ' ℃', 1], ['fault_d', '故障码', '', 0], ['in_v', '输入电压', ' V', 1], ['enabled', '输出使能', '', 0]]
  };

  function devBadge(key) { return App.online(key) ? '正常' : '离线'; }

  function tileValue(dev, fid, unit, dp) {
    if (fid === 'fault_m' || fid === 'fault_d') return App.fmtInt(App.val(dev, 'fault'));
    if (dev === 'dcdc' && fid === 'enabled') return App.val('dcdc', 'enabled') === 1 || App.dev('dcdc').enabled === true ? '开启' : '关闭';
    if (dev === 'backup' && (fid === 'fault' || fid === 'soh')) return App.fmtInt(App.val('backup', fid));
    return App.fmt(App.val(dev, fid), dp) + (unit || '');
  }

  function tileHTML(dev, spec) {
    const [fid, label, unit] = spec;
    return '<div class="kv-tile" data-kv="' + dev + ':' + fid + '">'
      + '<div class="k">' + label + '</div>'
      + '<div class="v">--</div></div>';
  }

  function airbagText() {
    if (App.state.status && App.state.status.linkOnline === false) return '<span class="dim">链路断开</span>';
    const nodes = App.pressureNodes();
    if (!nodes.length) return '--';
    const bags = [1, 2, 3, 4];
    const parts = [];
    let any = false;
    for (const id of bags) {
      const n = nodes.find((x) => Number(x.id) === id);
      const off = !n || n.online === 0 || n.online === false;
      if (off) {
        parts.push('<span class="dim">' + App.bagNameOf(id) + ' 离线</span>');
        continue;
      }
      any = true;
      const txt = App.pressureText(n.pressure);
      if (n.stale === true) parts.push('<span class="dim">' + App.bagNameOf(id) + ' ' + App.esc(txt) + '~</span>');
      else parts.push(App.bagNameOf(id) + ' ' + App.esc(txt));
    }
    if (!any) return '<span class="dim">全部离线</span>';
    return parts.join(' · ');
  }

  function stripHTML() {
    return `
    <div class="strip" id="strip">
      <div class="strip-art"><img src="img/airship-blue.svg" alt="飞艇"></div>
      <div class="strip-info">
        <div class="strip-name">BT600 · 载重飞艇</div>
        <div class="strip-params">
          <span id="spLink">链路 <b>断线</b></span>
          <span id="spMode">模式 <b>—</b></span>
          <span id="spArmed">解锁 <b>否</b></span>
          <span id="spAlt">高度 <b>-- m</b></span>
          <span id="spSpd">速度 <b>-- m/s</b></span>
          <span id="spAirbag">空气囊气压 <b>--</b></span>
          <span id="spNodes">采集节点 <b>--</b></span>
        </div>
      </div>
      <div class="strip-actions">
        <button class="ready-pill" id="readyPill">待自检</button>
        <button class="btn-power" id="btnPower">电源控制</button>
        <button class="btn" id="btnCollapse" style="height:43px;padding:0 17px;border-radius:10px;font-size:16px;">▴ 收起</button>
      </div>
    </div>`;
  }

  function deviceCardsHTML() {
    return `
    <div class="device-grid" id="deviceGrid">
      ${mpptCard('mppt1', '主囊 MPPT')}
      ${mpptCard('mppt2', '副囊 MPPT')}
      <div class="card device-card card-hover" data-card="bms" ${App.isModuleHidden('bms') ? 'style="display:none"' : ''}>
        <div class="card-head"><div class="card-title">102S 主电源</div><div class="grow"></div>
          <span class="badge" data-badge="bms">离线</span></div>
        <div class="bms-hero">
          <div class="soc-ring"><canvas id="socRing"></canvas></div>
          <div class="hero-item"><div class="hero-num" id="bmsSoc">--%</div><div class="hero-cap">荷电状态 SOC</div></div>
          <div class="bms-hero-kv">
            <div class="hero-item"><div class="hero-cap">总压</div><div class="hero-big" id="bmsPackV">-- V</div></div>
            <div class="hero-item"><div class="hero-cap">总电流</div><div class="hero-big" id="bmsPackI">-- A</div></div>
          </div>
        </div>
        <div class="kv-grid">${TILE_SPECS.bms.map((s) => tileHTML('bms', s)).join('')}</div>
      </div>
      <div class="card device-card card-hover" data-card="backup" ${App.isModuleHidden('backup') ? 'style="display:none"' : ''}>
        <div class="card-head"><div class="card-title">14S 备用电源</div><div class="grow"></div>
          <span class="badge" data-badge="backup">离线</span></div>
        <div class="hero-row">
          <div class="hero-item"><div class="hero-num" id="bkPackV">-- V</div><div class="hero-cap">电池总压</div></div>
          <div class="hero-item"><div class="hero-num" id="bkSoc">--%</div><div class="hero-cap">荷电状态 SOC</div></div>
        </div>
        <div class="kv-grid">${TILE_SPECS.backup.map((s) => tileHTML('backup', s)).join('')}</div>
      </div>
    </div>`;
  }

  function mpptCard(dev, title) {
    const hidden = App.isModuleHidden(dev === 'mppt1' ? 'mppt_main' : 'mppt_sub');
    return `
    <div class="card device-card card-hover" data-card="${dev}" ${hidden ? 'style="display:none"' : ''}>
      <div class="card-head"><div class="card-title">${title}</div><div class="grow"></div>
        <span class="badge" data-badge="${dev}">离线</span></div>
      <div class="hero-row">
        <div class="hero-item"><div class="hero-num" data-power="${dev}">--W</div><div class="hero-cap">光伏功率</div></div>
        <div class="hero-item"><div class="hero-num" data-hero="${dev}:batt_v">-- V</div><div class="hero-cap">电池电压</div></div>
      </div>
      <div class="kv-grid">${TILE_SPECS[dev].map((s) => tileHTML(dev, s)).join('')}</div>
    </div>`;
  }

  function bottomHTML() {
    return `
    <div class="bottom-grid" id="bottomGrid">
      <div class="card collect-card" id="cardDcdc">
        <div class="card-head"><div class="card-title">DCDC 电源模块</div><div class="grow"></div>
          <span class="badge" data-badge="dcdc">离线</span></div>
        <div class="hero-row">
          <div class="hero-item"><div class="hero-num" id="dcdcOutV">-- V</div><div class="hero-cap">输出电压</div></div>
          <div class="hero-item"><div class="hero-num" data-power="dcdc">--W</div><div class="hero-cap">输出功率</div></div>
        </div>
        <div class="kv-grid">${TILE_SPECS.dcdc.map((s) => tileHTML('dcdc', s)).join('')}</div>
        <div class="grow"></div>
      </div>
      <div class="card collect-card" id="cardPressure">
        <div class="card-head"><div class="card-title">气压采集</div>
          <span class="card-sub" id="presCount">在线 0 / 0</span><div class="grow"></div>
          <span class="badge" data-badge="pressure">离线</span></div>
        <div class="collect-flow" id="pressureFlow"></div>
        <div class="grow"></div>
      </div>
      <div class="card collect-card" id="cardTemp">
        <div class="card-head"><div class="card-title">温度采集</div>
          <span class="card-sub" id="tempCount">在线 0 / 0</span><div class="grow"></div>
          <span class="badge" data-badge="temp">离线</span></div>
        <div class="collect-flow" id="tempFlow"></div>
        <div class="grow"></div>
      </div>
    </div>`;
  }

  function logHTML() {
    return `
    <div class="card log-card" id="logCard">
      <div class="log-head">
        <div class="card-title">运行日志</div>
        <div class="grow"></div>
        <button class="filter-btn active" data-filter="all">全部</button>
        <button class="filter-btn" data-filter="alarm">仅告警</button>
        <button class="btn small ghost" id="btnClearLog">清空</button>
      </div>
      <div class="log-list" id="logList"></div>
    </div>`;
  }

  function render(container) {
    container.innerHTML = '<div class="monitor">' + stripHTML() + deviceCardsHTML() + bottomHTML() + logHTML() + '</div>';
    const root = container.querySelector('.monitor');
    const strip = root.querySelector('#strip');
    const readyPill = root.querySelector('#readyPill');
    const btnCollapse = root.querySelector('#btnCollapse');
    const socCanvas = root.querySelector('#socRing');
    let lastTempSig = '';
    let lastPressureSig = '';
    let lastLogVersion = -1;
    let lastFilter = '';

    strip.classList.toggle('collapsed', !!App.state.stripCollapsed);
    btnCollapse.textContent = App.state.stripCollapsed ? '▾ 展开' : '▴ 收起';

    readyPill.addEventListener('click', () => App.showReadinessPopover(readyPill));
    root.querySelector('#btnPower').addEventListener('click', () => {
      if (App.PowerPanel) App.PowerPanel.open();
    });
    btnCollapse.addEventListener('click', () => {
      App.state.stripCollapsed = !App.state.stripCollapsed;
      strip.classList.toggle('collapsed', App.state.stripCollapsed);
      btnCollapse.textContent = App.state.stripCollapsed ? '▾ 展开' : '▴ 收起';
    });
    root.querySelectorAll('.filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        App.state.logFilter = b.dataset.filter;
        root.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderLogs();
      });
    });
    root.querySelector('#btnClearLog').addEventListener('click', () => {
      App.state.logs = [];
      App.state.logVersion++;
      App.api.post('/api/alarms/confirm', { all: true }).catch(() => {});
      renderLogs();
    });

    function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

    function updateBadges() {
      for (const b of root.querySelectorAll('[data-badge]')) {
        const key = b.dataset.badge;
        if (key === 'pressure' || key === 'temp') {
          const nodes = key === 'pressure' ? App.pressureNodes() : App.tempNodes();
          const linkUp = !(App.state.status && App.state.status.linkOnline === false);
          const on = linkUp && nodes.some((n) => n && n.online !== 0 && n.online !== false);
          b.textContent = nodes.length ? (on ? '正常' : '离线') : '离线';
          b.className = 'badge ' + (on ? 'ok' : '');
          continue;
        }
        const on = App.online(key);
        b.textContent = devBadge(key);
        b.className = 'badge ' + (on ? 'ok' : '');
      }
    }

    function updateTiles() {
      for (const tile of root.querySelectorAll('[data-kv]')) {
        const [dev, fid] = tile.dataset.kv.split(':');
        const specs = TILE_SPECS[dev] || [];
        const spec = specs.find((s) => s[0] === fid);
        if (!spec) continue;
        tile.querySelector('.v').textContent = tileValue(dev, spec[0], spec[2], spec[3]);
      }
      for (const node of root.querySelectorAll('[data-hero]')) {
        const [dev, fid] = node.dataset.hero.split(':');
        const dp = fid === 'batt_v' ? 1 : 1;
        setText(node, App.fmt(App.val(dev, fid), dp) + ' V');
      }
      for (const node of root.querySelectorAll('[data-power]')) {
        const dev = node.dataset.power;
        const v = App.val(dev, 'pv_p');
        const p = dev === 'dcdc' ? App.val('dcdc', 'out_p') : v;
        setText(node, App.fmt(p, 0) + 'W');
      }
    }

    function updateStrip() {
      const st = App.state.status || {};
      const fc = App.dev('fc');
      root.querySelector('#spLink').innerHTML = '链路 <b>' + (st.linkOnline ? '正常' : '断线') + '</b>';
      root.querySelector('#spMode').innerHTML = '模式 <b>' + App.esc(App.online('fc') ? (App.dev('fc').mode || '—') : '—') + '</b>';
      root.querySelector('#spArmed').innerHTML = '解锁 <b>' + (App.online('fc') && (fc.armed === true || fc.armed === 1) ? '是' : '否') + '</b>';
      root.querySelector('#spAlt').innerHTML = '高度 <b>' + App.fmt(App.val('fc', 'alt'), 0) + ' m</b>';
      const vx = App.val('fc', 'vx'), vy = App.val('fc', 'vy');
      const spd = Number.isFinite(vx) && Number.isFinite(vy) ? Math.sqrt(vx * vx + vy * vy) : NaN;
      root.querySelector('#spSpd').innerHTML = '速度 <b>' + App.fmt(spd, 1) + ' m/s</b>';
      root.querySelector('#spAirbag').innerHTML = '空气囊气压 <b>' + airbagText() + '</b>';
      const tn = App.tempNodes(), pn = App.pressureNodes();
      const nodeOn = (n) => n && n.online !== 0 && n.online !== false;
      const linkUp = !(App.state.status && App.state.status.linkOnline === false);
      const total = tn.length + pn.length;
      const on = linkUp ? tn.filter(nodeOn).length + pn.filter(nodeOn).length : 0;
      root.querySelector('#spNodes').innerHTML = '采集节点 <b>' + (total ? on + ' / ' + total : '--') + '</b>';

      const level = App.CheckEngine ? App.CheckEngine.readyLevel() : 0;
      const text = level === 0 ? '待自检' : level === 1 ? '✓ 就绪可飞' : level === 2 ? '⚠ 起飞受限' : '不可起飞';
      setText(readyPill, text);
      readyPill.className = 'ready-pill ' + (level === 1 ? 'ok' : level === 2 ? 'warn' : level === 3 ? 'err' : '');
    }

    function updateBms() {
      const soc = App.val('bms', 'soc');
      if (socCanvas) App.drawSocRing(socCanvas, App.online('bms') ? soc : NaN);
      setText(root.querySelector('#bmsSoc'), (App.online('bms') ? App.fmtInt(soc) : '--') + '%');
      setText(root.querySelector('#bmsPackV'), App.fmt(App.val('bms', 'pack_v'), 1) + ' V');
      setText(root.querySelector('#bmsPackI'), App.fmt(App.val('bms', 'pack_i'), 1) + ' A');
      setText(root.querySelector('#bkPackV'), App.fmt(App.val('backup', 'pack_v'), 1) + ' V');
      setText(root.querySelector('#bkSoc'), (App.online('backup') ? App.fmtInt(App.val('backup', 'soc')) : '--') + '%');
      setText(root.querySelector('#dcdcOutV'), App.fmt(App.val('dcdc', 'out_v'), 1) + ' V');
    }

    function updateNodes(force) {
      const tempNodes = App.tempNodes();
      const presNodes = App.pressureNodes();
      const nodeOn = (n) => n && n.online !== 0 && n.online !== false;
      const linkUp = !(App.state.status && App.state.status.linkOnline === false);
      const tempCount = root.querySelector('#tempCount');
      const presCount = root.querySelector('#presCount');
      if (tempCount) tempCount.textContent = '在线 ' + (linkUp ? tempNodes.filter(nodeOn).length : 0) + ' / ' + tempNodes.length;
      if (presCount) presCount.textContent = '在线 ' + (linkUp ? presNodes.filter(nodeOn).length : 0) + ' / ' + presNodes.length;
      const tempSig = JSON.stringify(tempNodes);
      if (force || tempSig !== lastTempSig) {
        lastTempSig = tempSig;
        root.querySelector('#tempFlow').innerHTML = tempNodes.map(App.tempNodeCard).join('');
      }
      const presSig = JSON.stringify(presNodes);
      if (force || presSig !== lastPressureSig) {
        lastPressureSig = presSig;
        root.querySelector('#pressureFlow').innerHTML = presNodes.map(App.pressureNodeCard).join('');
      }
    }

    function renderLogs() {
      const list = root.querySelector('#logList');
      if (!list) return;
      const entries = App.filteredLogs();
      list.innerHTML = entries.map((e) => {
        const alarm = e.type === 'alarm'
          ? (App.state.alarms || []).find((a) => a.content === e.msg && a.state === '未确认') : null;
        const confirmed = e.type === 'alarm' && !alarm;
        return '<div class="log-row">'
          + '<span class="t">' + App.esc(e.time) + '</span>'
          + '<span class="tag" style="color:' + App.logColor(e.type) + '">' + App.esc(App.logTag(e)) + '</span>'
          + '<span class="src">' + (e.source ? '[' + App.esc(e.source) + ']' : '') + '</span>'
          + '<span class="msg" title="' + App.esc(e.msg) + '">' + App.esc(e.msg) + '</span>'
          + (e.type === 'alarm'
            ? '<button class="confirm' + (confirmed ? ' done' : '') + '" data-aid="' + (alarm ? alarm.aid : '') + '">'
              + (confirmed ? '已确认' : '确认') + '</button>'
            : '')
          + '</div>';
      }).join('');
      for (const b of list.querySelectorAll('.confirm:not(.done)')) {
        b.addEventListener('click', () => {
          const aid = Number(b.dataset.aid);
          if (!aid) return;
          App.api.post('/api/alarms/confirm', { aid }).then((r) => {
            if (r.ok) App.state.alarms = r.data.alarms || App.state.alarms;
            renderLogs();
          });
        });
      }
    }

    const view = {
      key: 'monitor',
      update() {
        updateStrip();
        updateBadges();
        updateTiles();
        updateBms();
        updateNodes(false);
        if (lastLogVersion !== App.state.logVersion || lastFilter !== App.state.logFilter) {
          lastLogVersion = App.state.logVersion;
          lastFilter = App.state.logFilter;
          renderLogs();
        }
      },
      updateLogs() {
        lastLogVersion = App.state.logVersion;
        renderLogs();
      },
      destroy() { /* 无定时器 */ }
    };

    // 首帧
    view.update();
    updateNodes(true);
    renderLogs();
    lastLogVersion = App.state.logVersion;

    // SOC 环随遥测重绘（update 内已重绘，但 canvas 尺寸依赖布局）
    requestAnimationFrame(() => updateBms());
    return view;
  }

  App.viewsRegistry = App.viewsRegistry || {};
  App.viewsRegistry.monitor = { render };
})();
