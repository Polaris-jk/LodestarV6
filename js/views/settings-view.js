// Settings — current project, coordinates, GPS, permissions, display, storage.

import * as store from '../store.js';
import { mainHeader, toast, applyTheme } from '../ui.js';
import { icon } from '../icons.js';
import { openCalibration } from './clino.js';
import { esc, debounce, fmtSize, parseNum, isStandalone, isIOS } from '../util.js';

const seg = (key, value, options) =>
  `<div class="seg" role="radiogroup" data-k="${key}">${options
    .map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;

export async function render(root) {
  mainHeader();
  const s = store.getSettings();
  const p = store.getProject();
  const example = () => {
    const cur = store.getProject();
    return `รหัสจะเป็นแบบ Station ${esc(cur.stationPrefix)}-001 และตัวอย่างหิน ${esc(cur.samplePrefix)}-001-01`;
  };

  root.innerHTML = `<div class="screen page settings-screen">
    <section class="sec">
      <h2 class="sec-h">Project <a class="btn sm" href="#/projects">${icon('folder')}โปรเจกต์ทั้งหมด</a></h2>
      <label class="field"><span class="lbl">ชื่อโปรเจกต์ที่ใช้อยู่</span><input type="text" data-k="projectName" value="${esc(p.name)}" autocomplete="off"></label>
      <div class="field-2">
        <label class="field"><span class="lbl">Station prefix</span><input type="text" class="mono" data-k="stationPrefix" value="${esc(p.stationPrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
        <label class="field"><span class="lbl">Sample prefix</span><input type="text" class="mono" data-k="samplePrefix" value="${esc(p.samplePrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
      </div>
      <p class="hint" id="idExample">${example()}</p>
      <p class="warn-text hidden" id="prefixWarn"></p>
      <label class="field"><span class="lbl">ผู้เก็บข้อมูล (Collector) ใช้กับทุกโปรเจกต์</span><input type="text" data-k="collector" value="${esc(s.collector)}" placeholder="ชื่อ นามสกุล" autocomplete="name"></label>
    </section>

    <section class="sec">
      <h2 class="sec-h">Coordinates</h2>
      <div class="field"><span class="lbl">แสดงพิกัดเป็น</span>${seg('coordFormat', s.coordFormat, [['utm', 'Grid Ref'], ['dd', 'Lat/Long'], ['dms', 'DMS']])}</div>
      <div class="field"><span class="lbl">UTM zone</span>${seg('utmZone', s.utmZone, [['auto', 'Auto'], ['47', '47'], ['48', '48']])}</div>
      <p class="hint">Grid Ref คือพิกัดกริด 6 หลักแบบที่ใช้ปักบนแผนที่ภูมิประเทศ 1:50,000 (ช่องละ 100 m) ตัวอักษรเช่น 48Q TD คือรหัสโซนและจัตุรัส 100 km ที่พิมพ์ไว้ขอบระวาง</p>
      <p class="hint">ประเทศไทยคร่อม UTM สองโซน: 47 อยู่ทางตะวันตกของลองจิจูด 102° และ 48 อยู่ทางตะวันออก ถ้าพื้นที่สำรวจคร่อมเส้นแบ่ง ให้ล็อกโซนเดียวทั้งโปรเจกต์ ไฟล์ Export มีทั้ง UTM และ Lat/Long เสมอ</p>
      <label class="field"><span class="lbl">Magnetic declination (องศา, ตะวันออกเป็นบวก)</span><input type="text" inputmode="decimal" class="mono" data-k="declination" value="${esc(s.declination)}" autocomplete="off"></label>
      <p class="hint">ใส่ 0 เพื่อแสดงทิศเหนือแม่เหล็กเหมือนเข็มทิศ Brunton ที่ไม่ได้ตั้งค่า</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">GPS</h2>
      <div class="field"><span class="lbl">ปิด GPS เมื่อได้ความแม่นยำ</span>${seg('gpsTarget', s.gpsTarget, [['5', '±5 m'], ['10', '±10 m'], ['20', '±20 m']])}</div>
      <p class="hint">Lodestar เปิด GPS เฉพาะตอนแตะ ดูตำแหน่ง หรือสร้าง Station ใหม่ แล้วปิดทันทีเมื่อได้ค่าตามนี้ หรือครบ 30 วินาที (แตะ ใช้ค่านี้ เพื่อหยุดก่อนได้) ตั้งค่าสูงขึ้นจะปิดเร็วขึ้นและประหยัดแบตกว่า</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">Smart Photo</h2>
      <div class="field"><span class="lbl">บันทึก Smart Photo ลงเครื่องเมื่อบันทึก Station</span>${seg('smartAutoSave', s.smartAutoSave === false ? 'off' : 'on', [['on', 'อัตโนมัติ'], ['off', 'ไม่บันทึก']])}</div>
      <p class="hint">Smart Photo ของทุกรูปถูกเก็บไว้ในแอปเสมอ ${isIOS() ? 'บน iPhone เว็บแอปบันทึกรูปลงเครื่องเองไม่ได้ ให้แตะรูปแล้วกด Smart Photo → บันทึกหรือแชร์ → Save Image หรือใช้ EXPORT → Smart Photos ทีเดียวทั้งโปรเจกต์' : 'เมื่อกด SAVE STATION รูปใหม่จะถูกบันทึกลงโฟลเดอร์ Download ของเครื่อง (เห็นในแกลเลอรี)'}</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">เซนเซอร์วัดชั้นหิน</h2>
      <div id="calBox"></div>
    </section>

    <section class="sec">
      <h2 class="sec-h">สิทธิ์ GPS และเข็มทิศ</h2>
      <p class="body">Lodestar ไม่ขอสิทธิ์อะไรตอนเปิดแอป จะถามเฉพาะตอนแตะปุ่มที่ต้องใช้ GPS หรือเข็มทิศเท่านั้น</p>
      ${isIOS() ? `<p class="body"><b>iPhone</b> เป็นคนกำหนดว่าจะถามซ้ำบ่อยแค่ไหน ลดการถามได้โดย</p>
      <ol class="steps">
        <li>Settings → Privacy &amp; Security → Location Services → Safari Websites → เลือก While Using the App</li>
        <li>Settings → Apps → Safari → Location → เลือก Allow (iOS 17 ลงไปอยู่ที่ Settings → Safari → Location)</li>
      </ol>
      <p class="hint">เข็มทิศบน iPhone ต้องแตะอนุญาตใหม่ทุกครั้งที่เปิดแอป เป็นข้อจำกัดของเว็บแอปบน iOS ที่แก้จากฝั่งแอปไม่ได้</p>`
      : `<p class="hint">บน Android เครื่องจะจำสิทธิ์ตำแหน่งไว้ และเข็มทิศไม่ต้องขอสิทธิ์</p>`}
    </section>

    <section class="sec">
      <h2 class="sec-h">Display</h2>
      ${seg('theme', s.theme, [['dark', 'Dark ประหยัดแบต'], ['sun', 'Sun อ่านกลางแดด']])}
    </section>

    <section class="sec">
      <h2 class="sec-h">Storage</h2>
      <div id="storage"><p class="hint">กำลังตรวจสอบ</p></div>
    </section>

    <section class="sec about">
      <h2 class="sec-h">About</h2>
      <p>Lodestar ${store.APP_VERSION}</p><p class="hint">สมุดสนามดิจิทัลสำหรับนักศึกษาเทคโนโลยีธรณี มหาวิทยาลัยขอนแก่น</p>
      <p class="hint">ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ไม่มีการส่งขึ้น server ให้ Export เป็น Project ZIP เก็บไว้หลังออกภาคสนามทุกครั้ง</p>
    </section>
  </div>`;

  function renderCal() {
    const box = root.querySelector('#calBox');
    if (!box) return;
    const c = store.getSettings().clinoCal;
    box.innerHTML = `
      <p class="kv"><span>ปรับศูนย์ (ไม่บังคับ)</span><b>${c ? `ปรับแล้ว (หลังเครื่องเอียง ${Number(c.tilt).toFixed(1)}°)` : 'ยังไม่ได้ปรับ'}</b></p>
      <p class="hint">กล้องหลังที่นูนหรือเคสทำให้มือถือวางบนหินแล้วเอียงเล็กน้อย ค่า Dip จึงคลาดได้ 1–2° ซึ่งมีผลมากกับชั้นหินที่เอียงน้อย ไม่บังคับ แต่แนะนำให้ปรับศูนย์บนโต๊ะครั้งเดียว แล้วทำใหม่เมื่อเปลี่ยนเคส</p>
      <p class="hint">ทิศของ Strike และทิศที่ถ่ายรูปอ้างทิศเหนือตาม Magnetic declination ในหัวข้อ Coordinates</p>
      <div class="btn-row">
        <button type="button" class="btn" id="btnCal">${icon('clino')}${c ? 'ปรับศูนย์ใหม่' : 'ปรับศูนย์'}</button>
        ${c ? '<button type="button" class="btn" id="btnCalClear">ล้างค่า</button>' : ''}
      </div>`;
    box.querySelector('#btnCal').onclick = () => openCalibration({ onDone: renderCal });
    box.querySelector('#btnCalClear')?.addEventListener('click', async () => {
      if (!confirm('ล้างค่าปรับศูนย์? การวัดครั้งต่อไปจะไม่หักค่าเอียงของเครื่อง')) return;
      await store.updateSettings({ clinoCal: null });
      toast('ล้างค่าปรับศูนย์แล้ว');
      renderCal();
    });
  }
  renderCal();

  async function renderStorage() {
    const info = await store.storageInfo();
    const box = root.querySelector('#storage');
    if (!box) return;
    const used = info.usage != null ? fmtSize(info.usage) : '—';
    const installed = isStandalone();
    box.innerHTML = `
      <p class="kv"><span>พื้นที่ที่ Lodestar ใช้</span><b class="mono">${used}</b></p>
      <p class="kv"><span>ป้องกันการลบอัตโนมัติ</span><b>${info.persisted ? 'เปิดแล้ว' : 'ยังไม่เปิด'}</b></p>
      <p class="kv"><span>ติดตั้งเป็นแอป</span><b>${installed ? 'ใช่' : 'ยังไม่ได้ติดตั้ง'}</b></p>
      ${!info.persisted ? '<button type="button" class="btn sm" id="btnPersist">ขอให้เครื่องเก็บข้อมูลถาวร</button>' : ''}
      ${!installed && isIOS() ? '<p class="hint">บน iPhone ให้ติดตั้งผ่าน Share แล้วเลือก Add to Home Screen ข้อมูลจะปลอดภัยกว่าใช้ผ่าน Safari</p>' : ''}
      <p class="hint">ถ้าลบไอคอน Lodestar ออกจากหน้าจอโฮม ข้อมูลในแอปจะถูกลบด้วย ให้ Export ก่อนทุกครั้ง</p>`;
    box.querySelector('#btnPersist')?.addEventListener('click', async () => {
      const ok = await store.ensurePersistence();
      toast(ok ? 'เปิดการเก็บข้อมูลถาวรแล้ว' : 'เบราว์เซอร์ยังไม่อนุญาต ลองติดตั้งเป็นแอปก่อน', 3500);
      renderStorage();
    });
  }
  renderStorage();

  async function checkPrefix() {
    const warn = root.querySelector('#prefixWarn');
    const owner = await store.samplePrefixOwner(store.getProject().samplePrefix, store.getProject().id);
    if (!warn) return;
    warn.classList.toggle('hidden', !owner);
    if (owner) warn.textContent = `Sample prefix นี้ใช้อยู่แล้วในโปรเจกต์ "${owner}" รหัสตัวอย่างหินจะซ้ำกันได้`;
  }
  checkPrefix();

  async function saveField(key, value) {
    if (key === 'projectName') {
      if (!value.trim()) return;
      await store.updateProject({ name: value });
      mainHeader();
    } else if (key === 'stationPrefix' || key === 'samplePrefix') {
      const clean = value.trim().replace(/\s+/g, '');
      if (!clean) return;
      await store.updateProject({ [key]: clean });
      const ex = root.querySelector('#idExample');
      if (ex) ex.innerHTML = example();
      checkPrefix();
    } else if (key === 'declination') {
      const v = parseNum(value);
      if (v === null || Number.isNaN(v) || v < -30 || v > 30) return;
      await store.updateSettings({ declination: v });
    } else {
      await store.updateSettings({ [key]: value });
    }
  }
  // One debounced saver per field, so typing in one field never drops a pending edit in another.
  const savers = new Map();
  const saveText = (key, value) => {
    if (!savers.has(key)) savers.set(key, debounce((v) => saveField(key, v), 400));
    savers.get(key)(value);
  };

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.k) return;
    if (t.dataset.k === 'declination') {
      const v = parseNum(t.value);
      t.classList.toggle('invalid', v !== null && (Number.isNaN(v) || v < -30 || v > 30));
    }
    saveText(t.dataset.k, t.value);
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.closest('.seg');
    const key = group.dataset.k;
    group.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    const value = key === 'gpsTarget' ? Number(b.dataset.v) : key === 'smartAutoSave' ? b.dataset.v === 'on' : b.dataset.v;
    await store.updateSettings({ [key]: value });
    if (key === 'theme') { applyTheme(value); mainHeader(); }
  });

  return () => savers.forEach((d) => d.flush());
}
