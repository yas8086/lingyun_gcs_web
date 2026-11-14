'use strict';

/* 飞控页：状态徽章 / 姿态仪 / 电机状态 / 地图轨迹 */
(function () {
  const App = window.App;

  function fcOnline() { return App.online('fc'); }
  function fcMode() {
    const fc = App.dev('fc');
    return fcOnline() && fc.mode ? String(fc.mode) : '—';
  }
  function fcArmed() { return fcOnline() && (App.dev('fc').armed === true || App.dev('fc').armed === 1); }
  function gpsFix() {
    const g = App.dev('fc').gps;
    return g && typeof g.fix === 'number' ? g.fix : NaN;
  }
  function gpsSat() {
    const g = App.dev('fc').gps;
    return g && typeof g.sat === 'number' ? g.sat : NaN;
  }
  function gpsFixed() {
    return fcOnline() && Number.isFinite(gpsFix()) && gpsFix() >= 3
      && Number.isFinite(gpsSat()) && gpsSat() > 0 && gpsSat() < 255;
  }
  function escCount() {
    const e = App.dev('fc').esc;
    return e && typeof e.n === 'number' ? e.n : 0;
  }
  function escRpm(i) {
    const e = App.dev('fc').esc;
    return e && Array.isArray(e.rpm) && Number.isFinite(e.rpm[i]) ? e.rpm[i] : 0;
  }
  function escTemp(i) {
    const e = App.dev('fc').esc;
    return e && Array.isArray(e.tmp) && Number.isFinite(e.tmp[i]) ? e.tmp[i] : 0;
  }

  function render(container) {
    container.innerHTML = `
      <div class="flight">
        <div class="flight-bar">
          <span class="row" style="gap:6px">
            <span class="nav-icon" style="width:18px;height:18px;background-color:var(--text);-webkit-mask-image:url(img/nav-flight.svg);mask-image:url(img/nav-flight.svg)"></span>
            <b style="font-size:15px">飞控</b>
          </span>
          <span class="pill" id="fcOnline"><span class="dot"></span>离线</span>
          <span class="pill" id="fcArmed">已锁定</span>
          <span class="pill" id="fcBatt">--</span>
          <span class="pill" id="fcGps">GPS --</span>
          <div class="grow"></div>
          <span class="pill" id="fcAlarm">告警 0</span>
          <span class="pill primary" id="fcModePill">—</span>
        </div>
        <div class="flight-split">
          <div class="flight-left">
            <div class="card attitude-card">
              <div class="row" style="gap:8px">
                <span class="nav-icon" style="width:14px;height:14px;background-color:var(--text2);-webkit-mask-image:url(img/attitude.svg);mask-image:url(img/attitude.svg)"></span>
                <span style="font-size:12px;font-weight:700;color:var(--text2)">姿态仪表</span>
                <span style="font-size:11px;font-weight:700;color:var(--ok)">正常</span>
              </div>
              <div class="mono" style="font-size:12px;font-weight:600;color:var(--text2)" id="attLbl">俯仰 +0.0° · 横滚 +0.0° · 航向 0.0°</div>
              <canvas id="attCanvas"></canvas>
            </div>
            <div class="card motor-card">
              <div class="motor-head" id="motorHead">
                <span class="nav-icon" style="width:16px;height:16px;background-color:var(--text2);-webkit-mask-image:url(img/propeller.svg);mask-image:url(img/propeller.svg)"></span>
                <span style="font-size:12px;font-weight:700;color:var(--text2)">电机状态</span>
                <span style="font-size:10px;color:var(--text2)" id="motorMeta">10 台 · 无遥测 · 模拟值</span>
                <div class="grow"></div>
                <span style="color:var(--text2);font-size:12px" id="motorFold">▾</span>
              </div>
              <div id="motorList"></div>
            </div>
          </div>
          <div class="card flight-map" id="mapWrap">
            <div class="map-info-card">
              <div style="color:var(--text);font-size:12px;font-weight:700">● 飞艇遥测</div>
              <div class="mi-row"><span class="mi-k">高度</span><span class="mi-v" id="miAlt">--</span></div>
              <div class="mi-row"><span class="mi-k">地速</span><span class="mi-v" id="miGs">--</span></div>
              <div class="mi-row"><span class="mi-k">东向速度</span><span class="mi-v" id="miVx">--</span></div>
              <div class="mi-row"><span class="mi-k">北向速度</span><span class="mi-v" id="miVy">--</span></div>
              <div class="mi-row"><span class="mi-k">升降率</span><span class="mi-v" id="miVz">--</span></div>
              <div class="mi-row"><span class="mi-k">航向</span><span class="mi-v" id="miYaw">--</span></div>
              <div class="mi-row"><span class="mi-k">经度</span><span class="mi-v" id="miLon">--</span></div>
              <div class="mi-row"><span class="mi-k">纬度</span><span class="mi-v" id="miLat">--</span></div>
            </div>
            <div class="map-ctrl">
              <div class="row">
                <button class="map-btn" data-layer="0">街道</button>
                <button class="map-btn" data-layer="1">影像</button>
              </div>
              <div class="row">
                <button class="map-btn" id="mapZoomIn">＋</button>
                <button class="map-btn" id="mapZoomOut">－</button>
                <button class="map-btn" id="mapHome">回中</button>
                <button class="map-btn" id="mapFollow">跟随</button>
              </div>
            </div>
            <div class="map-legend"><div class="map-scale"></div><span>100 m</span></div>
          </div>
        </div>
      </div>`;

    const mapWrap = container.querySelector('#mapWrap');
    const attCanvas = container.querySelector('#attCanvas');
    const attitude = new App.AttitudeCanvas(attCanvas);
    const map = new App.MapCanvas(mapWrap, {
      interactive: true,
      mapState: App.state.map,
      getTrack: () => App.state.map.track,
      getPos: () => {
        const fc = App.dev('fc');
        if (typeof fc.lon === 'number' && typeof fc.lat === 'number')
          return { lon: fc.lon, lat: fc.lat, heading: fc.yaw || 0 };
        return { lon: App.state.map.centerLon, lat: App.state.map.centerLat, heading: 0 };
      }
    });

    const layerBtns = container.querySelectorAll('[data-layer]');
    function syncLayer() {
      layerBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.layer) === App.state.map.layer));
      container.querySelector('#mapFollow').classList.toggle('on', !!App.state.map.follow);
    }
    layerBtns.forEach((b) => b.addEventListener('click', () => {
      App.state.map.layer = Number(b.dataset.layer);
      syncLayer();
      map.schedule();
    }));
    container.querySelector('#mapZoomIn').addEventListener('click', () => {
      App.state.map.zoom = Math.min(18, App.state.map.zoom + 1); map.schedule();
    });
    container.querySelector('#mapZoomOut').addEventListener('click', () => {
      App.state.map.zoom = Math.max(3, App.state.map.zoom - 1); map.schedule();
    });
    container.querySelector('#mapHome').addEventListener('click', () => {
      App.state.map.centerLon = App.state.map.home.lon;
      App.state.map.centerLat = App.state.map.home.lat;
      map.schedule();
    });
    container.querySelector('#mapFollow').addEventListener('click', () => {
      App.state.map.follow = !App.state.map.follow;
      syncLayer();
    });
    syncLayer();

    // ===== 电机模拟（无真实 ESC 遥测时） =====
    const motorNames = [
      { n: '推进 · 左前', max: 1000, c: 'var(--primary)' },
      { n: '推进 · 左后', max: 1000, c: 'var(--primary)' },
      { n: '推进 · 右后', max: 1000, c: 'var(--primary)' },
      { n: '推进 · 右前', max: 1000, c: 'var(--primary)' },
      { n: '上升 · 左前', max: 2000, c: 'var(--ok)' },
      { n: '上升 · 左后', max: 2000, c: 'var(--ok)' },
      { n: '上升 · 右后', max: 2000, c: 'var(--ok)' },
      { n: '上升 · 右前', max: 2000, c: 'var(--ok)' },
      { n: '前下降', max: 2000, c: 'var(--ok)' },
      { n: '后下降', max: 2000, c: 'var(--ok)' }
    ];
    const simRpm = [380, 362, 375, 388, 1240, 1205, 1218, 1255, 1102, 1160];
    const simPhase = motorNames.map(() => Math.random() * 6.28);
    let motorOpen = true;
    let motorTick = 0;

    function groups() {
      return [
        { title: '推进电机', from: 0, to: 4 },
        { title: '上升电机', from: 4, to: 8 },
        { title: '下降电机', from: 8, to: 10 }
      ];
    }

    function motorListHTML() {
      let html = '';
      for (const g of groups()) {
        html += '<div class="motor-group-title">' + g.title + '</div>';
        for (let i = g.from; i < g.to; i++) {
          html += '<div class="motor-row" data-motor="' + i + '">'
            + '<span class="motor-name">' + motorNames[i].n + '</span>'
            + '<span class="motor-bar"><i style="width:0%;background:' + motorNames[i].c + '"></i></span>'
            + '<span class="motor-val">-- rpm   --°C</span></div>';
        }
      }
      return html;
    }
    const motorList = container.querySelector('#motorList');
    motorList.innerHTML = motorListHTML();

    container.querySelector('#motorHead').addEventListener('click', () => {
      motorOpen = !motorOpen;
      motorList.style.display = motorOpen ? '' : 'none';
      container.querySelector('#motorFold').textContent = motorOpen ? '▾' : '▸';
    });

    function updateMotors() {
      const real = fcOnline() && escCount() > 0;
      container.querySelector('#motorMeta').textContent = real ? '10 台 · 遥测中' : '10 台 · 无遥测 · 模拟值';
      container.querySelector('#motorMeta').style.color = real ? 'var(--ok)' : 'var(--text2)';
      for (let i = 0; i < 10; i++) {
        const row = motorList.querySelector('[data-motor="' + i + '"]');
        if (!row) continue;
        const rpm = real && escRpm(i) > 0 ? escRpm(i) : simRpm[i];
        const temp = real && escRpm(i) > 0 ? escTemp(i) : 40 + i * 2.4 + Math.round(simRpm[i] / 100);
        const pct = Math.max(1, Math.min(100, rpm / motorNames[i].max * 100));
        row.querySelector('.motor-bar > i').style.width = pct.toFixed(1) + '%';
        const val = row.querySelector('.motor-val');
        val.textContent = Math.round(rpm) + ' rpm   ' + Math.round(temp) + '°C';
        val.style.color = real && temp > 65 ? 'var(--warn)' : 'var(--text)';
      }
    }

    function updateHead() {
      const online = fcOnline();
      const armed = fcArmed();
      const pct = Math.round(App.val('fc', 'batt_pct'));
      const battV = App.val('fc', 'batt_v');
      const pillOnline = container.querySelector('#fcOnline');
      pillOnline.className = 'pill ' + (online ? 'ok' : '');
      pillOnline.innerHTML = '<span class="dot"></span>' + (online ? '在线' : '离线');
      const pillArmed = container.querySelector('#fcArmed');
      pillArmed.className = 'pill ' + (armed ? 'ok' : '');
      pillArmed.textContent = armed ? '已解锁' : '已锁定';
      container.querySelector('#fcBatt').textContent = (online && pct > 0) ? pct + '%  ' + App.fmt(battV, 1) + ' V' : '--';
      container.querySelector('#fcGps').textContent = 'GPS ' + (gpsFixed() ? gpsSat() + ' 颗' : (online ? '未定位' : '--'));
      const hot = online && escCount() > 0 && Array.from({ length: 10 }, (_, i) => escTemp(i)).some((t) => t > 65);
      const alarmPill = container.querySelector('#fcAlarm');
      alarmPill.className = 'pill ' + (hot ? 'warn' : 'ok');
      alarmPill.textContent = '告警 ' + (hot ? 1 : 0);
      container.querySelector('#fcModePill').textContent = fcMode();

      const attLbl = container.querySelector('#attLbl');
      const fmt1 = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1);
      const roll = online ? (App.val('fc', 'roll') || 0) : 0;
      const pitch = online ? (App.val('fc', 'pitch') || 0) : 0;
      const yaw = online ? (App.val('fc', 'yaw') || 0) : 0;
      attLbl.textContent = '俯仰 ' + fmt1(pitch) + '° · 横滚 ' + fmt1(roll) + '° · 航向 ' + Number(yaw).toFixed(1) + '°';
    }

    function updateMapInfo() {
      const online = fcOnline();
      const set = (id, v) => {
        const el = container.querySelector('#' + id);
        if (el) el.textContent = v;
      };
      set('miAlt', online ? App.fmt(App.val('fc', 'alt'), 1) + ' m' : '--');
      const vx = App.val('fc', 'vx'), vy = App.val('fc', 'vy');
      const gs = Number.isFinite(vx) && Number.isFinite(vy) ? Math.sqrt(vx * vx + vy * vy) : NaN;
      set('miGs', online ? App.fmt(gs, 1) + ' m/s' : '--');
      const signed = (v) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + Number(v).toFixed(1) + ' m/s' : '--';
      set('miVx', online ? signed(vx) : '--');
      set('miVy', online ? signed(vy) : '--');
      set('miVz', online ? signed(App.val('fc', 'vz')) : '--');
      set('miYaw', online ? App.fmt(App.val('fc', 'yaw'), 1) + '°' : '--');
      set('miLon', online ? App.fmt(App.val('fc', 'lon'), 6) + '°' : '--');
      set('miLat', online ? App.fmt(App.val('fc', 'lat'), 6) + '°' : '--');
    }

    function tick() {
      updateHead();
      updateMotors();
      updateMapInfo();
      attitude.draw();
      map.schedule();
    }

    const motorTimer = setInterval(() => {
      motorTick++;
      for (let i = 0; i < 10; i++) {
        simPhase[i] += 0.15;
        const base = [380, 362, 375, 388, 1240, 1205, 1218, 1255, 1102, 1160][i];
        const tgt = base + Math.sin(simPhase[i]) * 2000 * 0.07;
        simRpm[i] = Math.max(0, simRpm[i] + (tgt - simRpm[i]) * 0.2 + (Math.random() - 0.5) * 20);
      }
      if (motorTick % 2 === 0) updateMotors();
    }, 1000);
    const tickTimer = setInterval(tick, 500);
    tick();

    return {
      key: 'flight',
      update() { tick(); },
      destroy() {
        clearInterval(motorTimer);
        clearInterval(tickTimer);
        attitude.destroy();
        map.destroy();
      }
    };
  }

  App.viewsRegistry = App.viewsRegistry || {};
  App.viewsRegistry.flight = { render };
})();
