const STORAGE_KEY = 'jiaolong-can-planner-v1';
let state;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  state = saved && Array.isArray(saved.buses) && Array.isArray(saved.devices) ? saved : CAN.defaultState();
} catch {
  state = CAN.defaultState();
}
let activeBus = 'all';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const fmt = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const fmtPackets = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Private browsing may disable storage. */ } };
const selected = (value, target) => value === target ? ' selected' : '';
const busOptions = id => state.buses.map(bus => `<option value="${escapeHtml(bus.id)}"${selected(bus.id, id)}>${escapeHtml(bus.name)}</option>`).join('');
const results = () => state.buses.map(bus => ({ bus, result: CAN.calculate(bus, state.devices) }));

const renderBus = ({ bus, result }) => {
  const middle = (result.min + result.max) / 2;
  const tx = (result.tx.min + result.tx.max) / 2;
  const rx = (result.rx.min + result.rx.max) / 2;
  const over = result.max >= 1;
  const caution = result.max >= .8;
  const invalid = !Number.isFinite(middle);
  const modeName = { classic: '经典 CAN', 'fd-no-brs': 'CAN FD · 无 BRS', 'fd-brs': 'CAN FD · BRS' }[bus.mode];
  return `<article class="bus-card" data-id="${escapeHtml(bus.id)}">
    <div class="bus-top"><div><span class="bus-kicker">${escapeHtml(modeName || '未知格式')}</span><h3>${escapeHtml(bus.name)}</h3></div><div class="bus-load ${over ? 'danger' : caution ? 'warning' : ''}"><strong>${fmt(middle)}</strong><small>折中估算</small></div></div>
    <div class="meter" aria-label="总线占用"><i class="tx" style="width:${Math.min(100, Math.max(0, tx * 100))}%"></i><i class="rx" style="width:${Math.min(100, Math.max(0, rx * 100))}%"></i><i class="limit"></i></div>
    <div class="bus-stats"><span>TX <b>${fmt(tx)}</b></span><span>RX <b>${fmt(rx)}</b></span><span>范围 <b>${fmt(result.min)}–${fmt(result.max)}</b></span></div>
    <div class="packet-stats"><span>平均 TX <b>${fmtPackets(result.txPacketsPerMs)}</b> 帧/ms</span><span>平均 RX <b>${fmtPackets(result.rxPacketsPerMs)}</b> 帧/ms</span><span>合计 <b>${fmtPackets(result.txPacketsPerMs + result.rxPacketsPerMs)}</b> 帧/ms</span></div>
    ${invalid ? '<div class="notice danger">请检查速率、频率、帧数或长度。</div>' : over ? '<div class="notice danger">保守上界超过总线容量，当前配置不可行。</div>' : caution ? '<div class="notice">保守上界超过 80%，建议验证实测峰值。</div>' : ''}
    <div class="bus-fields"><label>名称<input data-kind="bus" data-id="${escapeHtml(bus.id)}" data-field="name" value="${escapeHtml(bus.name)}"></label><label>帧格式<select data-kind="bus" data-id="${escapeHtml(bus.id)}" data-field="mode"><option value="classic"${selected(bus.mode, 'classic')}>经典 CAN</option><option value="fd-no-brs"${selected(bus.mode, 'fd-no-brs')}>CAN FD · 无 BRS</option><option value="fd-brs"${selected(bus.mode, 'fd-brs')}>CAN FD · BRS</option></select></label><label>仲裁速率 Mbps<input type="number" min="0.001" step="0.1" data-kind="bus" data-id="${escapeHtml(bus.id)}" data-field="nominal" value="${escapeHtml(bus.nominal)}"></label><label>数据速率 Mbps<input type="number" min="0.001" step="0.1" ${bus.mode !== 'fd-brs' ? 'disabled' : ''} data-kind="bus" data-id="${escapeHtml(bus.id)}" data-field="data" value="${escapeHtml(bus.data)}"></label></div>
    <button class="icon-button remove-bus" data-id="${escapeHtml(bus.id)}" title="删除这条总线及其设备">× <span>删除总线</span></button>
  </article>`;
};

