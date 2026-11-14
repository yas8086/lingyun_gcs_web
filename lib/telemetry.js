'use strict';

/**
 * 遥测管线：帧解析、在线判定、告警、曲线采样、会话缓存、模拟数据源。
 * 只在本进程内运行；MQTT 连接参数不进入任何对外数据结构。
 */

const { EventEmitter } = require('events');

const DEVICE_KEYS = ['bms', 'backup', 'mppt1', 'mppt2', 'dcdc', 'fc', 'temp', 'pressure'];
const MAX_CURVE = 3600;           // 约 30 分钟 @2Hz
const MAX_LOG = 500;
const MAX_ALARMS = 200;
const SESSION_MAX_FRAMES = 36000; // 约 2 小时 @5Hz

function nowClock(date) {
  const d = date || new Date();
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function sessionIdFor(d) {
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function decodeFrame(payload) {
  let text;
  if (Buffer.isBuffer(payload)) {
    // 协议帧：0xAA 0x55 <JSON> \n；MQTT 链路通常是纯 JSON
    const start = payload.indexOf(Buffer.from([0xaa, 0x55]));
    if (start >= 0) {
      let end = payload.indexOf(0x0a, start + 2);
      if (end < 0) end = payload.length;
      text = payload.slice(start + 2, end).toString('utf8');
    } else {
      text = payload.toString('utf8');
    }
  } else if (typeof payload === 'string') {
    text = payload;
  } else {
    return null;
  }
  text = text.trim();
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch (e) {
    return null;
  }
}

function normalizeNodes(frame) {
  const out = {};
  if (frame.temp && Array.isArray(frame.temp.nodes)) {
    out.temp = frame.temp.nodes.map((n) => Object.assign({}, n, {
      isTemp: true,
      isPressure: false,
      hasTemp: n && n.p === 0
    }));
  }
  if (frame.pressure && Array.isArray(frame.pressure.nodes)) {
    out.pressure = frame.pressure.nodes.map((n) => Object.assign({}, n, {
      isTemp: false,
      isPressure: true,
      hasTemp: false
    }));
  }
  // 旧协议 lora 键兼容（温度/压力混在一个列表）
  if (frame.lora && Array.isArray(frame.lora.nodes) && !out.temp && !out.pressure) {
    out.temp = [];
    out.pressure = [];
    for (const n of frame.lora.nodes) {
      if (n && n.p === 1) out.pressure.push(Object.assign({}, n, { isPressure: true, isTemp: false, hasTemp: false }));
      else out.temp.push(Object.assign({}, n, { isTemp: true, isPressure: false, hasTemp: true }));
    }
  }
  return out;
}

class TelemetryService extends EventEmitter {
  constructor(options) {
    super();
    this.options = options || {};
    this.source = 'sim';
    this.startedAt = Date.now();
    this.lastReceivedAt = 0;
    this.lastDeviceTs = 0;
    this.frameCount = 0;
    this.badFrames = 0;
    this.frameTimes = [];
    this.frame = {};
    this.curve = [];
    this.logs = [];
    this.alarms = [];
    this.nextAid = 1;
    this.mqttConnected = false;
    this.mqttError = '';
    this.curveAccum = 0;
    this.alarmState = {};
    this.simTimer = null;
    this.simTick = 0;
    this.simStart = Date.now();
    this.session = this.createSession();
    this.sessions = [this.session];
    this.linkLoggedOffline = false;
    this.lastProcessedT = null;
    this.duplicates = 0;
  }

  createSession() {
    const d = new Date();
    return {
      id: sessionIdFor(d),
      startedAt: d.getTime(),
      startedLocal: nowClock(d),
      endedAt: 0,
      state: 'recording',
      frames: [],
      dropped: 0
    };
  }

  startSimulator() {
    this.source = 'sim';
    this.stopSimulator();
    this.simStart = Date.now();
    this.simTick = 0;
    this.simTimer = setInterval(() => this.emitSimFrame(), 200);
    this.log('info', '后端未配置 MQTT，已启用内置遥测模拟源（界面可完整演示）', '后端');
  }

  stopSimulator() {
    if (this.simTimer) clearInterval(this.simTimer);
    this.simTimer = null;
  }

  setSource(source) {
    this.source = source;
  }

  setMqttConnected(connected) {
    if (this.mqttConnected === connected) return;
    this.mqttConnected = connected;
    if (connected) {
      this.stopSimulator();
      this.source = 'mqtt';
      this.log('ok', 'MQTT 遥测链路已连接', '后端');
    } else {
      this.log('err', 'MQTT 遥测链路断开，等待重连', '后端');
    }
    this.emit('status', this.status());
  }

  setMqttError(message) {
    this.mqttError = message ? String(message).slice(0, 160) : '';
  }

  log(type, msg, source) {
    const entry = { type, msg, time: nowClock(), source: source || '' };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG);
    this.emit('log', entry);
    return entry;
  }

  addAlarm(level, content, source) {
    const entry = {
      aid: this.nextAid++,
      level,
      content,
      source: source || '遥测',
      time: nowClock(),
      ts: Date.now(),
      state: '未确认'
    };
    this.alarms.unshift(entry);
    if (this.alarms.length > MAX_ALARMS) this.alarms.length = MAX_ALARMS;
    this.log('alarm', content, entry.source);
    this.emit('alarm', entry);
    return entry;
  }

  confirmAlarm(aid) {
    const found = this.alarms.find((a) => a.aid === Number(aid));
    if (found && found.state === '未确认') {
      found.state = '已确认';
      this.log('info', '告警已确认：' + found.content, found.source);
      this.emit('alarm-update', found);
    }
    return found || null;
  }

  confirmAllAlarms() {
    for (const a of this.alarms) a.state = '已确认';
    this.log('info', '全部告警已确认', '操作');
    this.emit('alarm-update', null);
  }

  ingest(payload, meta) {
    const raw = decodeFrame(payload);
    if (!raw) {
      this.badFrames++;
      if (this.badFrames % 20 === 1) this.log('warn', '收到无法解析的遥测帧，已丢弃', '后端');
      return null;
    }
    if (!isFiniteNumber(raw.t)) raw.t = Date.now() / 1000;
    // QoS 1 极端情况下会重复投递：以机载时间戳 t 去重，避免重复计数/曲线重复采样
    if (this.lastProcessedT !== null && raw.t === this.lastProcessedT) {
      this.duplicates++;
      this.lastReceivedAt = Date.now();
      return null;
    }
    this.lastProcessedT = raw.t;
    this.lastReceivedAt = Date.now();
    this.lastDeviceTs = raw.t;
    this.frameCount++;
    this.frameTimes.push(this.lastReceivedAt);
    if (this.frameTimes.length > 60) this.frameTimes.splice(0, this.frameTimes.length - 60);

    const nodes = normalizeNodes(raw);
    const frame = Object.assign({}, raw);
    if (nodes.temp) frame.temp = { nodes: nodes.temp };
    if (nodes.pressure) frame.pressure = { nodes: nodes.pressure };
    this.frame = frame;
    this.recordSession(frame);
    this.sampleCurve();
    this.evaluateAlarms(frame);
    this.checkLinkRecovered();
    this.emit('telemetry', frame);
    return frame;
  }

  endCurrentSession(reason) {
    if (!this.session || this.session.state !== 'recording') return;
    this.session.endedAt = Date.now();
    this.session.state = 'ended';
    this.log('info', '遥测会话结束：' + this.session.id + (reason ? '（' + reason + '）' : ''), '后端');
  }

  recordSession(frame) {
    // 链路曾断开：上一段连续遥测结束，下一帧开启新会话
    if (this.session && this.session.state === 'recording' && this.linkLoggedOffline) {
      this.endCurrentSession('链路断开');
    }
    if (!this.session || this.session.state !== 'recording') {
      this.session = this.createSession();
      this.sessions.push(this.session);
      if (this.sessions.length > 30) this.sessions.shift();
    }
    const s = this.session;
    if (s.frames.length >= SESSION_MAX_FRAMES) {
      s.dropped++;
      s.frames.shift();
    }
    s.frames.push(frame);
  }

  sampleCurve() {
    const now = Date.now();
    if (now - this.curveAccum < 480) return;
    this.curveAccum = now;
    const f = this.frame || {};
    const get = (dev, key) => {
      const o = f[dev];
      return o && isFiniteNumber(o[key]) ? o[key] : null;
    };
    this.curve.push({
      t: now,
      v: get('bms', 'pack_v'),
      pv: get('mppt1', 'pv_p'),
      outp: get('dcdc', 'out_p'),
      i: get('bms', 'pack_i')
    });
    if (this.curve.length > MAX_CURVE) this.curve.splice(0, this.curve.length - MAX_CURVE);
  }

  evaluateAlarms(frame) {
    const rules = [
      { key: 'bms_soc_low', test: () => frame.bms && frame.bms.soc < 20, level: '严重', msg: '主电池 SOC 低于 20%', src: 'BMS' },
      { key: 'bms_temp_high', test: () => frame.bms && frame.bms.max_t > 50, level: '警告', msg: '主电池最高温度超过 50℃', src: 'BMS' },
      { key: 'bms_alarm', test: () => frame.bms && Number(frame.bms.alarm) > 0, level: '严重', msg: '主 BMS 上报告警码非 0', src: 'BMS' },
      { key: 'dcdc_fault', test: () => frame.dcdc && Number(frame.dcdc.fault) !== 0, level: '严重', msg: 'DCDC 上报故障码非 0', src: 'DCDC' },
      { key: 'mppt1_fault', test: () => frame.mppt1 && Number(frame.mppt1.fault) !== 0, level: '警告', msg: '主 MPPT 上报故障码非 0', src: 'MPPT1' },
      { key: 'mppt2_fault', test: () => frame.mppt2 && Number(frame.mppt2.fault) !== 0, level: '警告', msg: '副 MPPT 上报故障码非 0', src: 'MPPT2' },
      { key: 'backup_fault', test: () => frame.backup && Number(frame.backup.fault) !== 0, level: '严重', msg: '备用电源上报故障码非 0', src: '备用电源' }
    ];
    for (const r of rules) {
      let hit = false;
      try { hit = !!r.test(); } catch (e) { hit = false; }
      const prev = this.alarmState[r.key];
      if (hit && prev !== true) {
        this.alarmState[r.key] = true;
        this.addAlarm(r.level, r.msg, r.src);
      } else if (!hit) {
        this.alarmState[r.key] = false;
      }
    }
    if (frame.fc && frame.fc.online === false) {
      // 飞控离线不单独告警（链路状态由顶部/状态栏呈现）
    }
  }

  checkLinkRecovered() {
    if (this.linkLoggedOffline) {
      this.linkLoggedOffline = false;
      this.log('ok', '数传/MQTT 数据链路已恢复', '后端');
    }
  }

  status() {
    const now = Date.now();
    // 数据新鲜度用本地接收时间判断（机载 t 受 NTP 影响，不用于超时）
    const age = this.lastReceivedAt > 0 ? now - this.lastReceivedAt : Infinity;
    const linkOnline = age < 6000;
    const safetyFresh = age < 3000;
    if (!linkOnline && !this.linkLoggedOffline && this.lastReceivedAt > 0) {
      this.linkLoggedOffline = true;
      this.log('err', '数据链路断开（超过 6 秒未收到遥测）', '后端');
    }
    let rate = 0;
    if (this.frameTimes.length > 1) {
      const recent = this.frameTimes.filter((t) => now - t < 5000);
      if (recent.length > 1) {
        const span = (recent[recent.length - 1] - recent[0]) / 1000;
        rate = span > 0 ? (recent.length - 1) / span : 0;
      }
    }
    const devices = {};
    const frame = this.frame || {};
    const tempNodes = frame.temp && Array.isArray(frame.temp.nodes) ? frame.temp.nodes : [];
    const pressureNodes = frame.pressure && Array.isArray(frame.pressure.nodes) ? frame.pressure.nodes : [];
    const nodeOn = (n) => !!n && (n.online === 1 || n.online === true);
    for (const key of DEVICE_KEYS) {
      if (key === 'temp') {
        devices.temp = linkOnline && tempNodes.some(nodeOn);
        continue;
      }
      if (key === 'pressure') {
        devices.pressure = linkOnline && pressureNodes.some(nodeOn);
        continue;
      }
      const dev = frame[key];
      devices[key] = linkOnline && !!dev && dev.online !== false;
    }
    const tempOnline = linkOnline ? tempNodes.filter(nodeOn).length : 0;
    const pressureOnline = linkOnline ? pressureNodes.filter(nodeOn).length : 0;
    return {
      source: this.source,
      mqttConnected: this.mqttConnected,
      linkOnline,
      safetyFresh,
      dataRate: Math.max(0, Math.min(20, rate)),
      uptimeSec: Math.floor((now - this.startedAt) / 1000),
      frameCount: this.frameCount,
      badFrames: this.badFrames,
      duplicates: this.duplicates,
      lastFrameTs: this.lastDeviceTs,
      lastReceivedAt: this.lastReceivedAt,
      devices,
      nodes: {
        temp: { online: tempOnline, total: tempNodes.length },
        pressure: { online: pressureOnline, total: pressureNodes.length }
      },
      alarmsUnconfirmed: this.alarms.filter((a) => a.state === '未确认').length,
      sessionId: this.session ? this.session.id : ''
    };
  }

  state() {
    return {
      status: this.status(),
      telemetry: this.frame,
      alarms: this.alarms.slice(0, 50),
      logs: this.logs.slice(-100),
      curve: this.curve.slice(-600)
    };
  }

  sessionList() {
    return this.sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      startedLocal: s.startedLocal,
      endedAt: s.endedAt,
      state: s.state,
      frames: s.frames.length,
      dropped: s.dropped,
      durationMs: s.frames.length > 1 ? Math.max(0, Math.round((s.frames[s.frames.length - 1].t - s.frames[0].t) * 1000)) : 0
    })).reverse();
  }

  sessionFrames(id, start, count) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return null;
    const from = Math.max(0, Number(start) || 0);
    const n = Math.max(1, Math.min(2000, Number(count) || 600));
    return {
      id: s.id,
      total: s.frames.length,
      start: from,
      frames: s.frames.slice(from, from + n)
    };
  }

  latestSession() {
    return this.session;
  }

  // ===== 模拟数据源（与协议字段一致，用于未配置 MQTT 的演示环境）=====
  emitSimFrame() {
    const t = Date.now() / 1000;
    const elapsed = (Date.now() - this.simStart) / 1000;
    this.simTick++;
    const s = this.simTick;
    const wob = (a, w, ph) => Math.sin(t * w + (ph || 0)) * a;

    const soc = Math.max(38, 86 - elapsed * 0.0025);
    const packV = 367.2 + wob(0.6, 0.13) + wob(0.2, 0.9);
    const packI = 1.8 + wob(1.2, 0.21) + wob(0.4, 1.3);
    const pvP = 600 + wob(55, 0.11) + wob(18, 0.7);
    const outP = 250 + wob(22, 0.17);
    const lat = 30.365 + 0.0032 * Math.cos(elapsed * 0.035);
    const lon = 120.029 + 0.0042 * Math.sin(elapsed * 0.035);
    const heading = (elapsed * 6.2) % 360;

    const frame = {
      t: Number(t.toFixed(3)),
      safe_to_control: true,
      power_on_allowed: true,
      bms: {
        online: true,
        pack_v: Number(packV.toFixed(1)),
        pack_i: Number(packI.toFixed(1)),
        soc: Math.round(soc),
        rsoc: Number((soc - 0.6).toFixed(1)),
        max_v: Number((3.62 + wob(0.01, 0.4)).toFixed(3)),
        min_v: Number((3.58 + wob(0.008, 0.5)).toFixed(3)),
        diff_v: 0.04,
        max_t: Number((32.5 + wob(0.8, 0.09)).toFixed(1)),
        min_t: Number((31.0 + wob(0.5, 0.07)).toFixed(1)),
        avg_t: Number((31.8 + wob(0.6, 0.08)).toFixed(1)),
        diff_t: 1.5,
        riso_p: 520,
        riso_n: 498,
        alarm: 0,
        soh: 95,
        fault1: 0,
        fault2: 0,
        fault3: 0
      },
      backup: {
        online: true,
        pack_v: Number((48.6 + wob(0.2, 0.15)).toFixed(1)),
        pack_i: Number((1.2 + wob(0.4, 0.3)).toFixed(1)),
        soc: 90,
        soh: 96,
        max_v: 4.18,
        min_v: 4.11,
        diff_v: 0.07,
        max_t: Number((29.4 + wob(0.6, 0.1)).toFixed(1)),
        min_t: Number((28.1 + wob(0.4, 0.12)).toFixed(1)),
        avg_t: 28.7,
        diff_t: 1.3,
        alarm: 0,
        protect: 0,
        fault: 0,
        sys: 3
      },
      mppt1: {
        online: true,
        pv_v: Number((89.5 + wob(1.5, 0.18)).toFixed(1)),
        pv_p: Number(pvP.toFixed(0)),
        batt_v: Number((86.0 + wob(0.3, 0.13)).toFixed(1)),
        charge_i: Number((7.0 + wob(0.6, 0.2)).toFixed(1)),
        today: 0.42,
        month: 3.5,
        total: 12.8,
        rated_v: 86.4,
        rated_i: 60,
        air_t: Number((25.5 + wob(0.6, 0.06)).toFixed(1)),
        mod_t: Number((30.1 + wob(0.8, 0.07)).toFixed(1)),
        cs: 1,
        mode: 0,
        chg_on: true,
        fault: 0
      },
      mppt2: {
        online: true,
        pv_v: Number((88.2 + wob(1.2, 0.16, 1.1)).toFixed(1)),
        pv_p: Number((pvP * 0.72 + wob(20, 0.5)).toFixed(0)),
        batt_v: Number((86.0 + wob(0.3, 0.13)).toFixed(1)),
        charge_i: Number((5.0 + wob(0.5, 0.22)).toFixed(1)),
        today: 0.31,
        month: 2.8,
        total: 9.6,
        rated_v: 86.4,
        rated_i: 60,
        air_t: 25.1,
        mod_t: 29.6,
        cs: 1,
        mode: 0,
        chg_on: true,
        fault: 0
      },
      dcdc: {
        online: true,
        in_v: Number((86.0 + wob(0.3, 0.13)).toFixed(1)),
        out_v: Number((48.1 + wob(0.15, 0.19)).toFixed(1)),
        out_i: Number((5.2 + wob(0.35, 0.23)).toFixed(1)),
        out_p: Number(outP.toFixed(0)),
        temp: Number((41.0 + wob(1.2, 0.05)).toFixed(1)),
        enabled: true,
        fault: 0
      },
      fc: {
        online: true,
        roll: Number(wob(4.5, 0.5).toFixed(1)),
        pitch: Number(wob(2.6, 0.37, 1.4).toFixed(1)),
        yaw: Number(heading.toFixed(1)),
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        alt: Number((150 + wob(6, 0.09)).toFixed(1)),
        vx: Number(wob(1.2, 0.11).toFixed(2)),
        vy: Number(wob(1.1, 0.13, 0.8).toFixed(2)),
        vz: Number(wob(0.3, 0.2, 2.1).toFixed(2)),
        mode: 'AUTO.LOITER',
        armed: true,
        hdg: Number(heading.toFixed(1)),
        airspd: Number((10 + wob(0.8, 0.16)).toFixed(1)),
        tas: Number((10.5 + wob(0.8, 0.16)).toFixed(1)),
        gs: Number((9.8 + wob(0.7, 0.18)).toFixed(1)),
        climb: Number(wob(0.5, 0.25).toFixed(1)),
        thr: Number((50 + wob(4, 0.14)).toFixed(0)),
        batt_v: 48.0,
        batt_pct: 85,
        ekf: { const_pos: false, glitch: false, accel_err: false },
        gps: { fix: 6, sat: 18, eph: 50, epv: 80 },
        esc: { n: 10, rpm: [], v: [], i: [], tmp: [] }
      },
      temp: { nodes: [] },
      pressure: { nodes: [] }
    };

    const tempIds = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12];
    for (const id of tempIds) {
      const base = 24.5 + (id % 5) * 0.9;
      frame.temp.nodes.push({
        id,
        online: 1,
        valid: 1,
        stale: 0,
        p: 0,
        raw: Math.round((base + 273) * 16),
        t_ok: 1,
        p_ok: 0,
        temp: Number((base + wob(0.5, 0.05, id)).toFixed(1)),
        pressure: 0,
        alarm: 0
      });
    }
    const bags = [1, 2, 3, 4];
    for (const id of bags) {
      frame.pressure.nodes.push({
        id,
        online: 1,
        valid: 1,
        stale: 0,
        p: 1,
        raw: 0,
        t_ok: 0,
        p_ok: 1,
        temp: 0,
        pressure: Number((1230 + id * 45 + wob(35, 0.07, id * 2)).toFixed(3)),
        alarm: 0
      });
    }

    const baseRpm = [380, 362, 375, 388, 1240, 1205, 1218, 1255, 1102, 1160];
    for (let i = 0; i < 10; i++) {
      const rpm = Math.max(0, baseRpm[i] + wob(55, 0.2, i * 0.7));
      frame.fc.esc.rpm.push(Math.round(rpm));
      frame.fc.esc.v.push(Number((48.1 + wob(0.2, 0.3, i)).toFixed(1)));
      frame.fc.esc.i.push(Number((2.2 + wob(0.5, 0.4, i)).toFixed(1)));
      frame.fc.esc.tmp.push(Number((40 + i * 2.4 + wob(1.5, 0.1, i)).toFixed(1)));
    }

    this.ingest(JSON.stringify(frame), { source: 'sim' });
    if (s % 5 === 0) this.emit('status', this.status());
  }
}

module.exports = {
  TelemetryService,
  decodeFrame,
  normalizeNodes,
  nowClock
};
