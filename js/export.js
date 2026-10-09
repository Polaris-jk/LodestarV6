// Export for any use: Excel (.xlsx), CSV (UTF-8 with BOM for Thai in Excel), GeoJSON (RFC 7946,
// WGS84) for QGIS/ArcGIS, KML for Google Earth, GPX for GPS apps, and a ZIP with everything
// including photos and a full JSON backup. One or several projects at a time.

import { zipSync, strToU8 } from '../vendor/fflate.js';
import * as store from './store.js';
import { toUTM, gridRef } from './utm.js';
import { buildXlsx } from './xlsx.js';
import { lithInfo, lithName, weatheringLabel } from './vocab.js';
import { isoDate, pad, stamp } from './util.js';
import { hasMeasurement, az3 } from './geomath.js';
import { smartName } from './smartphoto.js';
import { smartFor } from './smartauto.js';

const r = (v, d) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

export const STATION_COLS = [
  'project', 'station', 'status', 'date', 'time', 'lat', 'lon', 'utm_zone', 'utm_e', 'utm_n', 'utm_epsg', 'grid_ref', 'mgrs',
  'elev_m', 'elev_ref', 'elev_acc_m', 'acc_m', 'fix_method', 'fix_n',
  'lithology', 'lithology_th', 'weathering', 'color',
  'struct_type', 'strike', 'dip', 'dip_dir', 'n_struct',
  'samples', 'n_photos', 'notes', 'collector', 'timestamp_utc',
];
export const STRUCT_COLS = ['project', 'station', 'struct_no', 'type', 'strike', 'dip', 'dip_dir', 'method', 'lat', 'lon', 'utm_zone', 'utm_e', 'utm_n', 'grid_ref', 'date'];
const SAMPLE_COLS = ['project', 'sample_id', 'station', 'note', 'lithology', 'lat', 'lon', 'utm_zone', 'utm_e', 'utm_n', 'grid_ref', 'date', 'collector'];
const PHOTO_COLS = ['project', 'file', 'station', 'photo_no', 'width', 'height', 'taken_local', 'added_utc', 'bearing_deg', 'bearing_src'];
// bearing_src: exif = written by the camera, auto = read when the camera button was tapped, camera = in-app camera at the shutter, aimed = set by aiming (before v0.6)

const ELEV_REF = { msl: 'MSL (device)', egm96: 'MSL (EGM96 from ellipsoid)', ellipsoid: 'WGS84 ellipsoid' };

function place(st) {
  const L = st.location;
  if (!L) return { lat: null, lon: null, utm_zone: null, utm_e: null, utm_n: null, utm_epsg: null, grid_ref: null, mgrs: null };
  const u = toUTM(L.lat, L.lon, store.zoneLock());
  const g = gridRef(u);
  return {
    lat: r(L.lat, 7),
    lon: r(L.lon, 7),
    utm_zone: u ? `${u.zone}${u.band}` : null,
    utm_e: u ? r(u.easting, 1) : null,
    utm_n: u ? r(u.northing, 1) : null,
    utm_epsg: u ? u.epsg : null,
    grid_ref: g ? g.gr : null, // 6-figure, 100 m square, as read on a 1:50,000 map
    mgrs: g ? g.mgrs : null,
  };
}

// The time a station was recorded is when NEW STATION was pressed; later edits don't change it.
const recorded = (st) => st.createdAt;