const frameFields = (device, direction, label) => {
  const frame = device[direction];
  const handshake = direction === 'rx' && device.rxMode === 'handshake';
  const frequency = handshake ? device.tx.hz : frame.hz;
  const base = `data-kind="device" data-id="${escapeHtml(device.id)}" data-side="${direction}"`;
  return `<div class="frame-row"><span class="direction ${direction}">${label}</span><label>频率 Hz<input type="number" min="0" step="1" ${base} data-field="hz" value="${escapeHtml(frequency)}" ${handshake ? 'disabled title="握手回包频率跟随 TX 请求频率"' : ''}></label><label>每次帧数<input type="number" min="0" step="1" ${base} data-field="count" value="${escapeHtml(frame.count)}"></label><label>数据字节<input type="number" min="0" max="64" step="1" ${base} data-field="bytes" value="${escapeHtml(frame.bytes)}"></label><label>ID 长度<select ${base} data-field="id"><option value="standard"${selected(frame.id, 'standard')}>标准 11 位</option><option value="extended"${selected(frame.id, 'extended')}>扩展 29 位</option></select></label></div>${handshake ? '<div class="rate-hint">握手回包：每次 TX 请求计入对应 RX 响应，RX 频率跟随 TX。</div>' : ''}`;
};

const renderDevice = device => {
  const bus = state.buses.find(item => item.id === device.busId);
  const wrongTx = bus && !CAN.validLength(bus.mode, Number(device.tx.bytes));
  const wrongRx = bus && !CAN.validLength(bus.mode, Number(device.rx.bytes));
  return `<article class="device" data-id="${escapeHtml(device.id)}"><div class="device-head"><input class="device-name" aria-label="设备名称" data-kind="device" data-id="${escapeHtml(device.id)}" data-field="name" value="${escapeHtml(device.name)}"><select aria-label="所属总线" data-kind="device" data-id="${escapeHtml(device.id)}" data-field="busId">${busOptions(device.busId)}</select><button class="icon-button remove-device" data-id="${escapeHtml(device.id)}" title="删除设备">×</button></div>${frameFields(device, 'tx', 'TX')}${frameFields(device, 'rx', 'RX')}${wrongTx || wrongRx ? `<div class="notice danger">${bus.mode === 'classic' ? '经典 CAN 只支持 0–8 字节' : 'CAN FD 长度只能为 0–8、12、16、20、24、32、48、64 字节'}；请修改该设备。</div>` : ''}</article>`;
};

const renderSummary = calculated => calculated.map(({ bus, result }) => {
  const middle = (result.min + result.max) / 2;
  const count = state.devices.filter(device => device.busId === bus.id).length;
  return `<div class="summary-row"><div><strong>${escapeHtml(bus.name)}</strong><span>${count} 个条目</span></div><b class="${result.max >= 1 ? 'danger' : result.max >= .8 ? 'warning' : ''}">${fmt(middle)}</b><small>保守 ${fmt(result.max)} · 余量 ${fmt(Math.max(0, 1 - result.max))}</small><small>TX ${fmtPackets(result.txPacketsPerMs)} / RX ${fmtPackets(result.rxPacketsPerMs)} 帧/ms</small></div>`;
}).join('') || '<p class="empty">添加总线后开始计算。</p>';

const refreshLiveResults = () => {
  const calculated = results();
  $('#summary').innerHTML = renderSummary(calculated);
  calculated.forEach(({ bus, result }) => {
    const card = [...document.querySelectorAll('.bus-card')].find(node => node.dataset.id === bus.id);
    if (!card) return;
    const tx = (result.tx.min + result.tx.max) / 2;
    const rx = (result.rx.min + result.rx.max) / 2;
    card.querySelector('.bus-load strong').textContent = fmt((result.min + result.max) / 2);
    card.querySelector('.meter .tx').style.width = `${Math.min(100, Math.max(0, tx * 100))}%`;
    card.querySelector('.meter .rx').style.width = `${Math.min(100, Math.max(0, rx * 100))}%`;
    const stats = card.querySelectorAll('.bus-stats b');
    stats[0].textContent = fmt(tx); stats[1].textContent = fmt(rx);
    stats[2].textContent = `${fmt(result.min)}–${fmt(result.max)}`;
    const packetStats = card.querySelectorAll('.packet-stats b');
    packetStats[0].textContent = fmtPackets(result.txPacketsPerMs);
    packetStats[1].textContent = fmtPackets(result.rxPacketsPerMs);
    packetStats[2].textContent = fmtPackets(result.txPacketsPerMs + result.rxPacketsPerMs);
  });
};

