'use strict';

/**
 * 灵云01号 Web 地面站后端。
 * - 服务端独占 MQTT 连接（broker / 账号 / 主题均不下发浏览器）
 * - 对浏览器只暴露同源 HTTP API 与 SSE 遥测流
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { MqttClient } = require('./lib/mqtt-client');
const { TelemetryService } = require('./lib/telemetry');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const telemetry = new TelemetryService();

// ===== MQTT 配置（只存在于服务端环境变量）=====
function readMqttConfig() {
  const enabled = String(process.env.MQTT_ENABLED || 'auto').toLowerCase();
  const url = process.env.MQTT_URL || '';
  const host = process.env.MQTT_HOST || '';
  const port = Number(process.env.MQTT_PORT || 0);
  const username = process.env.MQTT_USERNAME || '';
  const password = process.env.MQTT_PASSWORD || '';
  const topic = process.env.MQTT_TOPIC || 'lingyun01/telemetry';
  const cmdTopic = process.env.MQTT_CMD_TOPIC || '';
  const ackTopic = process.env.MQTT_ACK_TOPIC || '';
  const allowCommands = String(process.env.ALLOW_COMMANDS || '').toLowerCase() === 'true';
  let finalUrl = '';
  if (url) {
    finalUrl = url;
  } else if (host) {
    const secure = String(process.env.MQTT_TLS || '').toLowerCase() === 'true' || Number(port) === 8883;
    const scheme = secure ? 'mqtts' : 'mqtt';
    const auth = username
      ? encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@'
      : '';
    finalUrl = scheme + '://' + auth + host + ':' + (port || (secure ? 8883 : 1883));
  }
  return {
    enabled: enabled !== 'false' && enabled !== '0' && !!finalUrl,
    url: finalUrl,
    topic,
    cmdTopic,
    ackTopic,
    allowCommands,
    rejectUnauthorized: String(process.env.MQTT_TLS_INSECURE || '').toLowerCase() !== 'true'
  };
}

let mqttCfg = readMqttConfig();
let mqtt = null;
let mqttState = 'disabled';
let lastConfigureAt = 0;
const pendingCommands = new Map();
let cmdSeq = 1000;

function describeMqttError(err) {
  const code = (err && (err.code || err.message)) || '';
  const map = {
    ECONNREFUSED: '连接被拒绝（Broker 未监听或网络不可达）',
    ENOTFOUND: '域名解析失败',
    ETIMEDOUT: '连接超时',
    ECONNRESET: '连接被重置',
    EAI_AGAIN: 'DNS 暂时不可用',
    CERT_HAS_EXPIRED: 'TLS 证书已过期',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS 证书为自签名',
    SELF_SIGNED_CERT_IN_CHAIN: 'TLS 证书链包含自签名证书',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS 证书无法验证'
  };
  const text = map[code];
  if (text) return text;
  // 未知错误只回固定文案，避免把 Broker 地址、端口或账号经接口/日志带出
  return '连接失败';
}

function setupMqtt(config) {
  if (config) mqttCfg = config;
  if (!mqttCfg.enabled) {
    mqttState = 'disabled';
    return;
  }
  if (mqtt) {
    try { mqtt.stop(); } catch (e) { /* ignore */ }
    mqtt = null;
  }
  mqttState = 'connecting';
  telemetry.setSource('mqtt');
  telemetry.setMqttConnected(false);
  mqtt = new MqttClient({
    url: mqttCfg.url,
    rejectUnauthorized: mqttCfg.rejectUnauthorized,
    keepalive: 30
  });
  mqtt.on('connected', () => {
    mqttState = 'connected';
    console.log('[lingyun-web] mqtt connected');
    telemetry.setMqttError('');
    telemetry.setMqttConnected(true);
  });
  mqtt.on('offline', () => {
    mqttState = 'offline';
    console.log('[lingyun-web] mqtt offline');
    telemetry.setMqttConnected(false);
  });
  mqtt.on('disconnected', () => {
    mqttState = 'offline';
    console.log('[lingyun-web] mqtt disconnected');
    telemetry.setMqttConnected(false);
  });
  mqtt.on('connect-error', (err) => {
    mqttState = 'offline';
    telemetry.setMqttError(describeMqttError(err));
    telemetry.setMqttConnected(false);
    if (telemetry.logs.length === 0 || telemetry.logs[telemetry.logs.length - 1].msg !== 'MQTT 连接失败，正在重试')
      telemetry.log('warn', 'MQTT 连接失败，正在重试：' + describeMqttError(err), '后端');
  });
  mqtt.on('error', (err) => {
    telemetry.setMqttError(describeMqttError(err));
  });
  mqtt.on('connect-refused', (rc) => {
    const map = {
      1: '协议版本不被支持', 2: '客户端标识被拒绝', 3: '服务不可用',
      4: '用户名或密码错误', 5: '未授权'
    };
    telemetry.setMqttError(map[rc] || ('连接被拒绝（码 ' + rc + '）'));
    telemetry.log('err', 'MQTT 连接被拒绝：' + (map[rc] || rc), '后端');
  });
  mqtt.on('message', (topic, payload) => {
    if (mqttCfg.ackTopic && topic === mqttCfg.ackTopic) {
      handleCommandAck(payload);
      return;
    }
    telemetry.setMqttConnected(true);
    telemetry.ingest(payload, { source: 'mqtt' });
  });
  mqtt.subscribe(mqttCfg.topic);
  if (mqttCfg.ackTopic) mqtt.subscribe(mqttCfg.ackTopic);
  mqtt.start();
}

