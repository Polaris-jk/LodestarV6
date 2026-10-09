// Line icons drawn for GEO (24×24 grid, stroke = currentColor).

const P = {
  gps: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4"/><path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4"/>',
  map: '<path d="M9 4.2 3.5 6.4v13.4L9 17.6l6 2.4 5.5-2.2V4.4L15 6.6 9 4.2z"/><path d="M9 4.2v13.4M15 6.6V20"/>',
  stations: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="M4.5 4.5v4M2.5 6.5h4"/><circle cx="4.5" cy="12" r="1.6"/><path d="M4.5 15.5v4M2.5 17.5h4" opacity=".55"/>',
  settings: '<path d="M4 7h9.5M17.5 7H20M4 17h3.5M11.5 17H20"/><circle cx="15.5" cy="7" r="2"/><circle cx="9.5" cy="17" r="2"/>',
  pin: '<path d="M12 21.2s-6.6-6.1-6.6-11.1a6.6 6.6 0 0 1 13.2 0c0 5-6.6 11.1-6.6 11.1z"/><circle cx="12" cy="10.1" r="2.3"/>',
  camera: '<path d="M4 8.2h3l1.6-2.5h6.8L17 8.2h3a1 1 0 0 1 1 1v9.1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.4"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="1.6"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="m21 15.6-5-5-8.6 8.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6.6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6.6"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2.4 5.7"/><path d="M20.2 4.5v7h-7"/>',
  target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="1.6"/>',
  check: '<path d="m4.8 12.6 4.6 4.6L19.4 7.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  sample: '<path d="m6 15.5 4.5-9 7.5 3.2-1.6 8.3-7.6 2z"/><path d="m10.5 6.5 1.4 7.3 4.5 3.7M11.9 13.8 6 15.5"/>',
  photo: '<rect x="3.5" y="6" width="17" height="13" rx="1.5"/><path d="M8.5 6 10 4h4l1.5 2"/><circle cx="12" cy="12.5" r="3"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".7" fill="currentColor"/>',
  chevron: '<path d="m7 9.5 5 5 5-5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.6"/><path d="M15.5 8.5V5.6A1.6 1.6 0 0 0 13.9 4H5.6A1.6 1.6 0 0 0 4 5.6v8.3a1.6 1.6 0 0 0 1.6 1.6h2.9"/>',
  folder: '<path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h4.3l2 2.2h7.5a1.6 1.6 0 0 1 1.6 1.6v9.6a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/>',
  clino: '<path d="M3 19.5h18"/><path d="M4.5 19.5a7.5 7.5 0 0 1 15 0"/><path d="m12 19.5 4.6-6.4"/><path d="M3.5 15.2 20.5 8.8" opacity=".55"/>',
  compass: '<circle cx="12" cy="12" r="8.6"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4z"/>',
  edit: '<path d="M4 20h4L19.2 8.8a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/><path d="m13.5 6.5 4 4"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

/** The geological strike/dip map symbol, rotated to the strike azimuth (right-hand rule). */
export function strikeDipSymbol(strike, cls = 'sdsym') {
  const r = Number.isFinite(strike) ? strike : 0;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${r}deg)"><path d="M12 2.5v19M12 12h6.5"/></svg>`;
}
