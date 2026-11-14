'use strict';

/* 设置页：显示与主题 / 监控模块 / 配置备份 */
(function () {
  const App = window.App;

  const MODULES = [
    ['strip', '飞艇横幅'],
    ['mppt_main', '主囊 MPPT'],
    ['mppt_sub', '副囊 MPPT'],
    ['bms', '102S 主电源'],
    ['backup', '14S 备用电源'],
    ['dcdc', 'DCDC 电源模块'],
    ['temp', '温度采集'],
    ['pressure', '气压采集'],
    ['log', '运行日志']
  ];

  function accentDot(color, key) {
    return '<button class="accent-dot" data-accent="' + key + '" style="background:' + color + '" title="' + key + '"></button>';
  }

  function render(container) {
    container.innerHTML = `
      <div class="settings-view" id="settingsView">
        <div class="card set-card">
          <div class="set-title">显示与主题</div>
          <div class="set-row"><span class="label">温度单位</span>
            <select class="set-select" id="selTempUnit">
              <option value="0">℃（摄氏度）</option>
              <option value="1">℉（华氏度）</option>
            </select>
          </div>
          <div class="set-row"><span class="label">气压单位</span>
            <select class="set-select" id="selPresUnit">
              <option value="0">kPa</option>
              <option value="1">Pa</option>
              <option value="2">bar</option>
              <option value="3">psi</option>
            </select>
          </div>
          <div class="set-row"><span class="label">高对比度</span>
            <label class="switch"><input type="checkbox" id="chkContrast"><span class="slider"></span></label>
          </div>
          <div class="set-row"><span class="label">强调色</span>
            <div class="accent-row" id="accentRow">
              ${accentDot('#2563eb', 'blue')}${accentDot('#059669', 'green')}${accentDot('#ea580c', 'orange')}${accentDot('#7c3aed', 'purple')}${accentDot('#0d9488', 'teal')}
            </div>
          </div>
          <div class="set-note">主题与字体大小在顶栏切换（快捷键 T / D）；气压原始值为 Pa，温度原始值为 ℃。</div>
        </div>

        <div class="card set-card">
          <div class="set-head">
            <div class="set-title">监控模块</div>
            <button class="btn small ghost" id="btnShowAll">全部显示</button>
          </div>
          <div class="set-note">取消勾选即可隐藏对应的监控模块，隐藏后数据仍在后台采集。</div>
          <div class="module-grid" id="moduleList"></div>
        </div>

        <div class="card set-card span-2">
          <div class="set-title">配置备份</div>
          <div class="set-note">主题、显示单位与模块可见性保存在当前浏览器；导出后可在其他浏览器或设备导入复用。</div>
          <div class="set-note" id="mqttSetupHint"></div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button class="btn small" id="btnExportCfg">导出配置</button>
            <button class="btn small ghost" id="btnImportCfg">导入配置</button>
            <button class="btn small ghost" id="btnResetCfg" style="color:var(--err)">恢复默认设置</button>
            <input type="file" id="fileImport" accept="application/json" class="hidden">
          </div>
        </div>
      </div>`;

    container.querySelector('#selTempUnit').value = String(App.state.units.temp);
    container.querySelector('#selPresUnit').value = String(App.state.units.pressure);
    container.querySelector('#chkContrast').checked = !!App.state.theme.contrast;

    function paintAccent() {
      container.querySelectorAll('[data-accent]').forEach((b) => b.classList.toggle('active', b.dataset.accent === App.state.theme.accent));
    }
    paintAccent();

    container.querySelectorAll('[data-accent]').forEach((b) => {
      b.addEventListener('click', () => {
        App.state.theme.accent = b.dataset.accent;
        App.themeChanged();
        App.saveSettings();
        paintAccent();
        App.toast('强调色已切换：' + b.dataset.accent);
      });
    });

    container.querySelector('#selTempUnit').addEventListener('change', (e) => {
      App.state.units.temp = Number(e.target.value);
      App.saveSettings();
      App.refreshUI();
      App.toast('温度单位已切换');
    });
    container.querySelector('#selPresUnit').addEventListener('change', (e) => {
      App.state.units.pressure = Number(e.target.value);
      App.saveSettings();
      App.refreshUI();
      App.toast('气压单位已切换');
    });
    container.querySelector('#chkContrast').addEventListener('change', (e) => {
      App.state.theme.contrast = e.target.checked;
      App.themeChanged();
      App.saveSettings();
    });

    function paintModules() {
      const list = container.querySelector('#moduleList');
      list.innerHTML = MODULES.map(([k, label]) =>
        '<label class="check-line" style="min-height:30px"><input type="checkbox" data-module="' + k + '"'
        + (App.isModuleHidden(k) ? '' : ' checked') + '> ' + label + '</label>'
      ).join('');
      list.querySelectorAll('[data-module]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const k = chk.dataset.module;
          const arr = App.state.hiddenModules.slice();
          const i = arr.indexOf(k);
          if (!chk.checked && i < 0) arr.push(k);
          if (chk.checked && i >= 0) arr.splice(i, 1);
          App.state.hiddenModules = arr;
          App.saveSettings();
          App.toast('监控模块已' + (chk.checked ? '显示' : '隐藏'));
          if (App.state.nav === 0) App.navigate(0);
        });
      });
    }

    container.querySelector('#btnShowAll').addEventListener('click', () => {
      App.state.hiddenModules = [];
      App.saveSettings();
      paintModules();
      App.toast('已显示全部监控模块');
      if (App.state.nav === 0) App.navigate(0);
    });

    container.querySelector('#btnExportCfg').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({
        theme: App.state.theme,
        units: App.state.units,
        hiddenModules: App.state.hiddenModules
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ground_station_web_config.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      App.toast('配置已导出');
    });
    container.querySelector('#btnImportCfg').addEventListener('click', () => {
      container.querySelector('#fileImport').click();
    });
    container.querySelector('#fileImport').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const cfg = JSON.parse(String(reader.result));
          if (cfg.theme) Object.assign(App.state.theme, cfg.theme);
          if (cfg.units) Object.assign(App.state.units, cfg.units);
          if (Array.isArray(cfg.hiddenModules)) App.state.hiddenModules = cfg.hiddenModules;
          App.saveSettings();
          App.themeChanged();
          App.toast('配置已导入');
          App.navigate(4);
        } catch (err) {
          App.toast('配置导入失败：' + err.message, 'err');
        }
      };
      reader.readAsText(file);
    });

    container.querySelector('#btnResetCfg').addEventListener('click', () => {
      App.confirm({
        title: '恢复默认设置',
        message: '将恢复默认主题、显示单位与全部监控模块可见性。',
        detail: '此操作只影响当前浏览器，不会修改后端或遥测数据。',
        okText: '恢复默认',
        danger: true,
        onOk() {
          App.state.theme.dark = false;
          App.state.theme.accent = 'blue';
          App.state.theme.dense = false;
          App.state.theme.contrast = false;
          App.state.units.temp = 0;
          App.state.units.pressure = 0;
          App.state.hiddenModules = [];
          App.saveSettings();
          App.applyTheme();
          App.toast('已恢复默认设置');
          App.navigate(4);
        }
      });
    });

    paintModules();

    const mqttHint = container.querySelector('#mqttSetupHint');
    if (mqttHint && App.state.status && App.state.status.source === 'unconfigured') {
      mqttHint.innerHTML = 'MQTT 未配置：打开 <a href="/setup">/setup</a> 填写只读连接参数（仅保存在服务端内存）。';
    }

    return {
      key: 'settings',
      update() { /* 静态设置页 */ },
      destroy() { /* 无定时器 */ }
    };
  }

  App.viewsRegistry = App.viewsRegistry || {};
  App.viewsRegistry.settings = { render };
})();