function buildMqttConfig(body) {
  const host = String(body.host || '').trim();
  const port = Number(body.port || 8883);
  const tls = body.tls !== false;
  const username = String(body.username || '');
  const password = String(body.password || '');
  const topic = String(body.topic || '').trim();
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return { error: '主机名格式无效' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: '端口无效' };
  if (!username) return { error: '用户名不能为空' };
  if (!password) return { error: '密码不能为空' };
  if (!topic || /[#+\s]/.test(topic)) return { error: 'Topic 不能为空且不能包含通配符' };
  const scheme = tls ? 'mqtts' : 'mqtt';
  return {
    config: {
      enabled: true,
      url: scheme + '://' + encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@' + host + ':' + port,
      topic,
      cmdTopic: '',
      ackTopic: '',
      allowCommands: false,
      rejectUnauthorized: true
    }
  };
}

function configureRuntimeMqtt(body) {
  const r = buildMqttConfig(body || {});
  if (r.error) return { ok: false, message: r.error };
  setupMqtt(r.config);
  telemetry.log('info', 'MQTT 连接参数已在服务端内存中更新（不落盘）', '后端');
  return { ok: true };
}

function handleCommandAck(payload) {
  let obj = null;
  try { obj = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
  const reqId = obj && (obj.req_id !== undefined ? obj.req_id : obj.reqId);
  if (reqId === undefined) return;
  const pending = pendingCommands.get(String(reqId));
  if (!pending) return;
  pendingCommands.delete(String(reqId));
  const accepted = obj.accepted !== undefined ? !!obj.accepted : obj.result !== 'rejected';
  const result = {
    req_id: reqId,
    cmd: pending.cmd,
    accepted,
    message: String(obj.message || (accepted ? '指令已接受' : '指令被拒绝')),
    attempts: obj.attempts !== undefined ? obj.attempts : 1,
    elapsedMs: Date.now() - pending.sentAt
  };
  telemetry.log(accepted ? 'ok' : 'err',
    '电源指令' + (accepted ? '已接受' : '被拒绝') + '：' + pending.cmd + (result.message ? '（' + result.message + '）' : ''),
    '电源');
  if (!accepted) telemetry.addAlarm('严重', '电源指令被拒绝：' + pending.cmd + ' — ' + result.message, '电源');
  broadcast('power-result', result);
}

const COMMANDS = {
  bms_power: { commands: ['POWER_OFF', 'POWER_ON', 'ACC_CUTOFF'], recovery: ['POWER_ON'] },
  dcdc_power: { commands: ['POWER_OFF', 'POWER_ON'], recovery: ['POWER_ON'] },
  mppt_charge: { commands: ['CHARGE_OFF', 'CHARGE_ON'], recovery: ['CHARGE_ON'] },
  dcdc_set_output: { custom: true },
  mppt_write: { custom: true },
  power_all_off: { custom: true }
};

function validateCommand(cmd, params) {
  const def = COMMANDS[cmd];
  if (!def) return { ok: false, message: '不支持的指令：' + cmd };
  if (def.commands) {
    const sub = params && params.command;
    if (!def.commands.includes(sub)) return { ok: false, message: '指令参数非法' };
  }
  if (cmd === 'dcdc_set_output') {
    const v = Number(params && params.voltage);
    const i = Number(params && params.current);
    if (!Number.isFinite(v) || v < 40 || v > 60) return { ok: false, message: '输出电压需在 40–60 V' };
    if (!Number.isFinite(i) || i < 0 || i > 25) return { ok: false, message: '输出限流需在 0–25 A' };
  }
  if (cmd === 'mppt_write') {
    const code = Number(params && params.code);
    const values = params && params.values;
    if (!Number.isInteger(code) || code < 1 || code > 13) return { ok: false, message: '配置段 code 需在 1–13' };
    if (!Array.isArray(values) || values.length !== 4) return { ok: false, message: '配置值需为 4 个 U16' };
    for (const v of values) {
      if (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 65535)
        return { ok: false, message: '配置值需为 0–65535 的整数' };
    }
  }
  return { ok: true };
}

function sendPowerCommand(cmd, params) {
  if (!mqttCfg.allowCommands || !mqttCfg.cmdTopic || !mqtt || !mqtt.connected)
    return { ok: false, sent: false, message: '当前后端未开放指令下行通道（仅遥测）' };
  const check = validateCommand(cmd, params);
  if (!check.ok) return { ok: false, sent: false, message: check.message };
  const frame = telemetry.frame || {};
  const recoveryCmd = (cmd === 'bms_power' || cmd === 'dcdc_power') && params && params.command === 'POWER_ON';
  const chargeOn = cmd === 'mppt_charge' && params && params.command === 'CHARGE_ON';
  const fresh = telemetry.lastReceivedAt > 0 && (Date.now() - telemetry.lastReceivedAt) <= 3000;
  if ((recoveryCmd || chargeOn) && (!fresh || frame.power_on_allowed !== true))
    return { ok: false, sent: false, message: '遥测超时或存在设备故障，恢复被禁止（power_on_allowed 未放行）' };
  const reqId = ++cmdSeq;
  const payload = JSON.stringify({ type: 'cmd', req_id: reqId, cmd, params: params || {} });
  const ok = mqtt.publish(mqttCfg.cmdTopic, payload);
  if (!ok) return { ok: false, sent: false, message: '指令通道未连接' };
  const pending = { cmd, sentAt: Date.now() };
  pendingCommands.set(String(reqId), pending);
  telemetry.log('info', '电源指令下发：' + cmd + ' req_id=' + reqId, '电源');
  if (pendingCommands.size > 50) {
    const first = pendingCommands.keys().next();
    pendingCommands.delete(first.value);
  }
  setTimeout(() => {
    if (!pendingCommands.has(String(reqId))) return;
    pendingCommands.delete(String(reqId));
    telemetry.log('err', '电源指令无应答：' + cmd + '（结果以下传遥测为准）', '电源');
    telemetry.addAlarm('严重', '电源指令无应答：' + cmd + '（结果以下传遥测为准）', '电源');
    broadcast('power-result', {
      req_id: reqId, cmd, accepted: false, timeout: true,
      message: '无应答（结果以下传遥测为准）', attempts: 3,
      elapsedMs: Date.now() - pending.sentAt
    });
  }, Math.max(2000, Number(process.env.MQTT_ACK_TIMEOUT || 6000)));
  return { ok: true, sent: true, req_id: reqId };
}

// ===== SSE =====
const clients = new Set();
let firstFrameLogged = false;

function sseWrite(res, event, data) {
  try {
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  } catch (e) { /* ignore */ }
}

function broadcast(event, data) {
  for (const res of clients) sseWrite(res, event, data);
}

telemetry.on('telemetry', (frame) => {
  if (!firstFrameLogged) {
    firstFrameLogged = true;
    console.log('[lingyun-web] first telemetry frame received');
  }
  broadcast('telemetry', frame);
});
telemetry.on('status', () => {
  broadcast('status', publicStatus());
});
telemetry.on('log', (entry) => {
  broadcast('log', entry);
});
telemetry.on('alarm', (entry) => {
  broadcast('alarm', entry);
});
telemetry.on('alarm-update', () => {
  broadcast('alarms-sync', telemetry.alarms.slice(0, 50));
});

setInterval(() => {
  broadcast('status', publicStatus());
}, 1000);

// ===== 静态文件 =====
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || ext === '.js' || ext === '.css';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': noCache ? 'no-cache, must-revalidate' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

// ===== HTTP 请求处理 =====
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (limit || 64 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function publicStatus() {
  const s = telemetry.status();
  return {
    source: s.source,
    mqttConnected: s.mqttConnected,
    linkOnline: s.linkOnline,
    safetyFresh: s.safetyFresh,
    dataRate: Number(s.dataRate.toFixed(1)),
    uptimeSec: s.uptimeSec,
    frameCount: s.frameCount,
    badFrames: s.badFrames,
    duplicates: s.duplicates,
    lastFrameTs: s.lastFrameTs,
    devices: s.devices,
    nodes: s.nodes,
    alarmsUnconfirmed: s.alarmsUnconfirmed,
    sessionId: s.sessionId,
    commandsEnabled: !!(mqttCfg.allowCommands && mqttCfg.cmdTopic && mqtt && mqtt.connected),
    mqttConfigured: !!mqttCfg.enabled
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ---- 健康检查 ----
  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      uptimeSec: Math.floor(process.uptime()),
      source: telemetry.source,
      mqttConnected: telemetry.mqttConnected
    });
    return;
  }

  // ---- 初始状态 ----
  if (pathname === '/api/state' && req.method === 'GET') {
    const state = telemetry.state();
    state.status = publicStatus();
    sendJson(res, 200, state);
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, publicStatus());
    return;
  }

  if (pathname === '/api/telemetry' && req.method === 'GET') {
    sendJson(res, 200, { status: publicStatus(), telemetry: telemetry.frame });
    return;
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    const points = Math.max(60, Math.min(3600, Number(url.searchParams.get('points') || 600)));
    sendJson(res, 200, { curve: telemetry.curve.slice(-points) });
    return;
  }

  if (pathname === '/api/sessions' && req.method === 'GET') {
    sendJson(res, 200, { sessions: telemetry.sessionList() });
    return;
  }

  const sessMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9_\-]+)\/frames$/);
  if (sessMatch && req.method === 'GET') {
    const start = Number(url.searchParams.get('start') || 0);
    const count = Number(url.searchParams.get('count') || 600);
    const data = telemetry.sessionFrames(sessMatch[1], start, count);
    if (!data) { sendJson(res, 404, { error: '会话不存在' }); return; }
    sendJson(res, 200, data);
    return;
  }

  if (pathname === '/api/alarms/confirm' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body && body.all) telemetry.confirmAllAlarms();
      else telemetry.confirmAlarm(body && body.aid);
      sendJson(res, 200, { ok: true, alarms: telemetry.alarms.slice(0, 50) });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/command' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const result = sendPowerCommand(String(body.cmd || ''), body.params || {});
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
    return;
  }

  // MQTT 运行时配置（仅内存，不落盘、不回显）
  if (pathname === '/api/mqtt/config' && req.method === 'GET') {
    sendJson(res, 200, {
      configured: !!mqttCfg.enabled,
      connected: !!(mqtt && mqtt.connected),
      source: telemetry.source
    });
    return;
  }

  if (pathname === '/api/mqtt/configure' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(origin).host === req.headers.host; } catch (e) { sameOrigin = false; }
      if (!sameOrigin) { sendJson(res, 403, { ok: false, message: '仅允许同源配置' }); return; }
    }
    const now = Date.now();
    if (now - lastConfigureAt < 2000) { sendJson(res, 429, { ok: false, message: '操作过于频繁' }); return; }
    lastConfigureAt = now;
    try {
      const body = await readJsonBody(req);
      const result = configureRuntimeMqtt(body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
    return;
  }

  if (pathname === '/setup' && req.method === 'GET') {
    serveStatic(req, res, '/setup.html');
    return;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    sendJson(res, 200, { logs: telemetry.logs.slice(-200) });
    return;
  }

  // ---- SSE ----
  if (pathname === '/api/stream' && req.method === 'GET') {
    if (clients.size >= 30) {
      sendJson(res, 503, { error: '连接数已满' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    const state = telemetry.state();
    state.status = publicStatus();
    sseWrite(res, 'state', state);
    const ping = setInterval(() => {
      try { res.write(': keep-alive\n\n'); } catch (e) { /* ignore */ }
    }, 20000);
    if (ping.unref) ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  serveStatic(req, res, pathname);
});

// ===== 启动 =====
function start() {
  if (mqttCfg.enabled) {
    setupMqtt();
    // MQTT 已配置但短时间未连上时，保持链路状态为未连接（不使用模拟数据冒充实时）
  } else if (String(process.env.REQUIRE_MQTT || '') === '1') {
    telemetry.setSource('unconfigured');
    telemetry.log('warn', 'MQTT 未配置，请打开 /setup 填写只读连接参数', '后端');
  } else {
    telemetry.startSimulator();
  }
  server.listen(PORT, HOST, () => {
    const mode = mqttCfg.enabled
      ? 'MQTT（服务端代理）'
      : (String(process.env.REQUIRE_MQTT || '') === '1' ? '未配置（等待 /setup）' : '内置模拟源');
    console.log('[lingyun-web] listening on ' + HOST + ':' + PORT + ' · source=' + mode);
  });
  server.on('error', (err) => {
    console.error('[lingyun-web] server error:', err && err.message);
    process.exit(1);
  });
}

process.on('SIGTERM', () => {
  try { if (mqtt) mqtt.stop(); } catch (e) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
process.on('SIGINT', () => {
  try { if (mqtt) mqtt.stop(); } catch (e) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});

start();
