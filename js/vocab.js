// Field vocabulary. Edit these lists to suit your course or study area.

// Quick picks for lithology: rock types mapped in Khon Kaen province
// (กรมทรัพยากรธรณี, "ธรณีวิทยาของจังหวัดขอนแก่น"): Khorat Group (sandstone, siltstone,
// mudstone, conglomerate, gypsum lenses), Maha Sarakham Fm (rock salt), Dok Du, Huai Som
// and Pha Nok Khao Fms (shale, limestone, chert) and Permo-Triassic volcanics near Chum Phae.
// Rocks only: Quaternary sediments (Qa, Qt) are left out. Anything else can be typed.
// [English (stored and exported), Thai]
export const LITHOLOGY = [
  ['Sandstone', 'หินทราย'],
  ['Siltstone', 'หินทรายแป้ง'],
  ['Mudstone', 'หินโคลน'],
  ['Conglomerate', 'หินกรวดมน'],
  ['Pebbly sandstone', 'หินทรายปนกรวด'],
  ['Shale', 'หินดินดาน'],
  ['Limestone', 'หินปูน'],
  ['Chert', 'หินเชิร์ต'],
  ['Rock salt', 'เกลือหิน'],
  ['Gypsum', 'ยิปซัม'],
  ['Volcanic rock', 'หินภูเขาไฟ'],
];
export const LITHOLOGY_AREA = 'จังหวัดขอนแก่น';

// Weathering grades (ISRM / BS 5930)
export const WEATHERING = [
  ['W1', 'Fresh', 'สด ไม่ผุ'],
  ['W2', 'Slightly weathered', 'ผุเล็กน้อย'],
  ['W3', 'Moderately weathered', 'ผุปานกลาง'],
  ['W4', 'Highly weathered', 'ผุมาก'],
  ['W5', 'Completely weathered', 'ผุทั้งหมด'],
  ['W6', 'Residual soil', 'ดินเกิดกับที่'],
];

export const STRUCTURE_TYPES = [
  ['Bedding', 'แนวชั้นหิน'],
  ['Joint', 'รอยแตก'],
  ['Fault', 'รอยเลื่อน'],
  ['Foliation', 'ริ้วขนาน'],
  ['Cleavage', 'แนวแตกเรียบ'],
  ['Vein', 'สายแร่'],
  ['Contact', 'รอยสัมผัส'],
  ['Other', 'อื่น ๆ'],
];

export const COLORS = [
  'Light grey', 'Dark grey', 'Greenish grey', 'Bluish grey',
  'Reddish brown', 'Brown', 'Yellowish brown', 'Red', 'Maroon', 'Purple',
  'White', 'Buff', 'Black',
];

const norm = (s) => String(s || '').trim().toLowerCase();

/** Look up a typed lithology (English or Thai) in the quick-pick list. */
export function lithInfo(v) {
  const k = norm(v);
  if (!k) return null;
  const hit = LITHOLOGY.find(([en, th]) => norm(en) === k || norm(th) === k);
  return hit ? { en: hit[0], th: hit[1] } : null;
}

/** Lithology as written in lists and exports. */
export const lithName = (st) => String(st.lithology || '').trim();

export function weatheringLabel(code) {
  const w = WEATHERING.find((x) => x[0] === code);
  return w ? `${w[0]} ${w[1]}` : '';
}
