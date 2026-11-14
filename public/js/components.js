'use strict';

/* 可复用可视化组件：地图 / 姿态仪 / 曲线 / SOC 环 / 节点卡 / 浮层 */
(function () {
  const App = window.App;

  const TILE_SIZE = 256;
  const tileCache = new Map();

  function dpr() { return Math.max(1, Math.min(2, window.devicePixelRatio || 1)); }

  // ================= 地图（Web Mercator） =================
  class MapCanvas {
    constructor(container, options) {
      this.container = container;
      this.options = Object.assign({
        interactive: true,
        mapState: App.state.map,
        getTrack: null,
        getPos: null,
        showHome: true,
        minZoom: 3,
        maxZoom: 18
      }, options || {});
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'map-canvas';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.dragging = false;
      this.lastX = 0;
      this.lastY = 0;
      this.raf = 0;
      this.destroyed = false;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.bind();
      this.resize();
    }

    bind() {
      if (!this.options.interactive) return;
      this.canvas.addEventListener('mousedown', (e) => {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.options.mapState.follow = false;
        this.canvas.style.cursor = 'grabbing';
      });
      window.addEventListener('mousemove', this.onMove = (e) => {
        if (!this.dragging) return;
        const map = this.options.mapState;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        const wx = this.lonToX(map.centerLon) - dx;
        const wy = this.latToY(map.centerLat) - dy;
        map.centerLon = this.xToLon(wx);
        map.centerLat = this.yToLat(wy);
        this.schedule();
      });
      window.addEventListener('mouseup', this.onUp = () => {
        this.dragging = false;
        this.canvas.style.cursor = 'grab';
      });
      this.canvas.style.cursor = 'grab';
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const map = this.options.mapState;
        map.zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, map.zoom + (e.deltaY < 0 ? 1 : -1)));
        this.schedule();
      }, { passive: false });
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      const scale = dpr();
      this.cssW = Math.max(1, Math.floor(rect.width));
      this.cssH = Math.max(1, Math.floor(rect.height));
      this.canvas.width = Math.floor(this.cssW * scale);
      this.canvas.height = Math.floor(this.cssH * scale);
      this.canvas.style.width = this.cssW + 'px';
      this.canvas.style.height = this.cssH + 'px';
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.schedule();
    }

    worldSize() { return TILE_SIZE * Math.pow(2, this.options.mapState.zoom); }
    lonToX(lon) { return (lon + 180) / 360 * this.worldSize(); }
    latToY(lat) {
      const rad = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * this.worldSize();
    }
    xToLon(x) { return x / this.worldSize() * 360 - 180; }
    yToLat(y) {
      const n = Math.PI - 2 * Math.PI * y / this.worldSize();
      return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }
    screenX(wx) { return wx - (this.lonToX(this.options.mapState.centerLon) - this.cssW / 2); }
    screenY(wy) { return wy - (this.latToY(this.options.mapState.centerLat) - this.cssH / 2); }

    tileUrl(z, x, y, layer) {
      if (layer === 1) return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
      return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
    }

    getTile(z, x, y, layer) {
      const key = z + '/' + x + '/' + y + '/' + layer;
      let rec = tileCache.get(key);
      if (rec) return rec;
      rec = { img: new Image(), ok: false, failed: false };
      rec.img.onload = () => { rec.ok = true; this.schedule(); };
      rec.img.onerror = () => { rec.failed = true; };
      rec.img.src = this.tileUrl(z, x, y, layer);
      tileCache.set(key, rec);
      if (tileCache.size > 1200) {
        const first = tileCache.keys().next();
        tileCache.delete(first.value);
      }
      return rec;
    }

    schedule() {
      if (this.raf || this.destroyed) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.draw();
      });
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const W = this.cssW, H = this.cssH;
      const map = this.options.mapState;
      const z = Math.round(map.zoom);
      const dark = document.documentElement.dataset.theme === 'dark';
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = dark ? '#101b2d' : '#dfe7ee';
      ctx.fillRect(0, 0, W, H);

      const TLx = this.lonToX(map.centerLon) - W / 2;
      const TLy = this.latToY(map.centerLat) - H / 2;
      const t0 = Math.floor(TLx / TILE_SIZE);
      const t1 = Math.ceil((TLx + W) / TILE_SIZE);
      const r0 = Math.floor(TLy / TILE_SIZE);
      const r1 = Math.ceil((TLy + H) / TILE_SIZE);
      let anyTile = false;
      for (let tx = t0; tx <= t1; tx++) {
        for (let ty = r0; ty <= r1; ty++) {
          const rec = this.getTile(z, tx, ty, map.layer);
          if (rec.ok) {
            anyTile = true;
            ctx.drawImage(rec.img, tx * TILE_SIZE - TLx, ty * TILE_SIZE - TLy, TILE_SIZE, TILE_SIZE);
          }
        }
      }

      if (!anyTile) {
        // 无外网瓦片时的网格底图（离线兜底）
        ctx.strokeStyle = dark ? 'rgba(90,110,140,.18)' : 'rgba(100,116,139,.18)';
        ctx.lineWidth = 1;
        const step = 64;
        const offX = ((TLx % step) + step) % step;
        const offY = ((TLy % step) + step) % step;
        for (let x = -offX; x < W; x += step) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = -offY; y < H; y += step) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.fillStyle = dark ? 'rgba(138,160,191,.5)' : 'rgba(100,116,139,.55)';
        ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillText('离线底图 · 无外网瓦片', 14, H - 14);
      }

      // 轨迹
      const track = this.options.getTrack ? this.options.getTrack() : (map.track || []);
      if (track && track.length > 1) {
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2563eb';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < track.length; i++) {
          const sx = this.screenX(this.lonToX(track[i].lon));
          const sy = this.screenY(this.latToY(track[i].lat));
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // Home
      if (this.options.showHome && map.home) {
        const hx = this.screenX(this.lonToX(map.home.lon));
        const hy = this.screenY(this.latToY(map.home.lat));
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() || '#16a34a';
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = dark ? '#8aa0bf' : '#64748b';
        ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillText('HOME', hx + 12, hy - 4);
      }

      // 飞艇位置
      const pos = this.options.getPos ? this.options.getPos() : this.currentPos();
      if (pos) {
        const ax = this.screenX(this.lonToX(pos.lon));
        const ay = this.screenY(this.latToY(pos.lat));
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate((pos.heading || 0) * Math.PI / 180);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--err').trim() || '#dc2626';
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(-9, 8); ctx.lineTo(-9, -8);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
    }

    currentPos() {
      const fc = (App.state.telemetry || {}).fc || {};
      if (typeof fc.lon === 'number' && typeof fc.lat === 'number')
        return { lon: fc.lon, lat: fc.lat, heading: fc.yaw || 0 };
      return null;
    }

    destroy() {
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.resizeObserver.disconnect();
      if (this.onMove) window.removeEventListener('mousemove', this.onMove);
      if (this.onUp) window.removeEventListener('mouseup', this.onUp);
      this.canvas.remove();
    }
  }

  // ================= 姿态仪 =================
  class AttitudeCanvas {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement || canvas);
      this.resize();
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const scale = dpr();
      this.W = Math.max(80, Math.floor(rect.width - 24));
      this.H = Math.max(80, Math.floor(rect.height - 48));
      this.canvas.width = Math.floor(this.W * scale);
      this.canvas.height = Math.floor(this.H * scale);
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.draw();
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const W = this.W, H = this.H, cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 10;
      if (R <= 10) return;
      const online = App.online('fc');
      const roll = online ? (App.val('fc', 'roll') || 0) : 0;
      const pitch = online ? (App.val('fc', 'pitch') || 0) : 0;
      const css = getComputedStyle(document.documentElement);
      const line = css.getPropertyValue('--line').trim();
      const text2 = css.getPropertyValue('--text2').trim();
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.clip();
      const rad = roll * Math.PI / 180;
      const pitchScale = R * 0.7;
      const pitchPx = (pitch / 30) * pitchScale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rad);
      ctx.fillStyle = '#3b82c4';
      ctx.fillRect(-W, -H, W * 2, H + pitchPx);
      ctx.fillStyle = '#9a6b3f';
      ctx.fillRect(-W, pitchPx, W * 2, H);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-W, pitchPx); ctx.lineTo(W, pitchPx); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.88)';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.font = '8px monospace';
      for (let a = -30; a <= 30; a += 5) {
        if (a === 0) continue;
        const yy = pitchPx - (a / 30) * pitchScale;
        const major = Math.abs(a) % 10 === 0;
        const halfLen = major ? R * 0.17 : R * 0.09;
        ctx.beginPath(); ctx.moveTo(-halfLen, yy); ctx.lineTo(halfLen, yy); ctx.stroke();
        if (major) {
          const label = String(Math.abs(a));
          ctx.textAlign = 'right'; ctx.fillText(label, -halfLen - 4, yy + 3);
          ctx.textAlign = 'left'; ctx.fillText(label, halfLen + 4, yy + 3);
        }
      }
      ctx.restore();
      ctx.restore();

      ctx.strokeStyle = text2;
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const t = (a - 90) * Math.PI / 180;
        const major = a === 0 || Math.abs(a) === 30 || Math.abs(a) === 60;
        const r0 = R - (major ? 10 : 7), r1 = R - 3;
        ctx.lineWidth = major ? 1.8 : 1.0;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
        ctx.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
        ctx.stroke();
      }
      const pt = (roll - 90) * Math.PI / 180;
      ctx.save();
      ctx.translate(cx + Math.cos(pt) * (R - 4), cy + Math.sin(pt) * (R - 4));
      ctx.rotate(pt + Math.PI / 2);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-4, 8); ctx.lineTo(4, 8); ctx.closePath(); ctx.fill();
      ctx.restore();

      const wing = () => {
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.43, cy);
        ctx.lineTo(cx - R * 0.17, cy);
        ctx.lineTo(cx - R * 0.07, cy + R * 0.10);
        ctx.moveTo(cx + R * 0.43, cy);
        ctx.lineTo(cx + R * 0.17, cy);
        ctx.lineTo(cx + R * 0.07, cy + R * 0.10);
        ctx.moveTo(cx, cy - R * 0.14);
        ctx.lineTo(cx, cy + R * 0.13);
      };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      wing(); ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 5; ctx.stroke();
      wing(); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.8; ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = text2;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('270', 20, cy + 3);
      ctx.fillText('090', W - 20, cy + 3);
    }

    destroy() { this.resizeObserver.disconnect(); }
  }

  // ================= 实时曲线 =================
  const SERIES = [
    { key: 'v', name: 'BMS总压', color: '#2563eb', unit: 'V' },
    { key: 'pv', name: '光伏功率', color: '#16a34a', unit: 'W' },
    { key: 'outp', name: '输出功率', color: '#f59e0b', unit: 'W' },
    { key: 'i', name: '总电流', color: '#06b6d4', unit: 'A' }
  ];

  class CurveChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.windowPoints = 60;
      this.visible = [true, true, true, true];
      this.bandOn = false;
      this.bandVal = 80;
      this.data = [];
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement || canvas);
      this.resize();
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const scale = dpr();
      this.W = Math.max(100, Math.floor(rect.width));
      this.H = Math.max(100, Math.floor(rect.height));
      this.canvas.width = Math.floor(this.W * scale);
      this.canvas.height = Math.floor(this.H * scale);
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.draw();
    }

    setData(data) { this.data = data || []; this.draw(); }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const W = this.W, H = this.H;
      const padL = 44, padR = 10, padT = 10, padB = 22;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const css = getComputedStyle(document.documentElement);
      const line = css.getPropertyValue('--line').trim();
      const text2 = css.getPropertyValue('--text2').trim();
      ctx.clearRect(0, 0, W, H);
      // 网格
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + plotH * i / 4;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const x = padL + plotW * i / 6;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      }

      const data = (this.data || []).slice(-this.windowPoints);
      if (data.length < 2) {
        ctx.fillStyle = text2;
        ctx.font = '12px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        ctx.fillText('等待曲线采样…', padL + plotW / 2, padT + plotH / 2);
        return;
      }

      const labelLines = [];
      SERIES.forEach((s, idx) => {
        if (!this.visible[idx]) return;
        const values = data.map((p) => p[s.key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (!values.length) return;
        let mn = Math.min(...values), mx = Math.max(...values);
        if (mx - mn < 1e-6) { mx += 1; mn -= 1; }
        const pad = (mx - mn) * 0.12;
        mn -= pad; mx += pad;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        data.forEach((p, i) => {
          const v = p[s.key];
          if (typeof v !== 'number' || !Number.isFinite(v)) return;
          const x = padL + plotW * (data.length === 1 ? 0 : i / (data.length - 1));
          const y = padT + plotH - (v - mn) / (mx - mn) * plotH;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // 端点
        const last = data[data.length - 1][s.key];
        if (typeof last === 'number' && Number.isFinite(last)) {
          const x = padL + plotW;
          const y = padT + plotH - (last - mn) / (mx - mn) * plotH;
          ctx.fillStyle = s.color;
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
        labelLines.push({ s, mn, mx, last });
        // 阈值线
        if (this.bandOn) {
          const bv = Number(this.bandVal);
          if (Number.isFinite(bv) && bv >= mn && bv <= mx) {
            const y = padT + plotH - (bv - mn) / (mx - mn) * plotH;
            ctx.strokeStyle = s.color;
            ctx.globalAlpha = 0.55;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }
      });

      // 左侧区间标尺
      ctx.textAlign = 'left';
      ctx.font = '10px monospace';
      let ly = padT + 10;
      for (const item of labelLines) {
        ctx.fillStyle = item.s.color;
        ctx.fillText(item.s.unit + ' ' + item.mn.toFixed(1) + '~' + item.mx.toFixed(1), 4, ly);
        ly += 12;
      }
      // 时间轴
      ctx.fillStyle = text2;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('-' + Math.round(this.windowPoints * 0.5) + 's', padL, H - 6);
      ctx.fillText('now', padL + plotW, H - 6);
      ctx.textAlign = 'left';
      ctx.fillText('采样点 / 时间窗', padL + 4, H - 6);
    }

    destroy() { this.resizeObserver.disconnect(); }
  }

  // ================= SOC 环 =================
  App.drawSocRing = function (canvas, soc) {
    const ctx = canvas.getContext('2d');
    const scale = dpr();
    const w = 68, h = 68;
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const card2 = css.getPropertyValue('--card2').trim();
    const ok = css.getPropertyValue('--ok').trim();
    const warn = css.getPropertyValue('--warn').trim();
    const err = css.getPropertyValue('--err').trim();
    const off = css.getPropertyValue('--off').trim();
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 7;
    const cx = w / 2, cy = h / 2, r = 30;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = card2; ctx.stroke();
    if (Number.isFinite(soc) && soc > 0) {
      const col = soc > 50 ? ok : (soc > 20 ? warn : err);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(100, soc) / 100, false);
      ctx.strokeStyle = col; ctx.stroke();
    } else {
      ctx.strokeStyle = off;
    }
  };

  // ================= 温度 / 压力节点 =================
  App.bagNameOf = function (id) {
    const map = { 1: '左副', 2: '左主', 3: '右主', 4: '右副' };
    return map[id] || '压力';
  };

  App.tempNodes = function () {
    const d = App.dev('temp');
    return Array.isArray(d.nodes) ? d.nodes : [];
  };
  App.pressureNodes = function () {
    const d = App.dev('pressure');
    return Array.isArray(d.nodes) ? d.nodes : [];
  };

  function offlineOf(n) { return !App.nodeOnline(n); }
  function linkDown() { return App.state.status && App.state.status.linkOnline === false; }

  App.tempNodeCard = function (n) {
    const off = linkDown() || offlineOf(n);
    const stale = !off && App.nodeStale(n);
    const alarm = !off && Number(n.alarm) !== 0;
    const cls = ['node-card'];
    if (off) cls.push('offline');
    else if (alarm) cls.push('alarm');
    const value = off ? '离线'
      : (!n.hasTemp ? '--' : App.toTemp(n.temp) + ' ' + App.tempUnit() + (stale ? ' ~' : ''));
    return '<div class="' + cls.join(' ') + '">'
      + '<div class="nc-top"><span class="dim">#' + App.esc(n.id) + '</span> '
      + '<span style="color:' + (off ? 'var(--off)' : 'var(--primary)') + '">温度</span></div>'
      + '<div class="nc-val">' + App.esc(value) + '</div>'
      + (off ? '' : (alarm && !stale ? '<div class="nc-extra" style="color:var(--err)">' + (Number(n.alarm) > 0 ? '超上限' : '超下限') + '</div>'
        : (stale ? '<div class="nc-extra">陈旧</div>' : '')))
      + '</div>';
  };

  App.pressureNodeCard = function (n) {
    const off = linkDown() || offlineOf(n);
    const stale = !off && App.nodeStale(n);
    const alarm = !off && Number(n.alarm) !== 0;
    const cls = ['node-card'];
    if (off) cls.push('offline');
    else if (alarm) cls.push('alarm');
    const value = off ? '离线' : App.pressureText(n.pressure) + (stale ? ' ~' : '');
    return '<div class="' + cls.join(' ') + '">'
      + '<div class="nc-top"><span class="dim">#' + App.esc(n.id) + '</span> '
      + '<span style="color:' + (off ? 'var(--off)' : 'var(--ok)') + '">' + App.esc(App.bagNameOf(n.id)) + '</span></div>'
      + '<div class="nc-val">' + App.esc(value) + '</div>'
      + (off ? '' : (alarm && !stale ? '<div class="nc-extra" style="color:var(--err)">' + (Number(n.alarm) > 0 ? '超上限' : '超下限') + '</div>'
        : (stale ? '<div class="nc-extra">陈旧</div>' : '')))
      + '</div>';
  };

  // ================= 设备灯浮层 =================
  let lampPopover = null;

  App.hideLampPopover = function () {
    if (lampPopover) { lampPopover.remove(); lampPopover = null; }
    App.state.activeLamp = '';
  };

  App.showLampPopover = function (anchor, dev) {
    App.hideLampPopover();
    const names = { bms: 'BMS', mppt1: '主 MPPT', mppt2: '副 MPPT', dcdc: 'DCDC', backup: '备用电源' };
    const fields = {
      bms: [['pack_v', '总压'], ['pack_i', '电流'], ['max_t', '最高温'], ['max_v', '最高单体'], ['diff_v', '压差']],
      mppt1: [['pv_p', '光伏功率'], ['batt_v', '电池电压'], ['charge_i', '充电电流'], ['today', '日发电量'], ['total', '总发电']],
      mppt2: [['pv_p', '光伏功率'], ['batt_v', '电池电压'], ['charge_i', '充电电流'], ['today', '日发电量'], ['total', '总发电']],
      dcdc: [['out_v', '输出电压'], ['out_i', '输出电流'], ['temp', '散热温度'], ['in_v', '输入电压'], ['enabled', '使能']],
      backup: [['pack_v', '总压'], ['soc', '电量'], ['diff_v', '压差'], ['soh', '健康度'], ['fault', '故障码']]
    };
    const pop = document.createElement('div');
    pop.className = 'popover';
    let html = '<div class="pop-title">' + App.esc(names[dev] || dev) + ' 状态详情</div><div class="pop-kv-grid">';
    for (const f of fields[dev] || []) {
      let v;
      if (f[0] === 'enabled') v = App.val(dev, 'enabled') === 1 || App.dev(dev).enabled === true ? '开启' : '关闭';
      else v = App.fmt(App.val(dev, f[0]), (f[0] === 'charge_i' || f[0] === 'today' || f[0] === 'pack_i') ? 1 : 0);
      html += '<div class="pop-kv"><div class="k">' + App.esc(f[1]) + '</div><div class="v">' + App.esc(v) + '</div></div>';
    }
    html += '</div>';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = rect.left + rect.width / 2 - pw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
    let y = rect.bottom + 10;
    if (y + ph > window.innerHeight - 8) y = rect.top - ph - 10;
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, y) + 'px';
    lampPopover = pop;
    App.state.activeLamp = dev;
    App.updateTopStatus();
  };

  App.showStatusPopover = function (anchor) {
    App.hideLampPopover();
    const st = App.state.status || {};
    const nodes = st.nodes || {};
    const tempN = nodes.temp || { online: 0, total: 0 };
    const presN = nodes.pressure || { online: 0, total: 0 };
    const nodeTotal = tempN.total + presN.total;
    const rows = [
      ['数据源', st.source === 'mqtt' ? 'MQTT（服务端代理）' : st.source === 'unconfigured' ? '未配置（打开 /setup）' : '内置模拟源'],
      ['MQTT 状态', st.mqttConnected ? '已连接' : (st.source === 'unconfigured' ? '未配置' : (st.source === 'mqtt' ? '重连中' : '未启用'))],
      ['数据链路', st.linkOnline ? '正常' : '断开'],
      ['数据率', App.fmt(st.dataRate, 1) + ' Hz'],
      ['在线节点', nodeTotal ? (tempN.online + presN.online) + ' / ' + nodeTotal : '--'],
      ['累计帧数', String(st.frameCount || 0)],
      ['异常帧', String(st.badFrames || 0)],
      ['重复帧', String(st.duplicates || 0)]
    ];
    const pop = document.createElement('div');
    pop.className = 'popover';
    pop.innerHTML = '<div class="pop-title">连接详情</div><div class="pop-list">'
      + rows.map(([k, v]) => '<div class="pop-line"><span class="k">' + App.esc(k) + '</span><span class="v">' + App.esc(v) + '</span></div>').join('')
      + (st.source === 'unconfigured' ? '<div class="pop-line" style="margin-top:8px"><a href="/setup">打开 /setup 配置只读 MQTT 账号</a></div>' : '')
      + '</div>';
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = rect.left;
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
    let y = rect.bottom + 10;
    if (y + ph > window.innerHeight - 8) y = rect.top - ph - 10;
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, y) + 'px';
    lampPopover = pop;
    App.state.activeLamp = 'status';
  };

  App.showReadinessPopover = function (anchor) {
    App.hideLampPopover();
    const items = App.CheckEngine ? App.CheckEngine.state() : [];
    const pop = document.createElement('div');
    pop.className = 'popover';
    pop.style.width = '384px';
    let html = '<div class="pop-title">整机就绪度 · 原因明细</div>';
    if (!items.length) {
      html += '<div class="pop-read-row"><span class="ic err">!</span><span class="nm">尚未执行自检</span></div>';
    } else {
      for (const it of items) {
        html += '<div class="pop-read-row">'
          + '<span class="ic ' + (it.pass ? 'ok' : 'err') + '">' + (it.pass ? '✓' : '✕') + '</span>'
          + '<span class="nm">' + App.esc(it.dev + ' · ' + it.name) + '</span>'
          + '<span class="vl">' + App.esc(it.val) + '</span></div>';
      }
    }
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = rect.left + rect.width / 2 - pw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
    let y = rect.bottom + 10;
    if (y + ph > window.innerHeight - 8) y = rect.top - ph - 10;
    pop.style.left = x + 'px';
    pop.style.top = Math.max(8, y) + 'px';
    lampPopover = pop;
    setTimeout(() => {
      const outside = (e) => {
        if (!pop.contains(e.target)) {
          pop.remove();
          if (lampPopover === pop) lampPopover = null;
          document.removeEventListener('mousedown', outside);
        }
      };
      document.addEventListener('mousedown', outside);
    }, 0);
  };

  document.addEventListener('mousedown', (e) => {
    if (lampPopover && !lampPopover.contains(e.target) && !e.target.closest('.lamp') && !e.target.closest('.ready-pill') && !e.target.closest('#brandSub')) {
      lampPopover.remove();
      lampPopover = null;
      App.state.activeLamp = '';
      App.updateTopStatus();
    }
  });

  App.MapCanvas = MapCanvas;
  App.AttitudeCanvas = AttitudeCanvas;
  App.CurveChart = CurveChart;
  App.curveSeries = SERIES;
})();
