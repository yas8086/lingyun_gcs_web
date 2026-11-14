'use strict';

/* 图示页：能源拓扑 / 温度监测 / 实时曲线 */
(function () {
  const App = window.App;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function dpr() { return Math.max(1, Math.min(2, window.devicePixelRatio || 1)); }

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  }

  // ================= 能源拓扑（与 TopoView.qml 同一套节点/连线/母线坐标） =================
  const TOPO_NODES = [
    { id: 'pv1', x: 150, y: 95, w: 150, h: 90 },
    { id: 'pv2', x: 1050, y: 95, w: 150, h: 90 },
    { id: 'mppt1', x: 375, y: 95, w: 150, h: 90 },
    { id: 'mppt2', x: 825, y: 95, w: 150, h: 90 },
    { id: 'bms', x: 600, y: 95, w: 150, h: 90 },
    { id: 'mot1', x: 86, y: 323, w: 150, h: 90 },
    { id: 'mot2', x: 429, y: 323, w: 150, h: 90 },
    { id: 'mot3', x: 771, y: 323, w: 150, h: 90 },
    { id: 'mot4', x: 1114, y: 323, w: 150, h: 90 },
    { id: 'dcdc', x: 515, y: 498, w: 150, h: 90 },
    { id: 'bk', x: 685, y: 498, w: 150, h: 90 },
    { id: 's1', x: 121, y: 725, w: 140, h: 90 },
    { id: 's2', x: 279, y: 725, w: 140, h: 90 },
    { id: 's3', x: 437, y: 725, w: 140, h: 90 },
    { id: 'load', x: 600, y: 725, w: 150, h: 90 },
    { id: 's4', x: 763, y: 725, w: 140, h: 90 },
    { id: 's5', x: 921, y: 725, w: 140, h: 90 },
    { id: 's6', x: 1079, y: 725, w: 140, h: 90 }
  ];

  const TOPO_LINKS = [
    { id: 'l1a', x1: 225, y1: 95, x2: 300, y2: 95, tx: 263, ty: 90, bi: false },
    { id: 'l1b', x1: 975, y1: 95, x2: 900, y2: 95, tx: 938, ty: 90, bi: false },
    { id: 'l2a', x1: 375, y1: 140, x2: 375, y2: 209, tx: 380, ty: 175, bi: false },
    { id: 'lb1', x1: 600, y1: 140, x2: 600, y2: 209, tx: 605, ty: 175, bi: true },
    { id: 'l2b', x1: 825, y1: 140, x2: 825, y2: 209, tx: 830, ty: 175, bi: false },
    { id: 'l3a', x1: 86, y1: 209, x2: 86, y2: 278, tx: 91, ty: 244, bi: false },
    { id: 'l3b', x1: 429, y1: 209, x2: 429, y2: 278, tx: 434, ty: 244, bi: false },
    { id: 'l3c', x1: 771, y1: 209, x2: 771, y2: 278, tx: 776, ty: 244, bi: false },
    { id: 'l3d', x1: 1114, y1: 209, x2: 1114, y2: 278, tx: 1119, ty: 244, bi: false },
    { id: 'l4', x1: 515, y1: 209, x2: 515, y2: 453, tx: 520, ty: 331, bi: false },
    { id: 'l5', x1: 515, y1: 543, x2: 515, y2: 611, tx: 520, ty: 577, bi: false },
    { id: 'lb2', x1: 685, y1: 543, x2: 685, y2: 611, tx: 690, ty: 577, bi: true },
    { id: 'l6a', x1: 121, y1: 611, x2: 121, y2: 680, tx: 126, ty: 646, bi: false },
    { id: 'l6b', x1: 279, y1: 611, x2: 279, y2: 680, tx: 284, ty: 646, bi: false },
    { id: 'l6c', x1: 437, y1: 611, x2: 437, y2: 680, tx: 442, ty: 646, bi: false },
    { id: 'l7', x1: 600, y1: 611, x2: 600, y2: 680, tx: 605, ty: 646, bi: false },
    { id: 'l6d', x1: 763, y1: 611, x2: 763, y2: 680, tx: 768, ty: 646, bi: false },
    { id: 'l6e', x1: 921, y1: 611, x2: 921, y2: 680, tx: 926, ty: 646, bi: false },
    { id: 'l6f', x1: 1079, y1: 611, x2: 1079, y2: 680, tx: 1084, ty: 646, bi: false }
  ];

  const NODE_TITLES = {
    pv1: '光伏主囊', pv2: '光伏副囊', mppt1: 'MPPT 1', mppt2: 'MPPT 2',
    bms: '102S 主电池组', dcdc: 'DCDC 模块', bk: '14S 备用锂电',
    mot1: '推进电机 · 左前', mot2: '推进电机 · 左后', mot3: '推进电机 · 右后', mot4: '推进电机 · 右前',
    s1: '左前上升电机', s2: '左后上升电机', s3: '前下降电机', s4: '后下降电机', s5: '右后上升电机', s6: '右前上升电机',
    load: '其他载荷'
  };

  class PowerTopology {
    constructor(canvas, tipEl) {
      this.canvas = canvas;
      this.tipEl = tipEl;
      this.ctx = canvas.getContext('2d');
      this.flow = 0;
      this.flowBi = 0;
      this.hoverId = '';
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement || canvas);
      this.bindHover();
      this.resize();
      this.timer = setInterval(() => {
        this.flow += 0.47;
        this.flowBi += 0.22;
        this.draw();
      }, 33);
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const scale = dpr();
      this.W = Math.max(200, Math.floor(rect.width));
      this.H = Math.max(200, Math.floor(rect.height));
      this.canvas.width = Math.floor(this.W * scale);
      this.canvas.height = Math.floor(this.H * scale);
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.draw();
    }

    layout() {
      const W = this.W, H = this.H;
      const m = 10, gap = 5;
      const availH = H - 2 * m - gap;
      const hvH = Math.round(availH / 2);
      const wvH = availH - hvH;
      const offY = m + hvH + gap;
      const sx = (W - 2 * m) / 1180;
      const sy = (H - 2 * m - gap) / 800;
      const sc = Math.max(0.3, Math.min(sx, sy));
      return { m, gap, hvH, wvH, offY, sx, sy, sc };
    }

    mx(bx, L) { return 10 + (bx - 10) * L.sx; }
    my(by, L) {
      if (by <= 408) return 10 + (by - 10) / 398 * L.hvH;
      return L.offY + (by - 413) / 397 * L.wvH;
    }
    cfs(v, L) { return Math.max(8, Math.round(v * L.sc)); }

    data() {
      const off = (dev) => !App.online(dev);
      const off1 = off('mppt1'), off2 = off('mppt2'), offB = off('bms'), offD = off('dcdc'), offK = off('backup');
      const pvM = off1 ? 0 : Math.round(num(App.val('mppt1', 'pv_p')) || 0);
      const pvMv = off1 ? 0 : (num(App.val('mppt1', 'pv_v')) || 0);
      const c1 = off1 ? 0 : (num(App.val('mppt1', 'charge_i')) || 0);
      const pvS = off2 ? 0 : Math.round(num(App.val('mppt2', 'pv_p')) || 0);
      const pvSv = off2 ? 0 : (num(App.val('mppt2', 'pv_v')) || 0);
      const c2 = off2 ? 0 : (num(App.val('mppt2', 'charge_i')) || 0);
      const soc = offB ? 0 : (num(App.val('bms', 'soc')) || 0);
      const packv = offB ? 0 : (num(App.val('bms', 'pack_v')) || 0);
      const packi = offB ? NaN : num(App.val('bms', 'pack_i'));
      const op = offD ? 0 : Math.round(num(App.val('dcdc', 'out_p')) || 0);
      const outv = offD ? 0 : (num(App.val('dcdc', 'out_v')) || 0);
      const temp = offD ? 0 : (num(App.val('dcdc', 'temp')) || 0);
      const mEff = (pvp, bv, ci) => {
        if (!pvp || pvp <= 0 || !Number.isFinite(bv) || !Number.isFinite(ci)) return NaN;
        return Math.round(bv * ci / pvp * 100);
      };
      const eff1 = off1 ? NaN : mEff(num(App.val('mppt1', 'pv_p')), num(App.val('mppt1', 'batt_v')), c1);
      const eff2 = off2 ? NaN : mEff(num(App.val('mppt2', 'pv_p')), num(App.val('mppt2', 'batt_v')), c2);
      const bkSoc = offK ? NaN : num(App.val('backup', 'soc'));
      const bkV = offK ? NaN : num(App.val('backup', 'pack_v'));
      const bkI = offK ? NaN : num(App.val('backup', 'pack_i'));
      const esc = App.dev('fc').esc || {};
      const escN = typeof esc.n === 'number' ? esc.n : 0;
      const fcOn = App.online('fc');
      const mots = [];
      for (let i = 0; i < 4; i++) {
        if (i < escN && fcOn) {
          const ev = Array.isArray(esc.v) ? num(esc.v[i]) : NaN;
          const ec = Array.isArray(esc.i) ? num(esc.i[i]) : NaN;
          const rpm = Array.isArray(esc.rpm) ? num(esc.rpm[i]) : NaN;
          mots.push({ p: (Number.isFinite(ev) && Number.isFinite(ec)) ? Math.round(ev * ec) : NaN, rpm });
        } else {
          mots.push({ p: NaN, rpm: NaN });
        }
      }
      return { pvM, pvMv, pvS, pvSv, c1, c2, soc, packv, packi, op, outv, temp, eff1, eff2, bkSoc, bkV, bkI, mots };
    }

    linkOff(id, d) {
      const dcdcOff = !App.online('dcdc');
      const bmsOff = !App.online('bms');
      const mpptOff = !App.online('mppt1');
      if (dcdcOff && (id === 'l4' || id === 'l5' || /^l6[a-f]$/.test(id) || id === 'l7' || id === 'lb2')) return true;
      if (bmsOff && id === 'lb1') return true;
      if (mpptOff && (id === 'l1a' || id === 'l1b' || id === 'l2a' || id === 'l2b')) return true;
      return false;
    }

    linkVal(id, d) {
      if (id === 'l1a') return d.pvM + ' W';
      if (id === 'l1b') return d.pvS + ' W';
      if (id === 'l2a') return d.c1.toFixed(1) + ' A';
      if (id === 'l2b') return d.c2.toFixed(1) + ' A';
      if (/^l3[a-d]$/.test(id)) {
        const mi = parseInt(id.slice(-1), 10) - 1;
        const m = d.mots[mi];
        if (!m || !Number.isFinite(m.p) || !d.packv) return '--';
        const esc = App.dev('fc').esc || {};
        const ec = Array.isArray(esc.i) ? num(esc.i[mi]) : NaN;
        return Number.isFinite(ec) ? ec.toFixed(1) + ' A' : '--';
      }
      if (id === 'l4') return d.op && d.packv ? (d.op / d.packv).toFixed(1) + ' A' : '--';
      if (id === 'l5') return d.op ? (d.op / 48).toFixed(1) + ' A' : '--';
      if (/^l6[a-f]$/.test(id)) return '--';
      if (id === 'l7') return '--';
      return '';
    }

    nodeOff(id) {
      const dcdcOff = !App.online('dcdc');
      const bmsOff = !App.online('bms');
      const mpptOff = !App.online('mppt1');
      if (dcdcOff && (id === 'dcdc' || /^s\d$/.test(id) || id === 'load')) return true;
      if (!App.online('backup') && id === 'bk') return true;
      if (bmsOff && id === 'bms') return true;
      if (mpptOff && (id === 'mppt1' || id === 'mppt2')) return true;
      return false;
    }

    nodeVal(id, d) {
      switch (id) {
        case 'pv1': return { v: d.pvM + ' W', s: d.pvMv.toFixed(1) + ' V', ic: 'sun' };
        case 'pv2': return { v: d.pvS + ' W', s: d.pvSv.toFixed(1) + ' V', ic: 'sun' };
        case 'mppt1': return { v: d.c1.toFixed(1) + ' A', s: '效率 ' + App.fmt(d.eff1, 0) + '%', ic: 'bolt' };
        case 'mppt2': return { v: d.c2.toFixed(1) + ' A', s: '效率 ' + App.fmt(d.eff2, 0) + '%', ic: 'bolt' };
        case 'bms': return { v: Math.round(d.soc) + '%', s: d.packv.toFixed(1) + ' V', ic: 'bat' };
        case 'dcdc': return { v: d.op + ' W', s: d.temp.toFixed(1) + ' ℃', ic: 'bolt' };
        case 'bk': {
          if (!Number.isFinite(d.bkSoc)) return { v: '--', s: '-- V', ic: 'bat' };
          return { v: Math.round(d.bkSoc) + '%', s: d.bkV.toFixed(1) + ' V', ic: 'bat' };
        }
        case 'mot1': case 'mot2': case 'mot3': case 'mot4': {
          const m = d.mots[parseInt(id.slice(3), 10) - 1] || { p: NaN, rpm: NaN };
          return Number.isFinite(m.rpm)
            ? { v: Math.round(m.rpm) + ' rpm', s: App.fmt(m.p, 0) + ' W', ic: 'motor' }
            : { v: '-- rpm', s: '无遥测', ic: 'motor' };
        }
        case 's1': case 's2': case 's3': case 's4': case 's5': case 's6':
          return { v: '-- rpm', s: '无遥测', ic: 'motor' };
        case 'load': return { v: '-- W', s: '无遥测', ic: 'gear' };
      }
      return { v: '', s: '', ic: '' };
    }

    nodeWarn(id, d) {
      const dcdcOff = !App.online('dcdc');
      if (dcdcOff && (id === 'dcdc' || /^s\d$/.test(id))) return false;
      if (id === 'dcdc') return d.temp > 43;
      if (id === 'bms') return d.soc < 20;
      if (id === 'mppt1') return Number.isFinite(d.eff1) && d.eff1 < 90;
      if (id === 'mppt2') return Number.isFinite(d.eff2) && d.eff2 < 90;
      return false;
    }

    hoverText(id, d) {
      switch (id) {
        case 'pv1': return '光伏主囊\n功率 ' + d.pvM + ' W\n电压 ' + d.pvMv.toFixed(1) + ' V\n向 MPPT 1 供电';
        case 'pv2': return '光伏副囊\n功率 ' + d.pvS + ' W\n电压 ' + d.pvSv.toFixed(1) + ' V\n向 MPPT 2 供电';
        case 'mppt1': return 'MPPT 1\n光伏输入 ' + d.pvM + ' W\n充电电流 ' + d.c1.toFixed(1) + ' A\n转换效率 ' + App.fmt(d.eff1, 0) + '%';
        case 'mppt2': return 'MPPT 2\n光伏输入 ' + d.pvS + ' W\n充电电流 ' + d.c2.toFixed(1) + ' A\n转换效率 ' + App.fmt(d.eff2, 0) + '%';
        case 'bms': return '102S 主电池组\n荷电状态 SOC ' + Math.round(d.soc) + '%\n总压 ' + d.packv.toFixed(1) + ' V\n总电流 ' + App.fmt(d.packi, 1) + ' A';
        case 'mot1': case 'mot2': case 'mot3': case 'mot4': {
          const name = ['左前', '左后', '右后', '右前'][parseInt(id.slice(3), 10) - 1];
          const m = d.mots[parseInt(id.slice(3), 10) - 1] || { p: NaN, rpm: NaN };
          return '推进电机 · ' + name + '\n功率 ' + App.fmt(m.p, 0) + ' W\n转速 ' + App.fmt(m.rpm, 0) + ' rpm' + (Number.isFinite(m.rpm) ? '' : '\n（无电调遥测）');
        }
        case 'dcdc': return 'DCDC 模块\n输出功率 ' + d.op + ' W\n输出电压 ' + d.outv.toFixed(1) + ' V\n散热温度 ' + d.temp.toFixed(1) + ' ℃';
        case 'bk': return '14S 备用锂电\n荷电状态 ' + App.fmt(d.bkSoc, 0) + '%\n电压 ' + App.fmt(d.bkV, 1) + ' V\n与 DCDC 构成 48V 混动';
        case 's1': return '左前上升电机\n遥测暂未接入\n由 48V 母线供电';
        case 's2': return '左后上升电机\n遥测暂未接入\n由 48V 母线供电';
        case 's3': return '前下降电机\n遥测暂未接入\n由 48V 母线供电';
        case 's4': return '后下降电机\n遥测暂未接入\n由 48V 母线供电';
        case 's5': return '右后上升电机\n遥测暂未接入\n由 48V 母线供电';
        case 's6': return '右前上升电机\n遥测暂未接入\n由 48V 母线供电';
        case 'load': return '其他载荷\n遥测暂未接入\n48V 弱电负载';
      }
      return '';
    }

    bindHover() {
      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const mxPos = e.clientX - rect.left;
        const myPos = e.clientY - rect.top;
        const L = this.layout();
        let hit = '';
        for (const n of TOPO_NODES) {
          const x0 = this.mx(n.x - n.w / 2, L);
          const y0 = this.my(n.y - n.h / 2, L);
          const w = n.w * L.sc;
          const h = n.h * L.sc;
          if (mxPos >= x0 && mxPos <= x0 + w && myPos >= y0 && myPos <= y0 + h) { hit = n.id; break; }
        }
        this.hoverId = hit;
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
        if (!this.tipEl) return;
        if (hit) {
          const text = this.hoverText(hit, this.data());
          this.tipEl.textContent = text;
          this.tipEl.classList.remove('hidden');
          const tw = this.tipEl.offsetWidth;
          const th = this.tipEl.offsetHeight;
          let x = mxPos + 14;
          let y = myPos + 14;
          if (x + tw > this.W - 4) x = mxPos - tw - 14;
          if (y + th > this.H - 4) y = myPos - th - 14;
          this.tipEl.style.left = Math.max(4, x) + 'px';
          this.tipEl.style.top = Math.max(4, y) + 'px';
        } else {
          this.tipEl.classList.add('hidden');
        }
      });
      this.canvas.addEventListener('mouseleave', () => {
        this.hoverId = '';
        if (this.tipEl) this.tipEl.classList.add('hidden');
      });
    }

    drawIcon(type, cx, cy, s) {
      const ctx = this.ctx;
      ctx.lineWidth = Math.max(1.2, 1.8 * s);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (type === 'sun') {
        ctx.arc(cx, cy, 5 * s, 0, Math.PI * 2);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          ctx.moveTo(cx + 7 * s * Math.cos(a), cy + 7 * s * Math.sin(a));
          ctx.lineTo(cx + 9 * s * Math.cos(a), cy + 9 * s * Math.sin(a));
        }
      } else if (type === 'bolt') {
        ctx.moveTo(cx + 3 * s, cy - 8 * s);
        ctx.lineTo(cx - 4 * s, cy + 1 * s);
        ctx.lineTo(cx - 1 * s, cy + 1 * s);
        ctx.lineTo(cx - 3 * s, cy + 8 * s);
        ctx.lineTo(cx + 4 * s, cy - 1 * s);
        ctx.lineTo(cx + 1 * s, cy - 1 * s);
      } else if (type === 'bat') {
        ctx.rect(cx - 8 * s, cy - 7 * s, 16 * s, 14 * s);
        ctx.moveTo(cx + 8 * s, cy - 4 * s);
        ctx.lineTo(cx + 10 * s, cy - 4 * s);
        ctx.lineTo(cx + 10 * s, cy + 4 * s);
        ctx.lineTo(cx + 8 * s, cy + 4 * s);
        ctx.moveTo(cx - 4 * s, cy - 4 * s); ctx.lineTo(cx - 4 * s, cy);
        ctx.moveTo(cx, cy - 3 * s); ctx.lineTo(cx, cy + 1 * s);
        ctx.moveTo(cx + 4 * s, cy - 4 * s); ctx.lineTo(cx + 4 * s, cy);
      } else if (type === 'motor') {
        ctx.arc(cx, cy, 7.5 * s, 0, Math.PI * 2);
        ctx.moveTo(cx - 3.5 * s, cy + 3.5 * s);
        ctx.lineTo(cx - 3.5 * s, cy - 3.5 * s);
        ctx.lineTo(cx, cy + 0.5 * s);
        ctx.lineTo(cx + 3.5 * s, cy - 3.5 * s);
        ctx.lineTo(cx + 3.5 * s, cy + 3.5 * s);
      } else if (type === 'gear') {
        ctx.arc(cx, cy, 8 * s, 0, Math.PI * 2);
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          ctx.moveTo(cx + 8 * s * Math.cos(a), cy + 8 * s * Math.sin(a));
          ctx.lineTo(cx + 10 * s * Math.cos(a), cy + 10 * s * Math.sin(a));
        }
      }
      ctx.stroke();
    }

    rrect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const L = this.layout();
      const sc = L.sc;
      const W = this.W, H = this.H;
      const card = cssVar('--card'), card2 = cssVar('--card2'), bg2 = cssVar('--bg2');
      const line = cssVar('--line'), text = cssVar('--text'), text2 = cssVar('--text2');
      const primary = cssVar('--primary'), ok = cssVar('--ok'), warn = cssVar('--warn');
      const err = cssVar('--err'), off = cssVar('--off');
      const font = getComputedStyle(document.body).fontFamily;
      const D = this.data();

      ctx.clearRect(0, 0, W, H);

      // 两域（高压域 / 48V 弱电域）
      ctx.setLineDash([6 * sc, 5 * sc]);
      ctx.lineWidth = 1.5 * sc;
      ctx.fillStyle = card2;
      ctx.strokeStyle = line;
      this.rrect(this.mx(10, L), this.my(10, L), W - 20, L.hvH, 8);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = text2;
      ctx.font = '700 ' + this.cfs(13, L) + 'px ' + font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('高压直流域', this.mx(26, L), this.my(34, L));

      ctx.setLineDash([6 * sc, 5 * sc]);
      ctx.fillStyle = card2;
      this.rrect(this.mx(10, L), L.offY, W - 20, L.wvH, 8);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = text2;
      ctx.fillText('48V 弱电域', this.mx(26, L), this.my(437, L));

      // 母线
      const bus = (y, js, tag, tagX, tagY) => {
        ctx.strokeStyle = primary;
        ctx.lineWidth = Math.max(2, 5 * sc);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.mx(js[0], L), this.my(y, L));
        ctx.lineTo(this.mx(js[js.length - 1], L), this.my(y, L));
        ctx.stroke();
        for (const jx of js) {
          const px = this.mx(jx, L), py = this.my(y, L);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(3, 6 * sc), 0, Math.PI * 2);
          ctx.fillStyle = card;
          ctx.fill();
          ctx.strokeStyle = primary;
          ctx.lineWidth = Math.max(1.5, 3 * sc);
          ctx.stroke();
        }
        ctx.fillStyle = text2;
        ctx.font = '700 ' + this.cfs(12, L) + 'px ' + font;
        ctx.textAlign = 'left';
        ctx.fillText(tag, this.mx(tagX, L), this.my(tagY, L));
      };
      bus(209, [86, 375, 429, 515, 600, 771, 825, 1114],
        '第一级母线 · ' + Math.round(D.packv) + 'V', 110, 201);
      bus(611, [121, 279, 437, 515, 600, 685, 763, 921, 1079],
        '第二级母线 · 48V · DCDC 负载 ' + D.op + 'W', 140, 603);

      // 连线
      const batFlow = (cur) => {
        if (!Number.isFinite(cur)) return '充放 --';
        const a = Math.abs(cur);
        return cur >= 0 ? '充电 ' + a.toFixed(1) + ' A' : '放电 ' + a.toFixed(1) + ' A';
      };
      for (const l of TOPO_LINKS) {
        const offLine = this.linkOff(l.id, D);
        const col = offLine ? off : primary;
        const x1 = this.mx(l.x1, L), y1 = this.my(l.y1, L);
        const x2 = this.mx(l.x2, L), y2 = this.my(l.y2, L);
        const dxv = x2 - x1, dyv = y2 - y1;
        const segLen = Math.hypot(dxv, dyv) || 1;
        const ux = dxv / segLen, uy = dyv / segLen;
        const pad = 10 * sc;
        const ax1 = x1 + ux * pad, ay1 = y1 + uy * pad;
        const ax2 = x2 - ux * pad, ay2 = y2 - uy * pad;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.5, 2.5 * sc);
        ctx.lineCap = 'round';
        ctx.setLineDash(l.bi ? [4 * sc, 4 * sc] : [8 * sc, 6 * sc]);
        if (!offLine) {
          const per = l.bi ? 8 * sc : 14 * sc;
          const ph = l.bi ? this.flowBi : this.flow;
          const dashOff = ((ph % per) + per) % per;
          let sign = -1;
          if (l.bi) {
            const cur = l.id === 'lb1' ? D.packi : D.bkI;
            sign = Number.isFinite(cur) ? (cur < 0 ? -1 : 1) : 0;
          }
          if (sign !== 0) ctx.lineDashOffset = sign * dashOff;
        }
        ctx.beginPath();
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(ax2, ay2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;

        let txt = '', tcol = text2;
        if (l.bi) {
          const v = l.id === 'lb1' ? D.packi : D.bkI;
          txt = batFlow(v);
          tcol = Number.isFinite(v) ? (v >= 0 ? ok : err) : off;
          if (offLine) tcol = off;
        } else {
          txt = this.linkVal(l.id, D);
          tcol = offLine ? off : text2;
        }
        ctx.fillStyle = tcol;
        ctx.font = '600 ' + this.cfs(12, L) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(txt, this.mx(l.tx, L), this.my(l.ty, L));
      }

      // 节点卡
      for (const n of TOPO_NODES) {
        const offNode = this.nodeOff(n.id, D);
        const warnNode = this.nodeWarn(n.id, D);
        const cv = this.nodeVal(n.id, D);
        const cx = this.mx(n.x, L), cy = this.my(n.y, L);
        const bx = cx - n.w / 2 * sc, by = cy - n.h / 2 * sc;
        const bw = n.w * sc, bh = n.h * sc;
        this.rrect(bx, by, bw, bh, 12 * sc);
        ctx.fillStyle = offNode ? bg2 : card2;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, 1.5 * sc);
        ctx.strokeStyle = warnNode ? warn : (offNode ? off : line);
        ctx.stroke();
        ctx.strokeStyle = offNode ? off : primary;
        this.drawIcon(cv.ic, cx - (n.w / 2 - 20) * sc, cy - n.h / 2 * sc + 20 * sc, sc);
        ctx.fillStyle = offNode ? off : text2;
        ctx.font = '600 ' + this.cfs(13, L) + 'px ' + font;
        ctx.textAlign = 'center';
        ctx.fillText(NODE_TITLES[n.id] || n.id, cx, cy - 8 * sc);
        ctx.fillStyle = offNode ? off : text;
        ctx.font = '700 ' + this.cfs(19, L) + 'px monospace';
        ctx.fillText(cv.v, cx, cy + 15 * sc);
        ctx.fillStyle = offNode ? off : text2;
        ctx.font = this.cfs(12, L) + 'px monospace';
        ctx.fillText(cv.s, cx, cy + 33 * sc);
      }

      // 箭头（最上层）
      for (const l of TOPO_LINKS) {
        const offLine = this.linkOff(l.id, D);
        const col = offLine ? off : primary;
        const x1 = this.mx(l.x1, L), y1 = this.my(l.y1, L);
        const x2 = this.mx(l.x2, L), y2 = this.my(l.y2, L);
        const dxv = x2 - x1, dyv = y2 - y1;
        const segLen = Math.hypot(dxv, dyv) || 1;
        const ux = dxv / segLen, uy = dyv / segLen;
        const pad = 10 * sc;
        const ax1 = x1 + ux * pad, ay1 = y1 + uy * pad;
        const ax2 = x2 - ux * pad, ay2 = y2 - uy * pad;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const as = Math.max(3, 6 * sc);
        ctx.fillStyle = col;
        const ends = l.bi ? [[ax2, ay2, ang], [ax1, ay1, ang + Math.PI]] : [[ax2, ay2, ang]];
        for (const e of ends) {
          ctx.save();
          ctx.translate(e[0], e[1]);
          ctx.rotate(e[2]);
          ctx.beginPath();
          ctx.moveTo(as, 0);
          ctx.lineTo(-as * 0.6, -as * 0.6);
          ctx.lineTo(-as * 0.6, as * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    destroy() {
      clearInterval(this.timer);
      this.resizeObserver.disconnect();
    }
  }

  // ================= 温度监测 =================
  const probeHistory = {};

  function probePosition(id) {
    const bags = ['左副', '左主', '右主', '右副'];
    const bag = bags[(Number(id) - 1) % 4];
    const row = Math.floor((Number(id) - 1) / 4) + 1;
    const col = (Number(id) % 2) + 1;
    return bag + ' · ' + row + ' 行 ' + col + ' 列';
  }

  function updateProbeHistory() {
    for (const n of App.tempNodes()) {
      if (!probeHistory[n.id]) probeHistory[n.id] = { max: -Infinity, min: Infinity, sum: 0, count: 0 };
      const h = probeHistory[n.id];
      if (App.nodeOnline(n) && typeof n.temp === 'number' && n.temp > -100) {
        h.max = Math.max(h.max, n.temp);
        h.min = Math.min(h.min, n.temp);
        h.sum += n.temp;
        h.count++;
      }
    }
  }

  // ================= 页面 =================
  function render(container) {
    container.innerHTML = `
      <div class="topo-view">
        <div class="topo-head">
          <b style="font-size:15px">图示</b>
          <span id="topoCrumb" style="font-size:12px;font-weight:600;color:var(--text2)">能源拓扑</span>
          <div class="grow"></div>
        </div>
        <div class="topo-body">
          <div class="card topo-tree">
            <div class="tree-head">图示</div>
            <button class="tree-item active" data-tree="0"><span>◎</span><span>能源拓扑</span></button>
            <button class="tree-item" data-tree="1"><span>◉</span><span>温度监测</span></button>
            <button class="tree-item" data-tree="2"><span>∿</span><span>实时曲线</span></button>
          </div>
          <div class="card topo-panel" id="topoPanel"></div>
        </div>
      </div>`;

    const panel = container.querySelector('#topoPanel');
    const crumb = container.querySelector('#topoCrumb');
    let treeNode = 0;
    let topo = null;
    let chart = null;
    let tempTimer = null;
    let chartTimer = null;
    let pauseHandler = null;
    let winPoints = 40;
    let bandOn = false;
    let bandVal = 80;
    const legendVisible = [true, true, true, true];

    function cleanupModes() {
      if (topo) { topo.destroy(); topo = null; }
      if (chart) { chart.destroy(); chart = null; }
      clearInterval(tempTimer); tempTimer = null;
      clearInterval(chartTimer); chartTimer = null;
      if (pauseHandler) {
        document.removeEventListener('gcs-toggle-curve', pauseHandler);
        pauseHandler = null;
      }
    }

    function renderTopology() {
      cleanupModes();
      panel.innerHTML = '<div class="topo-legend">'
        + '<span class="legend-item"><span class="dot" style="background:var(--ok)"></span>在线</span>'
        + '<span class="legend-item"><span class="dot" style="background:var(--warn)"></span>告警</span>'
        + '<span class="legend-item"><span class="dot" style="background:var(--off)"></span>离线</span>'
        + '</div><div class="topo-canvas-wrap"><canvas></canvas><div class="topo-tip hidden" id="topoTip"></div></div>';
      const canvas = panel.querySelector('canvas');
      const tip = panel.querySelector('#topoTip');
      topo = new PowerTopology(canvas, tip);
    }

    function renderTemp() {
      cleanupModes();
      panel.innerHTML = `
        <div class="col" style="gap:10px;height:100%;min-height:0">
          <div class="temp-toolbar">
            <b style="font-size:14px">温度监测</b>
            <span class="temp-note" id="probeCount">探头 0</span>
            <span class="temp-note">物理编号保持不变，换板只需改「囊体 / 行 / 列」</span>
            <div class="grow"></div>
            <button class="btn small" id="btnProbeSync">⇄ 从实机同步</button>
            <button class="btn small ghost" id="btnProbeReset">恢复默认</button>
          </div>
          <div class="temp-table">
            <table>
              <thead><tr><th>探头ID</th><th>位置</th><th>实机状态</th><th>当前温度</th><th>最高</th><th>最低</th><th>平均</th></tr></thead>
              <tbody id="tempBody"></tbody>
            </table>
          </div>
          <div class="temp-note">时间列为采样时刻的本地时间（每点 1s），最新一行即最近一次采样；离线或陈旧节点不会计入最高/最低/平均。</div>
        </div>`;
      panel.querySelector('#btnProbeSync').addEventListener('click', () => {
        App.toast('已从实机同步探头列表');
        paintTemp();
      });
      panel.querySelector('#btnProbeReset').addEventListener('click', () => {
        Object.keys(probeHistory).forEach((k) => delete probeHistory[k]);
        App.toast('已恢复默认探头映射');
        paintTemp();
      });
      paintTemp();
      tempTimer = setInterval(paintTemp, 1000);
    }

    function paintTemp() {
      updateProbeHistory();
      const body = panel.querySelector('#tempBody');
      if (!body) return;
      const nodes = App.tempNodes();
      const linkUp = !(App.state.status && App.state.status.linkOnline === false);
      panel.querySelector('#probeCount').textContent = '探头 ' + nodes.length;
      const rows = nodes.map((n) => {
        const off = !linkUp || !App.nodeOnline(n);
        const h = probeHistory[n.id] || { max: NaN, min: NaN, sum: 0, count: 0 };
        const avg = h.count ? h.sum / h.count : NaN;
        return '<tr>'
          + '<td>#' + App.esc(n.id) + '</td>'
          + '<td>' + App.esc(probePosition(n.id)) + '</td>'
          + '<td style="color:' + (off ? 'var(--err)' : 'var(--ok)') + '">' + (off ? '离线' : (App.nodeStale(n) ? '陈旧' : '在线')) + '</td>'
          + '<td>' + (off ? '—' : App.toTemp(n.temp) + ' ' + App.tempUnit()) + '</td>'
          + '<td>' + (off || !Number.isFinite(h.max) ? '—' : App.toTemp(h.max) + ' ' + App.tempUnit()) + '</td>'
          + '<td>' + (off || !Number.isFinite(h.min) ? '—' : App.toTemp(h.min) + ' ' + App.tempUnit()) + '</td>'
          + '<td>' + (off || !Number.isFinite(avg) ? '—' : App.toTemp(avg) + ' ' + App.tempUnit()) + '</td>'
          + '</tr>';
      });
      body.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2)">暂无温度节点数据</td></tr>';
    }

    function renderChart() {
      cleanupModes();
      panel.innerHTML = `
        <div class="col" style="gap:0;height:100%;min-height:0">
          <div class="chart-toolbar">
            <b style="font-size:14px">实时曲线</b>
            <span style="font-size:11px;color:var(--text2)">点击图例可开关参数</span>
            <div class="grow"></div>
            <div class="seg" id="winSeg">
              <button class="seg-btn active" data-win="40">20s</button>
              <button class="seg-btn" data-win="20">10s</button>
              <button class="seg-btn" data-win="10">5s</button>
            </div>
            <span class="row" style="gap:4px;height:26px;padding:0 6px;border:1px solid var(--line);border-radius:6px;background:var(--card2)">
              <input id="bandInput" type="number" value="80" style="width:44px;height:20px;border:1px solid var(--line);border-radius:4px;background:var(--card);color:var(--text);font-size:11px;text-align:center">
              <span style="font-size:11px;font-weight:600;color:var(--text2)">阈值线</span>
              <button class="seg-btn" id="bandBtn" style="min-width:24px;height:20px;padding:0">关</button>
            </span>
            <button class="btn small" id="btnPauseChart">
              <span class="icon" style="width:11px;height:11px;background-color:var(--text2);-webkit-mask-image:url(img/pause.svg);mask-image:url(img/pause.svg)"></span>
              <span id="pauseLbl">暂停</span>
            </button>
            <button class="btn small ghost" id="btnClearChart">清屏</button>
            <button class="btn small ghost" id="btnExportChart" style="color:var(--primary)">导出快照</button>
          </div>
          <div class="chart-wrap">
            <div class="chart-legend" id="chartLegend"></div>
            <div class="chart-canvas-wrap"><canvas id="curveCanvas"></canvas></div>
          </div>
        </div>`;
      const canvas = panel.querySelector('#curveCanvas');
      chart = new App.CurveChart(canvas);
      chart.windowPoints = winPoints;
      chart.visible = legendVisible;

      function paintLegend() {
        const legend = panel.querySelector('#chartLegend');
        const latest = App.state.curve[App.state.curve.length - 1] || {};
        legend.innerHTML = App.curveSeries.map((s, i) =>
          '<span class="item ' + (legendVisible[i] ? '' : 'off') + '" data-i="' + i + '">'
          + '<span class="swatch" style="background:' + s.color + '"></span>'
          + App.esc(s.name)
          + '<span class="val" style="color:' + s.color + '">' + App.fmt(latest[s.key], 1) + '</span>'
          + '</span>'
        ).join('');
        legend.querySelectorAll('.item').forEach((el) => {
          el.addEventListener('click', () => {
            const i = Number(el.dataset.i);
            legendVisible[i] = !legendVisible[i];
            chart.visible = legendVisible;
            chart.draw();
            paintLegend();
          });
        });
      }

      panel.querySelectorAll('[data-win]').forEach((b) => {
        b.addEventListener('click', () => {
          winPoints = Number(b.dataset.win);
          chart.windowPoints = winPoints;
          panel.querySelectorAll('[data-win]').forEach((x) => x.classList.toggle('active', x === b));
          chart.setData(App.state.curve);
        });
      });
      const bandBtn = panel.querySelector('#bandBtn');
      bandBtn.addEventListener('click', () => {
        bandOn = !bandOn;
        bandBtn.textContent = bandOn ? '开' : '关';
        bandBtn.classList.toggle('active', bandOn);
        chart.bandOn = bandOn;
        chart.bandVal = bandVal;
        chart.draw();
      });
      panel.querySelector('#bandInput').addEventListener('change', (e) => {
        bandVal = Number(e.target.value);
        chart.bandVal = bandVal;
        chart.draw();
      });
      panel.querySelector('#btnPauseChart').addEventListener('click', togglePause);
      panel.querySelector('#btnClearChart').addEventListener('click', () => {
        App.state.curve = [];
        chart.setData([]);
        paintLegend();
        App.toast('已清屏');
      });
      panel.querySelector('#btnExportChart').addEventListener('click', () => {
        try {
          const a = document.createElement('a');
          a.download = '曲线快照_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.png';
          a.href = canvas.toDataURL('image/png');
          a.click();
          App.toast('已导出曲线快照');
        } catch (e) {
          App.toast('导出失败：' + e.message, 'err');
        }
      });

      function togglePause() {
        App.state.rtcPlaying = !App.state.rtcPlaying;
        const lbl = panel.querySelector('#pauseLbl');
        if (lbl) lbl.textContent = App.state.rtcPlaying ? '暂停' : '继续';
        const icon = panel.querySelector('#btnPauseChart .icon');
        if (icon) {
          const name = App.state.rtcPlaying ? 'pause' : 'play';
          icon.style.webkitMaskImage = 'url(img/' + name + '.svg)';
          icon.style.maskImage = 'url(img/' + name + '.svg)';
        }
      }
      document.addEventListener('gcs-toggle-curve', pauseHandler = togglePause);

      paintLegend();
      chart.setData(App.state.curve);
      chartTimer = setInterval(() => {
        if (App.state.rtcPlaying) chart.setData(App.state.curve);
        paintLegend();
      }, 500);
    }

    function setTree(i) {
      treeNode = i;
      crumb.textContent = ['能源拓扑', '温度监测', '实时曲线'][i];
      container.querySelectorAll('[data-tree]').forEach((b) => b.classList.toggle('active', Number(b.dataset.tree) === i));
      if (i === 0) renderTopology();
      else if (i === 1) renderTemp();
      else renderChart();
    }

    container.querySelectorAll('[data-tree]').forEach((b) => {
      b.addEventListener('click', () => setTree(Number(b.dataset.tree)));
    });

    setTree(0);

    return {
      key: 'topo',
      update() {
        if (treeNode === 0 && topo) topo.draw();
      },
      destroy() {
        cleanupModes();
      }
    };
  }

  App.viewsRegistry = App.viewsRegistry || {};
  App.viewsRegistry.topo = { render };
})();
