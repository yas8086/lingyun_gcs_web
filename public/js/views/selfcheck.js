'use strict';

/* 自检页 + 自检引擎（11 项内置 + 自定义项，localStorage 持久化） */
(function () {
  const App = window.App;
  const LS_KEY = 'lingyun_gcs_web_checks_v1';

  const DEFAULT_ITEMS = [
    { id: 'bms_online', dev: 'BMS', name: '链路在线', fid: '', unit: '', mode: 'none', cmp: 'gt', min: null, max: null, val: null, en: true },
    { id: 'bms_packv', dev: 'BMS', name: '总压正常', fid: 'pack_v', unit: 'V', mode: 'range', cmp: 'gt', min: 360, max: 380, val: null, en: true },
    { id: 'bms_soc', dev: 'BMS', name: 'SOC 充足', fid: 'soc', unit: '%', mode: 'single', cmp: 'gt', min: null, max: null, val: 30, en: true },
    { id: 'bms_maxt', dev: 'BMS', name: '最高温度', fid: 'max_t', unit: '℃', mode: 'single', cmp: 'lt', min: null, max: null, val: 50, en: true },
    { id: 'bms_diffv', dev: 'BMS', name: '单体压差', fid: 'diff_v', unit: 'V', mode: 'single', cmp: 'lte', min: null, max: null, val: 0.05, en: true },
    { id: 'mppt_online', dev: 'MPPT', name: '链路在线', fid: '', unit: '', mode: 'none', cmp: 'gt', min: null, max: null, val: null, en: true },
    { id: 'mppt_pvv', dev: 'MPPT', name: '光伏电压', fid: 'pv_v', unit: 'V', mode: 'range', cmp: 'gt', min: 20, max: 120, val: null, en: true },
    { id: 'mppt_chargei', dev: 'MPPT', name: '充电电流', fid: 'charge_i', unit: 'A', mode: 'single', cmp: 'gt', min: null, max: null, val: 0, en: true },
    { id: 'dcdc_online', dev: 'DCDC', name: '链路在线', fid: '', unit: '', mode: 'none', cmp: 'gt', min: null, max: null, val: null, en: true },
    { id: 'dcdc_outv', dev: 'DCDC', name: '输出电压', fid: 'out_v', unit: 'V', mode: 'range', cmp: 'gt', min: 40, max: 60, val: null, en: true },
    { id: 'dcdc_temp', dev: 'DCDC', name: '散热温度', fid: 'temp', unit: '℃', mode: 'single', cmp: 'lt', min: null, max: null, val: 45, en: true }
  ];

  const DEVICES = [
    { label: 'BMS', dev: 'BMS' },
    { label: 'MPPT 1', dev: 'MPPT1' },
    { label: 'MPPT 2', dev: 'MPPT2' },
    { label: 'DCDC', dev: 'DCDC' },
    { label: '备用电源', dev: '备用电源' },
    { label: '飞控', dev: '飞控' }
  ];

  const FID_DICT = {
    BMS: [
      ['总压 (pack_v)', 'pack_v', 'V'], ['电流 (pack_i)', 'pack_i', 'A'], ['SOC (soc)', 'soc', '%'],
      ['剩余电量 (rsoc)', 'rsoc', '%'], ['SOH (soh)', 'soh', '%'], ['最高单体电压 (max_v)', 'max_v', 'V'],
      ['最低单体电压 (min_v)', 'min_v', 'V'], ['单体压差 (diff_v)', 'diff_v', 'V'], ['最高温度 (max_t)', 'max_t', '℃'],
      ['最低温度 (min_t)', 'min_t', '℃'], ['平均温度 (avg_t)', 'avg_t', '℃'], ['单体温差 (diff_t)', 'diff_t', '℃'],
      ['正极对地电阻 (riso_p)', 'riso_p', ''], ['负极对地电阻 (riso_n)', 'riso_n', ''], ['告警码 (alarm)', 'alarm', ''],
      ['故障码1 (fault1)', 'fault1', ''], ['故障码2 (fault2)', 'fault2', ''], ['故障码3 (fault3)', 'fault3', '']
    ],
    MPPT1: [
      ['光伏电压 (pv_v)', 'pv_v', 'V'], ['光伏功率 (pv_p)', 'pv_p', 'W'], ['电池电压 (batt_v)', 'batt_v', 'V'],
      ['充电电流 (charge_i)', 'charge_i', 'A'], ['环境温度 (air_t)', 'air_t', '℃'], ['组件温度 (mod_t)', 'mod_t', '℃'],
      ['今日发电 (today)', 'today', ''], ['本月发电 (month)', 'month', ''], ['累计发电 (total)', 'total', ''],
      ['额定电压 (rated_v)', 'rated_v', 'V'], ['额定电流 (rated_i)', 'rated_i', 'A'], ['状态码 (cs)', 'cs', ''],
      ['工作模式 (mode)', 'mode', ''], ['充电使能 (chg_on)', 'chg_on', ''], ['故障码 (fault)', 'fault', '']
    ],
    DCDC: [
      ['输入电压 (in_v)', 'in_v', 'V'], ['输出电压 (out_v)', 'out_v', 'V'], ['输出电流 (out_i)', 'out_i', 'A'],
      ['输出功率 (out_p)', 'out_p', 'W'], ['温度 (temp)', 'temp', '℃'], ['故障码 (fault)', 'fault', ''], ['输出使能 (enabled)', 'enabled', '']
    ],
    '备用电源': [
      ['总压 (pack_v)', 'pack_v', 'V'], ['电流 (pack_i)', 'pack_i', 'A'], ['SOC (soc)', 'soc', '%'], ['SOH (soh)', 'soh', '%'],
      ['最高单体电压 (max_v)', 'max_v', 'V'], ['最低单体电压 (min_v)', 'min_v', 'V'], ['单体压差 (diff_v)', 'diff_v', 'V'],
      ['最高温度 (max_t)', 'max_t', '℃'], ['最低温度 (min_t)', 'min_t', '℃'], ['平均温度 (avg_t)', 'avg_t', '℃'],
      ['单体温差 (diff_t)', 'diff_t', '℃'], ['告警码 (alarm)', 'alarm', ''], ['故障码 (fault)', 'fault', ''], ['系统状态 (sys)', 'sys', '']
    ],
    '飞控': [
      ['横滚 (roll)', 'roll', '°'], ['俯仰 (pitch)', 'pitch', '°'], ['航向 (yaw)', 'yaw', '°'], ['高度 (alt)', 'alt', 'm'],
      ['爬升率 (climb)', 'climb', 'm/s'], ['空速 (airspd)', 'airspd', 'm/s'], ['真空速 (tas)', 'tas', 'm/s'],
      ['地速 (gs)', 'gs', 'm/s'], ['油门 (thr)', 'thr', '%'], ['电池电压 (batt_v)', 'batt_v', 'V'],
      ['电池电量 (batt_pct)', 'batt_pct', '%'], ['GPS 定位状态 (gps_fix)', 'gps_fix', ''], ['GPS 卫星数 (gps_sat)', 'gps_sat', ''],
      ['GPS 水平精度 (gps_eph)', 'gps_eph', ''], ['GPS 垂直精度 (gps_epv)', 'gps_epv', ''], ['EKF 位置 (ekf_pos)', 'ekf_pos', ''],
      ['EKF 毛刺 (ekf_glitch)', 'ekf_glitch', ''], ['EKF 加速度误差 (ekf_accel_err)', 'ekf_accel_err', ''], ['解锁状态 (armed)', 'armed', '']
    ]
  };
  FID_DICT.MPPT2 = FID_DICT.MPPT1;

  function devKeyOf(dev) {
    const d = String(dev || '').trim();
    const map = {
      'BMS': 'bms', 'MPPT': 'mppt1', 'MPPT1': 'mppt1', 'MPPT 1': 'mppt1',
      'MPPT2': 'mppt2', 'MPPT 2': 'mppt2', 'DCDC': 'dcdc', '备用电源': 'backup', '飞控': 'fc'
    };
    return map[d] || d.toLowerCase();
  }

  function fidOf(dev, fid) {
    if (dev === '飞控') {
      const map = {
        gps_fix: ['gps', 'fix'], gps_sat: ['gps', 'sat'], gps_eph: ['gps', 'eph'], gps_epv: ['gps', 'epv'],
        ekf_pos: ['ekf', 'const_pos'], ekf_glitch: ['ekf', 'glitch'], ekf_accel_err: ['ekf', 'accel_err']
      };
      if (map[fid]) {
        const d = App.dev('fc');
        const sub = d[map[fid][0]];
        return sub && typeof sub[map[fid][1]] === 'number' ? sub[map[fid][1]] : NaN;
      }
    }
    return App.val(devKeyOf(dev), fid);
  }

  function fmtVal(def, v) {
    const unit = def.unit || '';
    if (def.mode === 'range') return def.min + '~' + def.max + ' ' + unit;
    const sym = { gt: '> ', lt: '< ', gte: '≥ ', lte: '≤ ' }[def.cmp || 'gt'];
    return sym + def.val + unit;
  }

  function fmtCur(def, v) {
    const dp = (def.fid === 'diff_v' || def.fid === 'diff_t' || Math.abs(v) < 10) ? 2 : 1;
    return Number(v).toFixed(dp) + (def.unit || '');
  }

  function evaluate(def) {
    if (!def.en) return { ok: null, val: '已停用' };
    const mode = def.mode;
    if (mode === 'none') return { ok: App.online(devKeyOf(def.dev)), val: '在线' };
    const v = fidOf(def.dev, def.fid);
    if (!Number.isFinite(v)) return { ok: false, val: '—' };
    let ok;
    if (mode === 'range') {
      ok = v >= Number(def.min) && v <= Number(def.max);
    } else {
      const th = Number(def.val);
      ok = def.cmp === 'lt' ? v < th : def.cmp === 'gte' ? v >= th : def.cmp === 'lte' ? v <= th : v > th;
    }
    return { ok, val: fmtCur(def, v) };
  }

  const CheckEngine = {
    items: [],
    checkedOnce: false,
    failCount: 0,
    init() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
      if (Array.isArray(saved) && saved.length) {
        this.items = saved.map((x) => Object.assign({}, x, { custom: x.custom === true }));
      } else {
        this.items = DEFAULT_ITEMS.map((x) => Object.assign({}, x));
      }
      this.runAll();
    },
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.items.map((x) => {
          const o = Object.assign({}, x);
          delete o.st; delete o.cur; delete o.th;
          return o;
        })));
      } catch (e) { /* ignore */ }
    },
    runAll() {
      let fails = 0;
      let enabled = 0;
      for (const def of this.items) {
        const r = evaluate(def);
        if (def.en) enabled++;
        def.st = !def.en ? 'skip' : (r.ok ? 'pass' : 'fail');
        def.cur = r.val;
        def.th = def.mode === 'none' ? '' : fmtVal(def, null);
        if (def.st === 'fail') fails++;
      }
      this.failCount = fails;
      this.enabledCount = enabled;
      this.checkedOnce = true;
    },
    readyLevel() {
      if (!this.checkedOnce) return 0;
      if (this.enabledCount === 0) return 0;
      return this.failCount === 0 ? 1 : (this.failCount <= 1 ? 2 : 3);
    },
    state() {
      return this.items.filter((x) => x.en).map((x) => ({
        dev: x.dev, name: x.name, pass: x.st === 'pass', val: x.cur
      }));
    },
    addItem(patch) {
      const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      this.items.push(Object.assign({ id, custom: true }, patch));
      this.persist();
      this.runAll();
    },
    setItem(id, patch) {
      const item = this.items.find((x) => x.id === id);
      if (!item) return;
      Object.assign(item, patch);
      this.persist();
      this.runAll();
    },
    removeItem(id) {
      this.items = this.items.filter((x) => x.id !== id);
      this.persist();
      this.runAll();
    }
  };

  App.CheckEngine = CheckEngine;

  // ================= 页面 =================
  function gearSvg() { return '<span class="icon" style="-webkit-mask-image:url(img/check-gear.svg);mask-image:url(img/check-gear.svg)"></span>'; }
  function trashSvg() { return '<span class="icon" style="-webkit-mask-image:url(img/check-trash.svg);mask-image:url(img/check-trash.svg)"></span>'; }

  function itemHTML(def, index) {
    const fail = def.st === 'fail';
    const skip = def.st === 'skip';
    return '<div class="check-item ' + (fail ? 'fail ' : '') + (skip ? 'skip' : '') + '" data-idx="' + index + '">'
      + '<span class="st-circle ' + (fail ? 'fail' : skip ? 'skip' : '') + '">' + (fail ? '✕' : skip ? '–' : '✓') + '</span>'
      + '<span class="ci-dev">' + App.esc(def.dev) + '</span>'
      + '<span class="ci-name">' + App.esc(def.name)
      + (skip ? '<span class="tag-mini">已停用</span>' : '') + '</span>'
      + (def.mode !== 'none' && !skip ? '<span class="ci-th">' + App.esc(def.th || '') + '</span>' : '')
      + '<span class="ci-val">' + App.esc(def.cur || '') + '</span>'
      + '<button class="icon-btn" data-act="edit" title="编辑">' + gearSvg() + '</button>'
      + '<button class="icon-btn danger" data-act="del" title="删除">' + trashSvg() + '</button>'
      + (fail ? '<span class="ci-block">阻塞起飞</span>' : '')
      + '</div>';
  }

  function openEditor(def) {
    const isNew = !def || !def.id;
    const draft = Object.assign({ en: true, mode: 'single', cmp: 'gt', val: 0, min: 0, max: 100, name: '', dev: '', fid: '', unit: '', custom: isNew }, def || {});
    const body = document.createElement('div');

    const group = document.createElement('div');
    group.className = 'set-group';
    body.appendChild(group);

    const enRow = document.createElement('label');
    enRow.className = 'check-line';
    enRow.style.padding = '6px 2px';
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = draft.en !== false;
    enRow.appendChild(en);
    enRow.appendChild(document.createTextNode('启用此自检项'));
    group.appendChild(enRow);

    const nameRow = document.createElement('div');
    nameRow.className = 'set-row';
    nameRow.innerHTML = '<span class="label">项目名称</span>';
    const nameInput = document.createElement('input');
    nameInput.className = 'set-field';
    nameInput.maxLength = 20;
    nameInput.placeholder = '如：输入电压';
    nameInput.value = draft.name || '';
    nameRow.appendChild(nameInput);
    if (!isNew && !draft.custom) nameRow.style.display = 'none';
    group.appendChild(nameRow);

    const devRow = document.createElement('div');
    devRow.className = 'set-row';
    devRow.innerHTML = '<span class="label">设备</span>';
    const devSel = document.createElement('select');
    devSel.className = 'set-select';
    for (const d of DEVICES) {
      const o = document.createElement('option');
      o.value = d.dev; o.textContent = d.label;
      devSel.appendChild(o);
    }
    devSel.value = draft.dev || 'BMS';
    devRow.appendChild(devSel);
    if (!isNew && !draft.custom) devRow.style.display = 'none';
    group.appendChild(devRow);

    const fidRow = document.createElement('div');
    fidRow.className = 'set-row';
    fidRow.innerHTML = '<span class="label">数据字段</span>';
    const fidSel = document.createElement('select');
    fidSel.className = 'set-select';
    fidRow.appendChild(fidSel);
    if (!isNew && !draft.custom) fidRow.style.display = 'none';
    group.appendChild(fidRow);

    function fillFids() {
      const list = FID_DICT[devSel.value] || [];
      fidSel.innerHTML = '';
      for (const item of list) {
        const o = document.createElement('option');
        o.value = item[1];
        o.textContent = item[0];
        o.dataset.unit = item[2];
        fidSel.appendChild(o);
      }
      if (draft.fid) fidSel.value = draft.fid;
      if (!fidSel.value && list.length) fidSel.value = list[0][1];
    }
    fillFids();

    const modeRow = document.createElement('div');
    modeRow.className = 'set-row';
    modeRow.innerHTML = '<span class="label">检查方式</span>';
    const modeSel = document.createElement('select');
    modeSel.className = 'set-select';
    modeSel.innerHTML = '<option value="none">无（仅在线）</option><option value="single">单阈值</option><option value="range">范围（下限~上限）</option>';
    modeSel.value = draft.mode || 'single';
    modeRow.appendChild(modeSel);
    group.appendChild(modeRow);

    function row(labelText) {
      const r = document.createElement('div');
      r.className = 'set-row';
      r.innerHTML = '<span class="label">' + labelText + '</span>';
      group.appendChild(r);
      return r;
    }
    function numInput(value) {
      const i = document.createElement('input');
      i.className = 'set-field';
      i.style.width = '110px';
      i.style.flex = '0 0 110px';
      i.type = 'number';
      i.step = 'any';
      i.value = value === null || value === undefined ? '' : value;
      return i;
    }

    const cmpRow = row('比较符');
    const cmpSel = document.createElement('select');
    cmpSel.className = 'set-select';
    cmpSel.innerHTML = '<option value="gt">大于 &gt;</option><option value="lt">小于 &lt;</option><option value="gte">大于等于 ≥</option><option value="lte">小于等于 ≤</option>';
    cmpSel.value = draft.cmp || 'gt';
    cmpRow.appendChild(cmpSel);

    const valRow = row('阈值数值');
    const valInput = numInput(draft.val);
    valRow.appendChild(valInput);
    const unitLbl = document.createElement('span');
    unitLbl.className = 'muted';
    unitLbl.style.fontSize = '12px';
    valRow.appendChild(unitLbl);

    const minRow = row('下限');
    const minInput = numInput(draft.min);
    minRow.appendChild(minInput);
    const minUnit = document.createElement('span');
    minUnit.className = 'muted'; minUnit.style.fontSize = '12px';
    minRow.appendChild(minUnit);

    const maxRow = row('上限');
    const maxInput = numInput(draft.max);
    maxRow.appendChild(maxInput);
    const maxUnit = document.createElement('span');
    maxUnit.className = 'muted'; maxUnit.style.fontSize = '12px';
    maxRow.appendChild(maxUnit);

    function sync() {
      const mode = modeSel.value;
      const showCustom = isNew || draft.custom;
      nameRow.style.display = showCustom ? '' : 'none';
      devRow.style.display = showCustom ? '' : 'none';
      fidRow.style.display = showCustom ? '' : 'none';
      cmpRow.style.display = mode === 'single' ? '' : 'none';
      valRow.style.display = mode === 'single' ? '' : 'none';
      minRow.style.display = mode === 'range' ? '' : 'none';
      maxRow.style.display = mode === 'range' ? '' : 'none';
      fidSel.disabled = mode === 'none';
      const opt = fidSel.selectedOptions[0];
      const unit = opt ? opt.dataset.unit || '' : '';
      unitLbl.textContent = unit;
      minUnit.textContent = unit;
      maxUnit.textContent = unit;
    }
    devSel.addEventListener('change', () => { fillFids(); sync(); });
    fidSel.addEventListener('change', sync);
    modeSel.addEventListener('change', sync);
    sync();

    const modal = App.modal({
      title: isNew ? '新增自检项' : '自检参数 · ' + draft.dev + ' ' + draft.name,
      body,
      footer: [
        App.button('取消', 'ghost', () => modal.close()),
        App.button('保存', 'primary', () => {
          const mode = modeSel.value;
          const patch = { en: en.checked, mode, cmp: cmpSel.value };
          if (mode === 'single') {
            const v = parseFloat(valInput.value);
            if (!Number.isFinite(v)) { App.toast('请输入有效的阈值数值', 'err'); return; }
            patch.val = v;
          } else if (mode === 'range') {
            const mn = parseFloat(minInput.value);
            const mx = parseFloat(maxInput.value);
            if (!Number.isFinite(mn) || !Number.isFinite(mx)) { App.toast('请输入有效的下限和上限', 'err'); return; }
            if (mn >= mx) { App.toast('下限必须小于上限', 'err'); return; }
            patch.min = mn; patch.max = mx;
          }
          if (isNew || draft.custom) {
            const name = nameInput.value.trim();
            if (!name) { App.toast('请输入项目名称', 'err'); return; }
            patch.name = name;
            patch.dev = devSel.value;
            patch.fid = mode === 'none' ? '' : fidSel.value;
            patch.unit = mode === 'none' ? '' : (fidSel.selectedOptions[0] ? (fidSel.selectedOptions[0].dataset.unit || '') : '');
            if (mode !== 'none' && !patch.fid) { App.toast('请选择数据字段', 'err'); return; }
          }
          if (isNew) CheckEngine.addItem(patch);
          else CheckEngine.setItem(draft.id, patch);
          modal.close();
          App.toast(isNew ? '自检项已添加' : '自检参数已保存');
          App.addLog('info', (isNew ? '新增' : '修改') + '自检项：' + (patch.name || draft.name));
          if (App.state.activeView && App.state.activeView.key === 'selfcheck') App.refreshUI();
        })
      ]
    });
  }

  function askDelete(def) {
    App.confirm({
      title: '删除自检项',
      message: '确定要删除「' + def.dev + ' · ' + def.name + '」吗？',
      detail: '删除后该项不再参与整机自检与就绪度聚合，且不可恢复；如需再用请重新新增配置。',
      okText: '确认删除',
      danger: true,
      onOk() {
        CheckEngine.removeItem(def.id);
        App.toast('已删除自检项：' + def.dev + ' · ' + def.name);
        App.addLog('info', '删除自检项：' + def.dev + ' · ' + def.name);
        if (App.state.activeView && App.state.activeView.key === 'selfcheck') App.refreshUI();
      }
    });
  }

  function render(container) {
    container.innerHTML = `
      <div class="card check-panel">
        <div class="check-head">
          <div class="check-title">系统自检 · 起飞前检查</div>
          <div class="grow"></div>
          <span class="result-pill" id="checkResult">未自检</span>
          <button class="btn ghost" id="btnAddCheck">＋ 新增自检项</button>
          <button class="btn primary" id="btnRecheck">重新自检</button>
        </div>
        <div class="check-list" id="checkList"></div>
      </div>`;

    const list = container.querySelector('#checkList');
    const result = container.querySelector('#checkResult');
    let lastSig = '';

    function paint() {
      const level = CheckEngine.readyLevel();
      result.textContent = !CheckEngine.checkedOnce ? '未自检'
        : CheckEngine.failCount === 0 ? '全部通过' : '有项未通过';
      result.className = 'result-pill ' + (!CheckEngine.checkedOnce ? '' : CheckEngine.failCount === 0 ? 'ok' : 'err');
      const sig = CheckEngine.items.map((d) => [d.id, d.st, d.cur, d.en, d.mode, d.val, d.min, d.max].join('|')).join(';');
      if (sig === lastSig) return;
      lastSig = sig;
      list.innerHTML = CheckEngine.items.map(itemHTML).join('');
      list.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = CheckEngine.items[Number(btn.closest('.check-item').dataset.idx)];
          if (!item) return;
          if (btn.dataset.act === 'edit') openEditor(item);
          else askDelete(item);
        });
      });
    }

    container.querySelector('#btnAddCheck').addEventListener('click', () => openEditor(null));
    container.querySelector('#btnRecheck').addEventListener('click', () => {
      CheckEngine.runAll();
      App.addLog('info', CheckEngine.failCount === 0
        ? '整机自检：全部通过' : '整机自检：' + CheckEngine.failCount + ' 项未通过', '自检');
      paint();
    });

    const timer = setInterval(paint, 1000);
    paint();

    return {
      key: 'selfcheck',
      update() { paint(); },
      destroy() { clearInterval(timer); }
    };
  }

  App.viewsRegistry = App.viewsRegistry || {};
  App.viewsRegistry.selfcheck = { render };
})();
