'use strict';

/**
 * 极简 MQTT 3.1.1 客户端（零依赖）。
 * 仅用于服务端订阅遥测 / 发布控制指令，永远不把连接参数下发给浏览器。
 */

const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');
const crypto = require('crypto');

function encodeLength(len) {
  const out = [];
  let n = len;
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

function encodeString(str) {
  const s = Buffer.from(String(str), 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(s.length, 0);
  return Buffer.concat([len, s]);
}

function packet(type, flags, payload) {
  const fixed = Buffer.from([(type << 4) | (flags & 0x0f)]);
  return Buffer.concat([fixed, encodeLength(payload.length), payload]);
}

class MqttClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = Object.assign({
      url: 'mqtt://127.0.0.1:1883',
      clientId: '',
      keepalive: 30,
      reconnectMin: 1000,
      reconnectMax: 30000,
      rejectUnauthorized: true
    }, options);

    this.connected = false;
    this.subscriptions = [];
    this.buffer = Buffer.alloc(0);
    this.socket = null;
    this.retry = 0;
    this.timer = null;
    this.pingTimer = null;
    this.packetId = 1;
    this.closedByUser = false;
  }

  parseUrl() {
    let u;
    try {
      u = new URL(this.options.url);
    } catch (e) {
      throw new Error('MQTT_URL 格式无效');
    }
    const secure = u.protocol === 'mqtts:' || u.protocol === 'tls:' || u.protocol === 'ssl:';
    return {
      secure,
      host: u.hostname,
      port: Number(u.port || (secure ? 8883 : 1883)),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined
    };
  }

  start() {
    this.closedByUser = false;
    this.connect();
  }

  stop() {
    this.closedByUser = true;
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
  }

  connect() {
    let cfg;
    try {
      cfg = this.parseUrl();
    } catch (err) {
      this.emit('connect-error', err);
      this.scheduleReconnect();
      return;
    }
    const target = { host: cfg.host, port: cfg.port };
    let socket;
    try {
      socket = cfg.secure
        ? tls.connect({
            host: cfg.host,
            port: cfg.port,
            servername: cfg.host,
            rejectUnauthorized: this.options.rejectUnauthorized !== false
          })
        : net.connect(target);
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.emit('connecting', { host: cfg.host, port: cfg.port, secure: cfg.secure });

    const onReady = () => {
      const clientId = this.options.clientId || ('lingyun-web-' + crypto.randomBytes(4).toString('hex'));
      const flags = 0x02; // clean session
      let payload = Buffer.concat([encodeString(clientId)]);
      let connectFlags = flags;
      if (cfg.username !== undefined) {
        connectFlags |= 0x80;
        payload = Buffer.concat([payload, encodeString(cfg.username)]);
      }
      if (cfg.password !== undefined) {
        connectFlags |= 0x40;
        payload = Buffer.concat([payload, encodeString(cfg.password)]);
      }
      const variable = Buffer.alloc(10);
      variable.writeUInt16BE(4, 0);        // MQTT 3.1.1
      variable[2] = 0x4d;                  // 'M'
      variable[3] = 0x51;                  // 'Q'
      variable[4] = 0x54;                  // 'T'
      variable[5] = 0x54;                  // 'T'
      variable[6] = 4;
      variable[7] = connectFlags;
      variable.writeUInt16BE(this.options.keepalive || 30, 8);
      socket.write(packet(1, 0, Buffer.concat([variable, payload])));
    };

    socket.once(cfg.secure ? 'secureConnect' : 'connect', onReady);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => {
      if (this.connected) this.emit('error', err);
      else this.emit('connect-error', err);
      this.teardown(false);
    });
    socket.on('close', () => {
      const was = this.connected;
      this.teardown(false);
      if (was) this.emit('offline');
    });
    socket.setNoDelay(true);
    socket.setTimeout(90000, () => {
      try { socket.destroy(); } catch (e) { /* ignore */ }
    });
  }

  teardown(manual) {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    const was = this.connected;
    this.connected = false;
    this.socket = null;
    if (was && !manual) this.emit('disconnected');
    if (!this.closedByUser) this.scheduleReconnect();
  }

  scheduleReconnect() {
    clearTimeout(this.timer);
    const delay = Math.min(this.options.reconnectMax, this.options.reconnectMin * Math.pow(1.7, this.retry++));
    this.timer = setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, Math.round(delay));
    if (this.timer.unref) this.timer.unref();
  }

  subscribe(topic) {
    this.subscriptions.push(topic);
    if (this.connected) this.sendSubscribe(topic);
  }

  sendSubscribe(topic) {
    const id = this.nextId();
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(id, 0);
    const body = Buffer.concat([payload, encodeString(topic), Buffer.from([0x00])]); // QoS 0
    this.write(packet(8, 0x02, body));
  }

  publish(topic, message) {
    if (!this.connected) return false;
    const body = Buffer.concat([encodeString(topic), Buffer.from(String(message), 'utf8')]);
    this.write(packet(3, 0x00, body));
    return true;
  }

  nextId() {
    this.packetId = this.packetId % 65535 + 1;
    return this.packetId;
  }

  write(buf) {
    if (!this.socket) return false;
    try {
      this.socket.write(buf);
      return true;
    } catch (e) {
      return false;
    }
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      let multiplier = 1;
      let remaining = 0;
      let pos = 1;
      let digit = 0;
      let ok = false;
      while (pos < this.buffer.length && pos <= 4) {
        digit = this.buffer[pos++];
        remaining += (digit & 0x7f) * multiplier;
        multiplier *= 128;
        if ((digit & 0x80) === 0) { ok = true; break; }
      }
      if (!ok) return;
      if (this.buffer.length < pos + remaining) return;
      const type = this.buffer[0] >> 4;
      const flags = this.buffer[0] & 0x0f;
      const payload = this.buffer.slice(pos, pos + remaining);
      this.buffer = this.buffer.slice(pos + remaining);
      this.handlePacket(type, flags, payload);
    }
  }

  handlePacket(type, flags, payload) {
    if (type === 2) { // CONNACK
      const rc = payload.length >= 2 ? payload[1] : 1;
      if (rc === 0) {
        this.connected = true;
        this.retry = 0;
        this.emit('connected');
        this.startPing();
        for (const t of this.subscriptions) this.sendSubscribe(t);
      } else {
        this.emit('connect-refused', rc);
        this.teardown(false);
      }
      return;
    }
    if (type === 3) { // PUBLISH
      const qos = (flags >> 1) & 0x03;
      let off = 0;
      const topicLen = payload.readUInt16BE(off); off += 2;
      const topic = payload.slice(off, off + topicLen).toString('utf8'); off += topicLen;
      if (qos > 0) {
        const id = payload.readUInt16BE(off); off += 2;
        if (qos === 1) this.write(Buffer.from([0x40, 0x02, id >> 8, id & 0xff]));
      }
      const msg = payload.slice(off);
      this.emit('message', topic, msg);
      return;
    }
    if (type === 9) { // SUBACK
      this.emit('subscribed');
      return;
    }
    if (type === 13) return; // PINGRESP
  }

  startPing() {
    clearInterval(this.pingTimer);
    const period = Math.max(10, (this.options.keepalive || 30) - 5) * 1000;
    this.pingTimer = setInterval(() => {
      if (this.connected) this.write(Buffer.from([0xc0, 0x00]));
    }, period);
    if (this.pingTimer.unref) this.pingTimer.unref();
  }
}

module.exports = { MqttClient };
