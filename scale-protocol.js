// HoMedics glo scale (QN protocol) over Web Bluetooth. No dependencies.
// Works as a plain <script> (window.ScaleProtocol) and in Node (require) for tests.
// Per read it sends only: 0x13 unit (lb), 0x20 time sync, the all-zeros A0 frame and the
// 0x22 history query. It never sends the user-profile A0 frame and never deletes records.
(function (root) {
  const SERVICE = 0xfff0;
  const NOTIFY = 0xfff1;
  const WRITE = 0xfff2;
  const EPOCH_2000 = 946684800;
  const LB_PER_KG = 2.20462;
  const UNIT_LB = 0x02;
  const ZERO_A0 = [0xa0, 0x0d, 0x04, 0xfe, 0, 0, 0, 0, 0, 0, 0, 0, 0xaf];
  const HISTORY_QUERY = [0x22, 0x06, 0xff, 0x00, 0x03, 0x2a];
  const SESSION_MS = 15000;

  const checksum = (bytes) => bytes.reduce((s, b) => (s + b) & 0xff, 0);
  const checksumOk = (f) => f.length >= 3 && checksum(f.slice(0, -1)) === f[f.length - 1];
  const withChecksum = (body) => Uint8Array.from([...body, checksum(body)]);
  const hex = (f) => Array.from(f, (b) => b.toString(16).padStart(2, '0')).join('');
  const u16be = (f, i) => (f[i] << 8) | f[i + 1];
  const u32le = (f, i) => (f[i] | (f[i + 1] << 8) | (f[i + 2] << 16) | (f[i + 3] << 24)) >>> 0;

  function unitFrame(hello) {
    return withChecksum([0x13, 0x09, hello[2], UNIT_LB, 0x10, 0x00, 0x00, 0x00]);
  }

  function timeFrame(hello, unixSecs = Math.floor(Date.now() / 1000)) {
    const t = unixSecs - EPOCH_2000;
    return withChecksum([0x20, 0x08, hello[2], t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff]);
  }

  const isLastRecord = (f) => f[0] === 0x23 && (f[3] === 0 || f[4] >= f[3]);

  function localDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function decodeRecord(f) {
    if (f.length !== 19 || f[0] !== 0x23 || !checksumOk(f) || f[3] === 0) return null;
    const scaleTs = u32le(f, 6);
    const kg = u16be(f, 10) / 100;
    if (kg <= 0) return null;
    const when = new Date((scaleTs + EPOCH_2000) * 1000);
    return {
      ts: when.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      date: localDate(when),
      value: Math.round(kg * LB_PER_KG * 10) / 10,
      unit: 'lb',
      kg,
      imp: u16be(f, 12),
      imp2: u16be(f, 14),
      // Likely the scale's own body-fat % x10 (matches the scale display); to confirm.
      bf: u16be(f, 16) / 10,
      scaleTs,
      raw: hex(f),
    };
  }

  // Must be called from a user gesture (button click). Resolves with decoded records.
  async function readScale({ onLog = () => {} } = {}) {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Homedics' }],
      optionalServices: [SERVICE, 0xae00],
    });
    onLog(`Connecting to ${device.name}…`);
    const server = await device.gatt.connect();
    try {
      const svc = await server.getPrimaryService(SERVICE);
      const rx = await svc.getCharacteristic(NOTIFY);
      const tx = await svc.getCharacteristic(WRITE);
      const records = [];
      const sent = new Set();
      let writes = Promise.resolve();
      const send = (frame) => {
        writes = writes.then(() => tx.writeValueWithoutResponse(frame));
        onLog(`tx ${hex(frame)}`);
      };

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, SESSION_MS);
        rx.addEventListener('characteristicvaluechanged', (e) => {
          const f = new Uint8Array(e.target.value.buffer);
          onLog(`rx ${hex(f)}`);
          const op = f[0];
          if (sent.has(op) && op !== 0x23) return;
          sent.add(op);
          if (op === 0x12) send(unitFrame(f));
          else if (op === 0x14) send(timeFrame(f));
          else if (op === 0x21) { send(Uint8Array.from(ZERO_A0)); send(Uint8Array.from(HISTORY_QUERY)); }
          else if (op === 0x23) {
            const r = decodeRecord(f);
            if (r) records.push(r);
            if (isLastRecord(f)) { clearTimeout(timer); resolve(); }
          }
          writes.catch(reject);
        });
        rx.startNotifications().then(() => onLog('Listening… (step on the scale if it went to sleep)'), reject);
      });
      return records;
    } finally {
      if (device.gatt.connected) device.gatt.disconnect();
    }
  }

  const api = { checksum, checksumOk, unitFrame, timeFrame, decodeRecord, isLastRecord, readScale, hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleProtocol = api;
})(typeof window !== 'undefined' ? window : globalThis);