function stationRow(st, project) {
  const L = st.location || {};
  const t = recorded(st);
  const d = new Date(t);
  const meas = (st.measurements || []).filter(hasMeasurement);
  const m0 = meas[0] || {};
  return {
    project: project.name,
    station: st.code,
    status: st.status,
    date: isoDate(t),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ...place(st),
    elev_m: r(L.alt, 1),
    elev_ref: L.altRef ? ELEV_REF[L.altRef] : null,
    elev_acc_m: r(L.altAcc, 1),
    acc_m: r(L.acc, 1),
    fix_method: L.method ?? null,
    fix_n: L.n ?? null,
    lithology: lithName(st),
    lithology_th: lithInfo(st.lithology)?.th || '',
    weathering: weatheringLabel(st.weathering),
    color: st.color || '',
    struct_type: m0.type || '',
    strike: m0.strike ?? null,
    dip: m0.dip ?? null,
    dip_dir: m0.dipdir ?? null,
    n_struct: meas.length,
    samples: (st.samples || []).map((s) => s.id).filter(Boolean).join('; '),
    n_photos: (st.photoIds || []).length,
    notes: st.notes || '',
    collector: st.collector || '',
    timestamp_utc: new Date(t).toISOString(),
  };
}

function structureRows(stations, project) {
  const rows = [];
  for (const st of stations) {
    (st.measurements || []).filter(hasMeasurement).forEach((m, i) => {
      const p = place(st);
      rows.push({
        project: project.name, station: st.code, struct_no: i + 1, type: m.type || '',
        strike: m.strike ?? null, dip: m.dip ?? null, dip_dir: m.dipdir ?? null,
        method: m.src === 'sensor' ? 'sensor' : 'manual',
        lat: p.lat, lon: p.lon, utm_zone: p.utm_zone, utm_e: p.utm_e, utm_n: p.utm_n, grid_ref: p.grid_ref,
        date: isoDate(recorded(st)),
      });
    });
  }
  return rows;
}

function sampleRows(stations, project) {
  const rows = [];
  for (const st of stations) {
    for (const s of st.samples || []) {
      if (!s.id) continue;
      const p = place(st);
      rows.push({
        project: project.name, sample_id: s.id, station: st.code, note: s.note || '', lithology: lithName(st),
        lat: p.lat, lon: p.lon, utm_zone: p.utm_zone, utm_e: p.utm_e, utm_n: p.utm_n, grid_ref: p.grid_ref,
        date: isoDate(recorded(st)), collector: st.collector || '',
      });
    }
  }
  return rows;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, cols) {
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function featureCollection(name, rows) {
  return {
    type: 'FeatureCollection',
    name,
    features: rows
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: p })),
  };
}

// ---------- KML (Google Earth) and GPX (GPS apps) ----------

const xmlEsc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byTime = (a, b) => recorded(a) - recorded(b);

function describe(st) {
  const m = (st.measurements || []).filter(hasMeasurement);
  const p = place(st);
  const lines = [
    lithName(st) && `Lithology: ${lithName(st)}`,
    st.weathering && `Weathering: ${weatheringLabel(st.weathering)}`,
    st.color && `Color: ${st.color}`,
    ...m.map((x) => `${x.type || 'Plane'}: ${az3(x.strike)}/${x.dip ?? '—'} (dip dir ${az3(x.dipdir)})${x.src === 'sensor' ? ' [sensor]' : ''}`),
    (st.samples || []).length && `Samples: ${st.samples.map((s) => s.id).join(', ')}`,
    p.grid_ref && `GR ${p.grid_ref} (${p.utm_zone} ${p.mgrs.slice(String(p.utm_zone).length, String(p.utm_zone).length + 2)})`,
    p.utm_zone && `UTM ${p.utm_zone} ${Math.round(p.utm_e)} E ${Math.round(p.utm_n)} N`,
    `Recorded: ${new Date(recorded(st)).toLocaleString('en-GB')}`,
    st.notes && `Notes: ${st.notes}`,
  ].filter(Boolean);
  return lines;
}

