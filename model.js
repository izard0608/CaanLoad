/* Bit counts follow the article author's 2025-08 Excel tables for Classic and FD standard frames. */
const CAN = (() => {
  const fdLengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
  const validLength = (mode, bytes) => mode === 'classic'
    ? Number.isInteger(bytes) && bytes >= 0 && bytes <= 8
    : fdLengths.includes(bytes);

  const frameTime = (bus, frame, worst = false) => {
    const bytes = Number(frame.bytes);
    const nominal = Number(bus.nominal) * 1e6;
    const data = Number(bus.data) * 1e6;
    if (!validLength(bus.mode, bytes) || !(nominal > 0) || (bus.mode === 'fd-brs' && !(data > 0))) return NaN;
    const extended = frame.id === 'extended';
    if (bus.mode === 'classic') {
      const bits = extended
        ? (worst ? 75 : 64) + bytes * 8
        : worst ? 49 + bytes * 8 + Math.floor((bytes * 8 + 16) / 5) : 47 + bytes * 8;
      return bits / nominal;
    }
    // The author's workbook only tabulates FD standard IDs. Extended FD uses the
    // Linux CAN length definition, with an approximate BRS phase split.
    const arbitration = extended ? (worst ? 57 : 49) : (worst ? 31 : 28);
    const dataBits = extended ? bytes * 8 + (bytes <= 16 ? 32 : 37)
      : bytes * 8 + (bytes <= 2 && bytes > 0 ? 28 : 32);
    const dataWorst = extended
      ? dataBits + Math.floor((40 + bytes * 8) / 4) - 8
      : dataBits + Math.floor((dataBits - 1) / 5);
    const payloadBits = worst ? dataWorst : dataBits;
    return bus.mode === 'fd-brs'
      ? arbitration / nominal + payloadBits / data
      : (arbitration + payloadBits) / nominal;
  };

  const calculate = (bus, devices) => {
    const rows = devices.filter(device => device.busId === bus.id).map(device => {
      const values = ['tx', 'rx'].map(direction => {
        const frame = device[direction];
        const frequency = Number(direction === 'rx' && device.rxMode === 'handshake' ? device.tx.hz : frame.hz);
        const count = Number(frame.count);
        const valid = Number.isFinite(frequency) && frequency >= 0 && Number.isInteger(count) && count >= 0 && validLength(bus.mode, Number(frame.bytes));
        return valid ? { min: frameTime(bus, frame) * frequency * count, max: frameTime(bus, frame, true) * frequency * count, packetsPerMs: frequency * count / 1000 } : { min: NaN, max: NaN, packetsPerMs: NaN };
      });
      return { device, tx: values[0], rx: values[1] };
    });
    const sum = direction => rows.reduce((acc, row) => ({ min: acc.min + row[direction].min, max: acc.max + row[direction].max }), { min: 0, max: 0 });
    const tx = sum('tx'), rx = sum('rx');
    const packetsPerMs = direction => rows.reduce((total, row) => total + row[direction].packetsPerMs, 0);
    return { rows, tx, rx, txPacketsPerMs: packetsPerMs('tx'), rxPacketsPerMs: packetsPerMs('rx'), min: tx.min + rx.min, max: tx.max + rx.max };
  };

  const frame = (hz = 1000, count = 1, bytes = 8, id = 'standard') => ({ hz, count, bytes, id });
  const presets = {
    dmMit: { name: '达妙 MIT · 握手回包', tx: frame(1000), rx: frame(1000), rxMode: 'handshake' },
    gm6020: { name: 'DJI GM6020 · 固定频率回包', tx: frame(1000), rx: frame(1000) },
    m3508: { name: 'DJI 3508 · 一拖四 / 固定频率回包', tx: frame(1000, 1), rx: frame(1000, 4) },
    lk: { name: 'LK 电机 · 固定频率回包', tx: frame(1000), rx: frame(1000) },
    fdBoard: { name: 'CAN FD 节点 · 16 B', tx: frame(1000, 1, 16), rx: frame(1000, 1, 16) },
    custom: { name: '自定义设备', tx: frame(), rx: frame() }
  };
  const uid = () => globalThis.crypto?.randomUUID?.() || `can-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clonePreset = (key, busId, name = presets[key].name) => ({ id: uid(), busId, name, rxMode: presets[key].rxMode || 'fixed', tx: { ...presets[key].tx }, rx: { ...presets[key].rx } });
  const defaultState = () => {
    const buses = [
      { id: 'can1', name: 'CAN1', mode: 'classic', nominal: 1, data: 2 },
      { id: 'can2', name: 'CAN2', mode: 'classic', nominal: 1, data: 2 },
      { id: 'can3', name: 'CAN3', mode: 'fd-no-brs', nominal: 1, data: 2 }
    ];
    const standardNode = (busId, name) => ({ id: uid(), busId, name, tx: frame(100, 1, 8), rx: frame(100, 1, 8) });
    const fdNode = (busId, name) => ({ id: uid(), busId, name, tx: frame(100, 1, 16), rx: frame(100, 1, 16) });
    return { buses, devices: [
      standardNode('can1', '节点 A'), standardNode('can1', '节点 B'),
      standardNode('can2', '节点 C'), standardNode('can2', '节点 D'),
      fdNode('can3', 'FD 节点 E'), fdNode('can3', 'FD 节点 F')
    ] };
  };
  return { calculate, frameTime, fdLengths, presets, clonePreset, defaultState, validLength, uid };
})();
