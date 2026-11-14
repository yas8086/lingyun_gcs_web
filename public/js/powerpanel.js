'use strict';

/* 电源控制面板：6 组指令 / 双步与三级确认 / ACK 结果 / 审计条 */
(function () {
  const App = window.App;

  const GROUPS = [
    {
      title: '一键全断', risk: '极高',
      items: [{ id: 'alloff', label: 'MPPT→DCDC→BMS 全断', kind: 'alloff', effect: '按能量输入→母线路径→源头顺序全断（顺序由机载内置，无需地面站编排）' }]
    },
    {
      title: '主电池 102S', risk: '高',
      items: [
        { id: 'bms_off', label: '切断输出 POWER_OFF', cmd: 'bms_power', params: { command: 'POWER_OFF' }, danger: true, effect: '切断主电池输出：48V 母线将由 14S 备用电池兜底，机载存活' },
        { id: 'bms_on', label: '恢复输出 POWER_ON', cmd: 'bms_power', params: { command: 'POWER_ON' }, recovery: true, effect: '恢复主电池输出（机载联锁较严，需上电放行 power_on_allowed）' },
        { id: 'bms_acc', label: 'AC 截断 ACC_CUTOFF', cmd: 'bms_power', params: { command: 'ACC_CUTOFF' }, danger: true, effect: 'AC 截断（应急方向）' }
      ]
    },
    {
      title: '母线路径 DCDC', risk: '高',
      items: [
        { id: 'dcdc_off', label: '切断母线路径 POWER_OFF', cmd: 'dcdc_power', params: { command: 'POWER_OFF' }, danger: true, effect: '断开主电池→母线的 DCDC 变换路径；主 BMS 遥测保留（源头可观测）' },
        { id: 'dcdc_on', label: '恢复母线路径 POWER_ON', cmd: 'dcdc_power', params: { command: 'POWER_ON' }, recovery: true, effect: '恢复母线路径（需上电放行 power_on_allowed）' }
      ]
    },
    {
      title: 'DCDC 设定', risk: '中',
      items: [
        { id: 'dcdc_set', label: '输出电压 / 限流设定', kind: 'dcdc', effect: '设置 DCDC 输出电压与限流（额定 50V/20A = 1000W 预算）' }
      ]
    },
    {
      title: '光伏充电 MPPT', risk: '中',
      items: [
        { id: 'charge_off', label: '停止充电 CHARGE_OFF', cmd: 'mppt_charge', params: { command: 'CHARGE_OFF' }, danger: true, effect: '停止光伏充电（应急方向，仅需确认 + MPPT 在线）' },
        { id: 'charge_on', label: '恢复充电 CHARGE_ON', cmd: 'mppt_charge', params: { command: 'CHARGE_ON' }, recovery: true, effect: '恢复光伏充电（双重联锁：上电方向放行 且 主 BMS 在线）' }
      ]
    },
    {
      title: 'MPPT 配置写', risk: '高',
      items: [
        { id: 'mppt_write', label: '配置段写入（高级）', kind: 'mppt', effect: '整段 4×U16 写入 code 1–13；非 code=1 段（充电电压/设备地址/恢复出厂）需高级模式' }
      ]
    }
  ];

  let modal = null;
  let audit = [];
  let powerResultHandler = null;

  function powerOnAllowed() {
    const st = App.state.status || {};
    if (!st.safetyFresh) return { state: -1, text: '遥测超时（>3 秒），恢复类指令保守置灰' };
    const v = (App.state.telemetry || {}).power_on_allowed;
    if (v === true) return { state: 1, text: '上电放行（power_on_allowed=true）' };
    if (v === false) return { state: 0, text: '存在设备故障，恢复被禁止（power_on_allowed=false）' };
    return { state: -1, text: '未收到上电放行字段，恢复类指令保守置灰' };
  }

  function open() {
    if (modal) { modal.close(); modal = null; }
    let selected = null;
    let checked = false;
    let textOk = '';
    let busy = false;
    let allOffRpi = false;
    let result = '';
    let resultType = '';

    const body = document.createElement('div');
    body.style.padding = '0';
    body.style.overflow = 'hidden';
    body.style.flex = '1 1 auto';
    body.style.display = 'flex';
    body.innerHTML = `
      <div class="power-body" style="flex:1 1 auto;width:100%">
        <div class="power-left" id="pwrLeft"></div>
        <div class="power-right" id="pwrRight"></div>
      </div>
      <div class="power-foot"><span class="mono" id="pwrUplink">上行通道：--</span><div class="grow"></div><span id="pwrAudit"></span></div>`;

    // 左栏
    const left = body.querySelector('#pwrLeft');
    left.innerHTML = GROUPS.map((g, gi) =>
      '<div class="power-group-title">' + App.esc(g.title) + '<span class="risk ' + (g.risk === '极高' || g.risk === '高' ? 'high' : '') + '">' + g.risk + '</span></div>'
      + g.items.map((it, ii) =>
        '<button class="power-item ' + (it.danger ? 'danger' : '') + '" data-g="' + gi + '" data-i="' + ii + '">' + App.esc(it.label) + '</button>'
      ).join('')
    ).join('');

    const right = body.querySelector('#pwrRight');

    function currentItem() {
      if (!selected) return null;
      return GROUPS[selected.g].items[selected.i];
    }

    function gateText() {
      const allowed = powerOnAllowed();
      return allowed;
    }

    function selectedCommand() {
      const it = currentItem();
      if (!it) return null;
      if (it.kind === 'dcdc') return { cmd: 'dcdc_set_output', params: { voltage: Number(right.querySelector('#dcdcVolt').value), current: Number(right.querySelector('#dcdcCur').value) } };
      if (it.kind === 'mppt') {
        const vals = Array.from({ length: 4 }, (_, i) => parseInt(right.querySelector('#mw' + i).value, 10) || 0);
        return { cmd: 'mppt_write', params: { code: parseInt(right.querySelector('#mpptCode').value, 10) || 1, values: vals } };
      }
      if (it.kind === 'alloff') return { cmd: 'power_all_off', params: { include_rpi: allOffRpi } };
      return { cmd: it.cmd, params: Object.assign({}, it.params) };
    }

    function tier() {
      const it = currentItem();
      if (!it) return 2;
      if (it.kind === 'alloff') return allOffRpi ? 3 : 2;
      return 2;
    }

    function recoveryBlocked(it) {
      if (!it || !it.recovery) return false;
      return gateText().state !== 1;
    }

    function renderRight() {
      const it = currentItem();
      if (!it) {
        right.innerHTML = '<div class="set-note" style="margin:auto;text-align:center">左侧选择一条电源指令<br>所有下发都会记录审计并等待机载 ACK</div>';
        return;
      }
      const blocked = recoveryBlocked(it);
      const allowed = gateText();
      right.innerHTML = `
        <div style="font-size:15px;font-weight:700">${App.esc(it.label)}</div>
        <div class="power-effect">${App.esc(it.effect)}</div>
        ${it.recovery ? '<div class="set-note" style="color:' + (blocked ? 'var(--err)' : 'var(--ok)') + '">' + App.esc(allowed.text) + '</div>' : ''}
        ${it.kind === 'dcdc' ? `
          <div class="set-group">
            <div class="set-row"><span class="label">输出电压 (V)</span><input class="set-field" id="dcdcVolt" type="number" value="50" step="0.1"></div>
            <div class="set-row"><span class="label">输出限流 (A)</span><input class="set-field" id="dcdcCur" type="number" value="20" step="0.1"></div>
          </div>` : ''}
        ${it.kind === 'mppt' ? `
          <div class="set-group">
            <div class="set-row"><span class="label">配置段 code</span><input class="set-field" id="mpptCode" type="number" value="1" min="1" max="13"></div>
            <div class="set-row"><span class="label">值 1 (U16)</span><input class="set-field" id="mw0" type="number" value="0"></div>
            <div class="set-row"><span class="label">值 2 (U16)</span><input class="set-field" id="mw1" type="number" value="0"></div>
            <div class="set-row"><span class="label">值 3 (U16)</span><input class="set-field" id="mw2" type="number" value="65280"></div>
            <div class="set-row"><span class="label">值 4 (U16)</span><input class="set-field" id="mw3" type="number" value="100"></div>
          </div>` : ''}
        ${it.kind === 'alloff' ? `
          <div class="set-group">
            <div class="set-row"><span class="label">同时切断机载计算机电源</span>
              <label class="switch"><input type="checkbox" id="chkRpi" ${allOffRpi ? 'checked' : ''}><span class="slider"></span></label>
            </div>
            <div class="set-note">开启后升级为三级确认（勾选 → 输入「全断」→ 滑动提交），指令将关闭机载计算机，地面站随即失联。</div>
          </div>` : ''}
        <div class="power-confirm">
          <label class="check-line"><input type="checkbox" id="chkAck" ${checked ? 'checked' : ''}> 我已知晓该指令的后果，并确认执行</label>
          ${tier() >= 3 ? '<div class="set-row"><span class="label" style="width:auto">输入「全断」确认</span><input class="set-field" id="txtConfirm" style="width:110px;flex:0 0 110px" value="' + App.esc(textOk) + '"></div>' : ''}
          <div class="power-slider ${blocked || busy ? 'disabled' : ''}" id="slider">
            <div class="fill"></div>
            <div class="knob">提交</div>
            <div class="hint">${blocked ? '恢复被禁止' : busy ? '等待机载应答…' : '按住滑块向右拖动以提交'}</div>
          </div>
        </div>
        <div class="power-result ${resultType}" id="pwrResult">${App.esc(result || '尚未下发指令')}</div>
        <div class="set-note">单设备 OFF / dcdc_set_output / power_all_off（不含机载计算机）为双步确认；超时（2s×3）提示结果以下传遥测为准。</div>`;

      const chkRpi = right.querySelector('#chkRpi');
      if (chkRpi) {
        chkRpi.addEventListener('change', () => {
          allOffRpi = chkRpi.checked;
          renderRight();
        });
      }
      const chkAck = right.querySelector('#chkAck');
      if (chkAck) chkAck.addEventListener('change', () => { checked = chkAck.checked; });
      const txt = right.querySelector('#txtConfirm');
      if (txt) txt.addEventListener('input', () => { textOk = txt.value; });
      bindSlider(blocked);
    }

    let sliderMove = null;
    let sliderUp = null;

    function unbindSlider() {
      if (sliderMove) window.removeEventListener('mousemove', sliderMove);
      if (sliderUp) window.removeEventListener('mouseup', sliderUp);
      sliderMove = null;
      sliderUp = null;
    }

    function bindSlider(blocked) {
      unbindSlider();
      const slider = right.querySelector('#slider');
      if (!slider) return;
      const knob = slider.querySelector('.knob');
      const fill = slider.querySelector('.fill');
      let dragging = false;
      let startX = 0;
      let x = 2;

      function setX(v) {
        const max = Math.max(2, slider.clientWidth - knob.clientWidth - 8);
        x = Math.max(2, Math.min(max, v));
        knob.style.left = x + 'px';
        fill.style.width = x + 'px';
      }
      knob.addEventListener('mousedown', (e) => {
        if (blocked || busy) return;
        dragging = true;
        startX = e.clientX - x;
        e.preventDefault();
      });
      sliderMove = (e) => {
        if (!dragging) return;
        setX(e.clientX - startX);
      };
      sliderUp = () => {
        if (!dragging) return;
        dragging = false;
        const max = Math.max(2, slider.clientWidth - knob.clientWidth - 8);
        if (x >= max * 0.72 && checked && (tier() < 3 || textOk.trim() === '全断')) {
          submit();
        } else {
          setX(2);
          fill.style.width = '0';
        }
      };
      window.addEventListener('mousemove', sliderMove);
      window.addEventListener('mouseup', sliderUp);
      setTimeout(() => setX(2), 0);
    }

    async function submit() {
      const it = currentItem();
      if (!it || busy) return;
      if (recoveryBlocked(it)) {
        result = '恢复被禁止：' + gateText().text;
        resultType = 'err';
        renderRight();
        return;
      }
      if (tier() >= 3 && textOk.trim() !== '全断') {
        result = '请输入「全断」以完成三级确认';
        resultType = 'err';
        renderRight();
        return;
      }
      const sc = selectedCommand();
      busy = true;
      result = '正在下发 ' + sc.cmd + ' …';
      resultType = '';
      renderRight();
      try {
        const resp = await App.api.post('/api/command', sc);
        const data = resp.data || {};
        if (!resp.ok || data.sent === false) {
          busy = false;
          result = '未发出：' + (data.message || ('HTTP ' + resp.status));
          resultType = 'err';
          App.toast('电源指令未发出：' + (data.message || '通道不可用'), 'err');
        } else {
          result = '已下发 ' + sc.cmd + '（req_id=' + data.req_id + '），等待机载 ACK…';
          resultType = '';
          audit.unshift(App.fmtClock() + '  ' + sc.cmd + '  req_id=' + data.req_id + '  已下发');
          if (audit.length > 5) audit.length = 5;
          paintAudit();
        }
      } catch (e) {
        busy = false;
        result = '下发失败：' + e.message;
        resultType = 'err';
      }
      renderRight();
    }

    function paintUplink() {
      const el = body.querySelector('#pwrUplink');
      const st = App.state.status || {};
      if (!el) return;
      el.textContent = '上行通道：' + (st.commandsEnabled
        ? '已连接（服务端 MQTT 指令通道）'
        : '未开放（服务端未配置指令下行，仅遥测）');
      el.style.color = st.commandsEnabled ? 'var(--ok)' : 'var(--text2)';
    }

    function paintAudit() {
      const el = body.querySelector('#pwrAudit');
      if (el) el.textContent = audit.length ? ('最近：' + audit[0]) : '本次操作暂无审计记录';
    }

    left.addEventListener('click', (e) => {
      const btn = e.target.closest('.power-item');
      if (!btn) return;
      selected = { g: Number(btn.dataset.g), i: Number(btn.dataset.i) };
      const it = currentItem();
      checked = false;
      textOk = '';
      result = '';
      resultType = '';
      busy = false;
      if (it.kind === 'alloff') allOffRpi = false;
      left.querySelectorAll('.power-item').forEach((b) => b.classList.toggle('active', b === btn));
      renderRight();
      paintUplink();
    });

    powerResultHandler = (ev) => {
      const r = ev.detail || {};
      if (!r.cmd) return;
      const it = currentItem();
      const myCmd = it ? (it.cmd || (it.kind === 'alloff' ? 'power_all_off' : it.kind === 'dcdc' ? 'dcdc_set_output' : it.kind === 'mppt' ? 'mppt_write' : '')) : '';
      if (myCmd && r.cmd !== myCmd) return;
      busy = false;
      result = (r.accepted ? '指令已接受：' : (r.timeout ? '指令无应答：' : '指令被拒绝：')) + r.cmd
        + (r.message ? '\n' + r.message : '')
        + '\n尝试 ' + (r.attempts || 1) + ' 次 / ' + (r.elapsedMs || 0) + ' ms';
      resultType = r.accepted ? 'ok' : 'err';
      audit.unshift(App.fmtClock() + '  ' + r.cmd + '  ' + (r.accepted ? '已接受' : (r.timeout ? '无应答' : '被拒绝')));
      if (audit.length > 5) audit.length = 5;
      paintAudit();
      renderRight();
      App.toast((r.accepted ? '电源指令已接受：' : (r.timeout ? '电源指令无应答：' : '电源指令被拒绝：')) + r.cmd, r.accepted ? 'ok' : (r.timeout ? 'warn' : 'err'));
    };
    document.addEventListener('gcs-power-result', powerResultHandler);

    modal = App.modal({
      title: '电源控制',
      cardClass: 'power-modal',
      closeOnMask: true,
      body,
      onClose() {
        unbindSlider();
        document.removeEventListener('gcs-power-result', powerResultHandler);
        powerResultHandler = null;
        modal = null;
      }
    });

    paintUplink();
    paintAudit();
    renderRight();
  }

  App.PowerPanel = { open };
})();