function kml(groups) {
  const folders = groups.map(({ project, stations }) => {
    const pts = stations.filter((s) => s.location).sort(byTime);
    const marks = pts.map((st) => `
      <Placemark>
        <name>${xmlEsc(st.code)}</name>
        <description>${xmlEsc(describe(st).join('\n'))}</description>
        <TimeStamp><when>${new Date(recorded(st)).toISOString()}</when></TimeStamp>
        <styleUrl>#station</styleUrl>
        <Point><coordinates>${st.location.lon},${st.location.lat}${st.location.alt != null ? ',' + st.location.alt.toFixed(1) : ''}</coordinates></Point>
      </Placemark>`).join('');
    const line = pts.length > 1 ? `
      <Placemark>
        <name>${xmlEsc(project.name)} route</name>
        <styleUrl>#route</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>${pts.map((s) => `${s.location.lon},${s.location.lat}`).join(' ')}</coordinates></LineString>
      </Placemark>` : '';
    return `
    <Folder><name>${xmlEsc(project.name)}</name>${marks}${line}
    </Folder>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Lodestar field data</name>
    <Style id="station">
      <IconStyle><color>ff33c9f5</color><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>
    <Style id="route"><LineStyle><color>ff33c9f5</color><width>3</width></LineStyle></Style>${folders}
  </Document>
</kml>
`;
}

function gpx(groups) {
  const wpts = [];
  const rtes = [];
  for (const { project, stations } of groups) {
    const pts = stations.filter((s) => s.location).sort(byTime);
    for (const st of pts) {
      const L = st.location;
      wpts.push(`  <wpt lat="${L.lat.toFixed(7)}" lon="${L.lon.toFixed(7)}">${L.alt != null ? `<ele>${L.alt.toFixed(1)}</ele>` : ''}<time>${new Date(recorded(st)).toISOString()}</time><name>${xmlEsc(st.code)}</name><desc>${xmlEsc(describe(st).join('; '))}</desc><type>${xmlEsc(project.name)}</type><sym>Flag, Blue</sym></wpt>`);
    }
    if (pts.length > 1) {
      rtes.push(`  <rte><name>${xmlEsc(project.name)}</name>\n${pts.map((st) => `    <rtept lat="${st.location.lat.toFixed(7)}" lon="${st.location.lon.toFixed(7)}"><name>${xmlEsc(st.code)}</name></rtept>`).join('\n')}\n  </rte>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lodestar field notebook" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Lodestar field data</name><time>${new Date().toISOString()}</time></metadata>
${wpts.join('\n')}
${rtes.join('\n')}
</gpx>
`;
}

// ---------- Smart Photos ----------

/** Every photo of the chosen projects with its information strip, one folder per project. */
async function smartZip(groups, onProgress) {
  const files = {};
  const total = groups.reduce((n, g) => n + g.stations.reduce((m, s) => m + (s.photoIds || []).length, 0), 0);
  if (!total) throw new Error('ไม่มีรูปในโปรเจกต์ที่เลือก');
  const used = new Set();
  let done = 0;
  let failed = 0;
  for (const g of groups) {
    let folder = '';
    if (groups.length > 1) {
      folder = slug(g.project.name);
      for (let k = 2; used.has(folder); k++) folder = `${slug(g.project.name)}_${k}`;
      used.add(folder);
      folder += '/';
    }
    for (const st of g.stations) {
      const metas = await store.listPhotos(st);
      for (const [k, meta] of metas.entries()) {
        try {
          // the copy kept in the app when it is up to date, otherwise drawn now (and kept)
          const { file } = await smartFor(st, meta, k, metas.length, g.project);
          files[folder + smartName(st.code, k)] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
        } catch {
          failed += 1;
        }
        done += 1;
        onProgress?.(done, total);
      }
    }
  }
  if (!Object.keys(files).length) throw new Error('สร้าง Smart Photo ไม่สำเร็จ');
  if (failed) files['README.txt'] = strToU8(`${failed} photo(s) could not be made into Smart Photos.\n`);
  return zipSync(files, { level: 0 });
}

// ---------- building files ----------

const slug = (s) => (s || 'project').normalize('NFC').trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
const photoBase = (code) => code.replace(/[^A-Za-z0-9]/g, '');
const extFor = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' }[type] || 'jpg');

async function collect(projectIds) {
  const all = await store.listProjects();
  const ids = projectIds?.length ? projectIds : [store.getProject().id];
  const groups = [];
  for (const id of ids) {
    const project = all.find((p) => p.id === id);
    if (!project) continue;
    const stations = (await store.listStations(id)).sort((a, b) => a.number - b.number);
    groups.push({ project, stations });
  }
  return groups;
}

function tables(groups) {
  const t = { stations: [], structures: [], samples: [] };
  for (const { project, stations } of groups) {
    t.stations.push(...stations.map((s) => stationRow(s, project)));
    t.structures.push(...structureRows(stations, project));
    t.samples.push(...sampleRows(stations, project));
  }
  return t;
}

function workbook(t, photoRows = []) {
  return buildXlsx([
    { name: 'Stations', columns: STATION_COLS, rows: t.stations },
    { name: 'Structures', columns: STRUCT_COLS, rows: t.structures },
    { name: 'Samples', columns: SAMPLE_COLS, rows: t.samples },
    ...(photoRows.length ? [{ name: 'Photos', columns: PHOTO_COLS, rows: photoRows }] : []),
  ]);
}

const README = (groups) => `Lodestar field data export
Exported: ${new Date().toISOString()}
Projects: ${groups.map((g) => `${g.project.name} (${g.stations.length} stations)`).join(', ')}

stations.xlsx       Excel workbook: Stations, Structures, Samples and Photos sheets.
stations.csv        Stations table (UTF-8, opens in Excel / Google Sheets).
stations.geojson    Stations as points (WGS84). Drag into QGIS / ArcGIS.
structures.geojson  One point per strike/dip measurement (right-hand rule).
structures.csv      Same as CSV. method = sensor (measured with the phone) or manual (typed).
samples.csv         Sample IDs with station and location.
stations.kml        Open in Google Earth (stations + route in recorded order).
stations.gpx        Waypoints + route for GPS apps.
photos/             Photos named <station>_<nn>.jpg, listed in photos.csv (bearing_deg = direction
                    the camera faced, true north when a declination is set in Lodestar).
                    The photos are the originals; Smart Photos (with the info strip) are a
                    separate export.
project.json        Full backup of everything recorded in Lodestar.

Coordinates: lat/lon WGS84 (EPSG:4326); UTM columns use the zone in utm_zone (EPSG in utm_epsg).
grid_ref: 6-figure grid reference (100 m square, digits truncated as when reading a map);
mgrs: full MGRS to 1 m, e.g. 48QTD6885318979.
Elevation: metres above mean sea level when elev_ref says MSL.
date/time: when the station was recorded (NEW STATION pressed), not later edits.
`;

async function projectFolder(files, prefix, group, onPhoto) {
  const { project, stations } = group;
  const t = tables([group]);
  const photoRows = [];
  const photoMeta = [];
  for (const st of stations) {
    const metas = await store.listPhotos(st);
    let k = 0;
    for (const p of metas) {
      k += 1;
      const data = await store.getPhotoData(p.id);
      onPhoto?.();
      if (!data) continue;
      const file = `photos/${photoBase(st.code)}_${pad(k)}.${extFor(p.type)}`;
      files[prefix + file] = [new Uint8Array(data), { level: 0 }];
      photoRows.push({
        project: project.name, file, station: st.code, photo_no: k, width: p.width, height: p.height,
        taken_local: p.taken || null, added_utc: new Date(p.createdAt).toISOString(),
        bearing_deg: p.bearing ?? null, bearing_src: p.bearing != null ? p.bearingSrc : null,
      });
      photoMeta.push({
        id: p.id, stationId: st.id, file, type: p.type, width: p.width, height: p.height, createdAt: p.createdAt,
        taken: p.taken || null, bearing: p.bearing ?? null, bearingSrc: p.bearingSrc || null,
      });
    }
  }
  files[prefix + 'stations.xlsx'] = [workbook(t, photoRows), { level: 0 }];
  files[prefix + 'stations.csv'] = strToU8(toCSV(t.stations, STATION_COLS));
  files[prefix + 'stations.geojson'] = strToU8(JSON.stringify(featureCollection('stations', t.stations), null, 1));
  files[prefix + 'structures.geojson'] = strToU8(JSON.stringify(featureCollection('structures', t.structures), null, 1));
  files[prefix + 'structures.csv'] = strToU8(toCSV(t.structures, STRUCT_COLS));
  files[prefix + 'samples.csv'] = strToU8(toCSV(t.samples, SAMPLE_COLS));
  files[prefix + 'stations.kml'] = strToU8(kml([group]));
  files[prefix + 'stations.gpx'] = strToU8(gpx([group]));
  files[prefix + 'photos.csv'] = strToU8(toCSV(photoRows, PHOTO_COLS));
  const { bannerDismissed, ...settings } = store.getSettings();
  files[prefix + 'project.json'] = strToU8(JSON.stringify({
    app: 'GEO', version: store.APP_VERSION, exportedAt: new Date().toISOString(),
    project: { ...project, stats: undefined }, settings, stations, photos: photoMeta,
  }, null, 1));
}

/**
 * Build an export file.
 * @param {'zip'|'xlsx'|'csv'|'geojson'|'struct'|'kml'|'gpx'|'smart'} kind
 * @param {string[]} [projectIds] defaults to the current project
 */
export async function build(kind, projectIds, onProgress) {
  const groups = await collect(projectIds);
  if (!groups.length) throw new Error('ไม่พบโปรเจกต์ที่เลือก');
  const base = groups.length === 1
    ? `Lodestar_${slug(groups[0].project.name)}_${stamp()}`
    : `Lodestar_${groups.length}-projects_${stamp()}`;
  const t = tables(groups);

  switch (kind) {
    case 'xlsx':
      return new File([workbook(t)], `${base}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    case 'csv':
      return new File([toCSV(t.stations, STATION_COLS)], `${base}_stations.csv`, { type: 'text/csv' });
    case 'geojson':
      return new File([JSON.stringify(featureCollection('stations', t.stations), null, 1)], `${base}_stations.geojson`, { type: 'application/geo+json' });
    case 'struct':
      return new File([JSON.stringify(featureCollection('structures', t.structures), null, 1)], `${base}_structures.geojson`, { type: 'application/geo+json' });
    case 'kml':
      return new File([kml(groups)], `${base}.kml`, { type: 'application/vnd.google-earth.kml+xml' });
    case 'gpx':
      return new File([gpx(groups)], `${base}.gpx`, { type: 'application/gpx+xml' });
    case 'smart':
      return new File([await smartZip(groups, onProgress)], `${base}_smart-photos.zip`, { type: 'application/zip' });
    default: {
      const files = {};
      const total = groups.reduce((n, g) => n + g.stations.reduce((m, s) => m + (s.photoIds || []).length, 0), 0);
      let done = 0;
      const tick = () => { done += 1; onProgress?.(done, total); };
      if (groups.length === 1) {
        await projectFolder(files, '', groups[0], tick);
      } else {
        const used = new Set();
        for (const g of groups) {
          let folder = slug(g.project.name);
          for (let k = 2; used.has(folder); k++) folder = `${slug(g.project.name)}_${k}`;
          used.add(folder);
          await projectFolder(files, `${folder}/`, g, tick);
        }
      }
      files['README.txt'] = strToU8(README(groups));
      const zipped = zipSync(files, { level: 6 });
      return new File([zipped], `${base}.zip`, { type: 'application/zip' });
    }
  }
}

/** Hand the file to the share sheet (iPhone: Save to Files, LINE, Drive…) or download it. */
export async function deliver(file) {
  if (navigator.canShare && navigator.share) {
    let ok = false;
    try { ok = navigator.canShare({ files: [file] }); } catch { ok = false; }
    if (ok) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return 'shared';
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelled';
      }
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