const render = () => {
  const calculated = results();
  $('#buses').innerHTML = calculated.map(renderBus).join('') || '<p class="empty">尚无总线。点击右上角添加。</p>';
  $('#summary').innerHTML = renderSummary(calculated);
  $('#bus-count').textContent = `${state.buses.length} 路`;
  $('#device-count').textContent = `${state.devices.length} 项`;
  const filters = `<div class="filters"><button class="${activeBus === 'all' ? 'active' : ''}" data-filter="all">全部</button>${state.buses.map(bus => `<button class="${activeBus === bus.id ? 'active' : ''}" data-filter="${escapeHtml(bus.id)}">${escapeHtml(bus.name)}</button>`).join('')}</div>`;
  $('#devices').innerHTML = filters + state.devices.filter(device => activeBus === 'all' || device.busId === activeBus).map(renderDevice).join('') + (!state.devices.length ? '<p class="empty">选择预设或添加自定义设备。</p>' : '');
  $('#add-preset').disabled = !state.buses.length;
  $('#add-device').disabled = !state.buses.length;
};

const updateField = input => {
  const { kind, id, side, field } = input.dataset;
  const target = kind === 'bus' ? state.buses.find(bus => bus.id === id) : state.devices.find(device => device.id === id);
  if (!target) return;
  const holder = side ? target[side] : target;
  holder[field] = input.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
  save();
};

document.addEventListener('input', event => {
  if (!event.target.dataset.kind) return;
  updateField(event.target);
  refreshLiveResults();
});
document.addEventListener('change', event => {
  if (!event.target.dataset.kind) return;
  updateField(event.target);
  render();
});
document.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (filter) { activeBus = filter.dataset.filter; render(); return; }
  const removeDevice = event.target.closest('.remove-device');
  if (removeDevice) { state.devices = state.devices.filter(device => device.id !== removeDevice.dataset.id); save(); render(); return; }
  const removeBus = event.target.closest('.remove-bus');
  if (removeBus && confirm('删除这条总线及其所有设备？')) {
    state.devices = state.devices.filter(device => device.busId !== removeBus.dataset.id);
    state.buses = state.buses.filter(bus => bus.id !== removeBus.dataset.id);
    if (activeBus === removeBus.dataset.id) activeBus = 'all';
    save(); render();
  }
});

$('#add-bus').addEventListener('click', () => {
  const id = CAN.uid();
  state.buses.push({ id, name: `FDCAN${state.buses.length + 1}`, mode: 'classic', nominal: 1, data: 2 });
  save(); render();
});
$('#add-device').addEventListener('click', () => {
  state.devices.push(CAN.clonePreset('custom', activeBus === 'all' ? state.buses[0].id : activeBus));
  save(); render();
});
$('#add-preset').addEventListener('click', () => {
  const key = $('#preset').value;
  if (!CAN.presets[key] || !state.buses.length) return;
  const busId = activeBus === 'all' ? state.buses[0].id : activeBus;
  state.devices.push(CAN.clonePreset(key, busId));
  save(); render();
});
$('#reset').addEventListener('click', () => {
  if (!confirm('恢复初始通用场景并覆盖当前场景？')) return;
  state = CAN.defaultState(); activeBus = 'all'; save(); render();
});
$('#preset').innerHTML += Object.entries(CAN.presets).filter(([key]) => key !== 'custom').map(([key, preset]) => `<option value="${key}">${escapeHtml(preset.name)}</option>`).join('');
render();
