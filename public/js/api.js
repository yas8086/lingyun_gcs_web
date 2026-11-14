'use strict';

/* 后端接口与 SSE 数据流 */
(function () {
  const App = window.App;
  let es = null;
  let retryTimer = null;
  let uiPending = false;
  let lastCurveAt = 0;
  let lastTrackAt = 0;

  App.api = {
    get(url) {
      return fetch(url, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    },
    post(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(async (r) => {
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, data };
      });
    }
  };

  App.refreshUI = function () {
    App.updateStatusBar();
    App.updateTopStatus();
    const view = App.state.activeView;
    if (view && typeof view.update === 'function') view.update();
  };

  App.pushCurvePoint = function () {
    if (!App.state.rtcPlaying) return;
    const now = Date.now();
    if (now - lastCurveAt < 480) return;
    lastCurveAt = now;
    const frame = App.state.telemetry || {};
    const pick = (dev, key) => {
      const d = frame[dev];
      return d && typeof d[key] === 'number' && Number.isFinite(d[key]) ? d[key] : null;
    };
    App.state.curve.push({
      t: now,
      v: pick('bms', 'pack_v'),
      pv: pick('mppt1', 'pv_p'),
      outp: pick('dcdc', 'out_p'),
      i: pick('bms', 'pack_i')
    });
    if (App.state.curve.length > 600) App.state.curve.splice(0, App.state.curve.length - 600);
  };

  App.updateMapFromFrame = function () {
    const now = Date.now();
    if (now - lastTrackAt < 1000) return;
    lastTrackAt = now;
    const map = App.state.map;
    const fc = (App.state.telemetry || {}).fc || {};
    const hasReal = typeof fc.lon === 'number' && typeof fc.lat === 'number'
      && Number.isFinite(fc.lon) && Number.isFinite(fc.lat);
    if (hasReal) {
      map.hasRealPos = true;
      map.track.push({ lon: fc.lon, lat: fc.lat });
      if (map.track.length > 500) map.track.shift();
      const dLat = (fc.lat - map.home.lat) * 111320;
      const dLon = (fc.lon - map.home.lon) * 111320 * Math.cos(map.home.lat * Math.PI / 180);
      map.dist = Math.sqrt(dLat * dLat + dLon * dLon);
      map.bearing = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
      if (map.follow) {
        map.centerLon = fc.lon;
        map.centerLat = fc.lat;
      }
    }
  };

  function scheduleUI() {
    if (uiPending) return;
    uiPending = true;
    setTimeout(() => {
      uiPending = false;
      App.refreshUI();
    }, 50);
  }

  App.onFrame = function (frame) {
    App.pushCurvePoint();
    App.updateMapFromFrame();
    scheduleUI();
  };

  App.connectStream = function () {
    if (es) return;
    es = new EventSource('/api/stream');

    es.addEventListener('state', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        App.state.telemetry = data.telemetry || {};
        App.state.status = data.status || {};
        App.state.alarms = data.alarms || [];
        App.state.logs = data.logs || [];
        App.state.curve = data.curve || [];
        App.state.ready = true;
        if (!App.state.logs.length) {
          App.addLog('info', 'Web 地面站已连接后端遥测服务', '系统');
        }
        App.refreshUI();
        document.dispatchEvent(new CustomEvent('gcs-state'));
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('telemetry', (ev) => {
      try {
        App.state.telemetry = JSON.parse(ev.data) || {};
        App.onFrame(App.state.telemetry);
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('status', (ev) => {
      try {
        const prevLink = (App.state.status || {}).linkOnline;
        App.state.status = JSON.parse(ev.data) || {};
        App.updateStatusBar();
        App.updateTopStatus();
        const view = App.state.activeView;
        if (view && typeof view.updateStatus === 'function') view.updateStatus();
        // 链路由在线变为断开时立即重绘当前页，避免无新帧时界面停留在旧值
        if (prevLink !== App.state.status.linkOnline) App.refreshUI();
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        App.state.logs.push(entry);
        if (App.state.logs.length > 500) App.state.logs.shift();
        App.state.lastMsg = entry.msg;
        App.state.logVersion++;
        const view = App.state.activeView;
        if (view && typeof view.updateLogs === 'function') view.updateLogs();
        App.updateStatusBar();
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('alarm', (ev) => {
      try {
        const a = JSON.parse(ev.data);
        App.state.alarms.unshift(a);
        if (App.state.alarms.length > 200) App.state.alarms.length = 200;
        App.toast('⚠ ' + a.content, a.level === '警告' ? 'warn' : 'err');
        App.updateStatusBar();
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('alarms-sync', (ev) => {
      try {
        App.state.alarms = JSON.parse(ev.data) || [];
        App.updateStatusBar();
        const view = App.state.activeView;
        if (view && typeof view.updateLogs === 'function') view.updateLogs();
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('power-result', (ev) => {
      try {
        const r = JSON.parse(ev.data);
        document.dispatchEvent(new CustomEvent('gcs-power-result', { detail: r }));
      } catch (e) { /* ignore */ }
    });

    es.onerror = () => {
      App.state.status = Object.assign({}, App.state.status, { linkOnline: false, safetyFresh: false });
      App.updateStatusBar();
      App.updateTopStatus();
      App.refreshUI();
      if (retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = null; }, 3000);
    };
  };
})();
