// Synthetic data + analysis engine for the FiberSight prototype.
// Every image is generated from a seed, so the demo is reproducible.
// Nothing here is real experimental data.

export const FIELD_UM = 400 // field of view width in µm (height = 300 µm)
export const ASPECT = 0.75
export const AW = 160 // analysis raster width (2.5 µm / px)
export const AH = 120
const PX_AREA = (FIELD_UM / AW) ** 2

export const STAIN_LIBRARY = [
  { id: 'dapi', name: 'DAPI', target: 'All nuclei', kind: 'nuclear', color: '#4f8cff', mode: 'fluor' },
  { id: 'laminin', name: 'Laminin', target: 'Fiber membrane', kind: 'membrane', color: '#e8e8e8', mode: 'fluor' },
  { id: 'dystrophin', name: 'Dystrophin', target: 'Fiber membrane', kind: 'membrane', color: '#8be28f', mode: 'fluor' },
  { id: 'pax7', name: 'Pax7', target: 'Satellite (stem) cells', kind: 'marker', marker: 'pax7', color: '#ff4d6d', mode: 'fluor' },
  { id: 'myod', name: 'MyoD', target: 'Activated myoblasts', kind: 'marker', marker: 'myod', color: '#ffa62b', mode: 'fluor' },
  { id: 'ki67', name: 'Ki67', target: 'Proliferating cells', kind: 'marker', marker: 'ki67', color: '#f15bb5', mode: 'fluor' },
  { id: 'mhc1', name: 'MyHC I', target: 'Slow fibers', kind: 'fibertype', ftype: 'I', color: '#3ddc97', mode: 'fluor' },
  { id: 'mhc2a', name: 'MyHC IIa', target: 'Fast oxidative fibers', kind: 'fibertype', ftype: 'IIa', color: '#ff5c5c', mode: 'fluor' },
  { id: 'mhc2b', name: 'MyHC IIb', target: 'Fast glycolytic fibers', kind: 'fibertype', ftype: 'IIb', color: '#ffd23f', mode: 'fluor' },
  { id: 'emhc', name: 'eMyHC', target: 'Regenerating fibers', kind: 'fibertype', ftype: 'regen', color: '#c77dff', mode: 'fluor' },
  { id: 'col1', name: 'Collagen I', target: 'Fibrosis / ECM', kind: 'area', color: '#4cc9f0', mode: 'fluor' },
  { id: 'hema', name: 'Hematoxylin', target: 'Nuclei', kind: 'nuclear', color: '#3b3f9e', mode: 'bright' },
  { id: 'dab', name: 'Myosin (DAB)', target: 'Myosin content', kind: 'intensity', color: '#7a4a1e', mode: 'bright' },
  { id: 'apred', name: 'Actin (AP Red)', target: 'Actin content', kind: 'area', color: '#c0283a', mode: 'bright' },
  { id: 'sirius', name: 'Picrosirius Red', target: 'Collagen / fibrosis', kind: 'area', color: '#b3122e', mode: 'bright' },
]

export const KIND_LABEL = {
  nuclear: 'Nuclear stain',
  membrane: 'Membrane / outline',
  marker: 'Cell marker (counted)',
  fibertype: 'Fiber-type marker',
  area: 'Area stain (% coverage)',
  intensity: 'Intensity stain (OD)',
}

// ---------- random ----------
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) => {
  const u = 1 - r(), v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const pick = (r, probs) => {
  const x = r()
  let acc = 0
  for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (x < acc) return i }
  return probs.length - 1
}
const TYPES = ['I', 'IIa', 'IIx', 'IIb']

// ---------- experiments ----------
const DEFAULT_FX = {
  size: 1, typeProbs: [0.1, 0.3, 0.3, 0.3], regen: 0.03, central: 0.03,
  pax7: 0.06, myod: 0.03, ki67: 0.03, areaFrac: 1, intensity: 0.62,
}

export const PRESETS = [
  {
    id: 'exp-sat',
    name: 'c-subunit leak: satellite cells',
    note: 'Pax7 / MyoD staging in mutant vs. wild-type quadriceps',
    channels: ['dapi', 'laminin', 'pax7', 'myod'],
    nImages: 128,
    groups: [
      { name: 'Wild-type', fx: {} },
      { name: 'c-sub mutant', fx: { size: 0.86, pax7: 0.035, myod: 0.055, central: 0.07 } },
    ],
  },
  {
    id: 'exp-ftype',
    name: 'Fiber typing: gastrocnemius',
    note: 'MyHC I / IIa / IIb panel, IIx inferred as unstained',
    channels: ['dapi', 'laminin', 'mhc1', 'mhc2a', 'mhc2b'],
    nImages: 112,
    groups: [
      { name: 'Wild-type', fx: { typeProbs: [0.08, 0.27, 0.27, 0.38] } },
      { name: 'c-sub mutant', fx: { size: 0.9, typeProbs: [0.17, 0.33, 0.25, 0.25] } },
    ],
  },
  {
    id: 'exp-dab',
    name: 'Myosin / actin IHC (brightfield)',
    note: 'Dual-chromogen DAB + AP Red, area and intensity',
    channels: ['hema', 'dab', 'apred'],
    nImages: 104,
    groups: [
      { name: 'Wild-type', fx: {} },
      { name: 'c-sub mutant', fx: { intensity: 0.5, areaFrac: 1.35, size: 0.9 } },
    ],
  },
]

export function resolveChannels(ids, custom = []) {
  const lib = [...STAIN_LIBRARY, ...custom]
  return ids.map((id) => lib.find((s) => s.id === id)).filter(Boolean)
}

// ---------- image generation ----------
export function makeImageList(exp) {
  const per = Math.ceil(exp.nImages / exp.groups.length)
  const list = []
  let k = 0
  exp.groups.forEach((g, gi) => {
    const nAnimals = 4
    for (let i = 0; i < per && k < exp.nImages; i++, k++) {
      const animal = (i % nAnimals) + 1
      const section = Math.floor(i / nAnimals) + 1
      list.push({
        idx: k, group: gi, seed: hash(exp.id) + k * 7919,
        name: `${g.name.replace(/[^A-Za-z0-9]+/g, '')}_M${animal}_s${String(section).padStart(2, '0')}.tif`,
      })
    }
  })
  return list
}
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

export function generateImage(exp, meta) {
  const fx = { ...DEFAULT_FX, ...exp.groups[meta.group].fx }
  const r = rng(meta.seed)
  const target = Math.round((52 / (fx.size * fx.size)) * (0.9 + r() * 0.2))
  const minD = 0.62 * Math.sqrt((ASPECT) / target)
  const seeds = []
  let tries = 0
  while (seeds.length < target && tries < 20000) {
    tries++
    const x = r(), y = r() * ASPECT
    if (seeds.every(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 > minD * minD)) seeds.push([x, y])
  }
  const n = seeds.length
  // analysis raster
  const area = new Float64Array(n), cx = new Float64Array(n), cy = new Float64Array(n)
  const edge = new Uint8Array(n)
  let interstitial = 0
  const thr = 0.0055 * fx.areaFrac
  for (let py = 0; py < AH; py++) {
    for (let px = 0; px < AW; px++) {
      const x = (px + 0.5) / AW, y = ((py + 0.5) / AH) * ASPECT
      const [i, , , gap] = nearest2(seeds, x, y)
      if (gap < thr) { interstitial++; continue }
      area[i]++; cx[i] += x; cy[i] += y
      if (px === 0 || py === 0 || px === AW - 1 || py === AH - 1) edge[i] = 1
    }
  }
  const fibers = []
  for (let i = 0; i < n; i++) {
    const a = area[i] || 1
    fibers.push({
      i, areaUm: area[i] * PX_AREA, cx: cx[i] / a, cy: cy[i] / a, r: Math.sqrt((a / (AW * AW)) / Math.PI),
      edge: !!edge[i] || area[i] < 4,
      type: TYPES[pick(r, fx.typeProbs)],
      regen: r() < fx.regen,
      central: r() < fx.central,
      intensity: Math.max(0.15, Math.min(1, fx.intensity + gauss(r) * 0.09)),
    })
  }
  // nuclei
  const nuclei = []
  fibers.forEach((f) => {
    if (f.areaUm < 30) return
    const k = 1 + Math.floor(r() * 2.2)
    for (let j = 0; j < k; j++) {
      const ang = r() * Math.PI * 2
      nuclei.push({ x: f.cx + Math.cos(ang) * f.r * 0.92, y: f.cy + Math.sin(ang) * f.r * 0.92, f: f.i })
    }
    if (f.central) nuclei.push({ x: f.cx + (r() - 0.5) * f.r * 0.3, y: f.cy + (r() - 0.5) * f.r * 0.3, f: f.i, central: true })
    for (const m of ['pax7', 'myod', 'ki67']) {
      if (r() < fx[m]) {
        const ang = r() * Math.PI * 2
        nuclei.push({ x: f.cx + Math.cos(ang) * f.r * 1.0, y: f.cy + Math.sin(ang) * f.r * 1.0, f: f.i, [m]: true })
      }
    }
  })
  // QC artifacts
  let artifact = null
  const qr = r()
  if (qr < 0.035) {
    const y0 = 0.15 + r() * 0.45
    artifact = { kind: 'fold', y0, y1: y0 + 0.06 + r() * 0.04, slope: (r() - 0.5) * 0.3, label: 'Tissue fold detected' }
    fibers.forEach((f) => {
      const yy = artifact.y0 + artifact.slope * f.cx
      if (f.cy > yy - 0.02 && f.cy < yy + (artifact.y1 - artifact.y0) + 0.02) f.inFold = true
    })
  } else if (qr < 0.06) {
    artifact = { kind: 'blur', label: 'Out of focus — please review' }
  }
  return { seeds, fibers, nuclei, artifact, interstitialFrac: interstitial / (AW * AH) }
}

// Returns [index, d1, d2, gap]. Coordinates are gently warped so fibers look
// rounded and organic instead of straight-edged polygons; triple junctions get
// a little interstitial space, like real muscle cross-sections.
export function nearest2(seeds, x, y) {
  const wx = x + 0.006 * Math.sin(y * 41 + x * 7) + 0.004 * Math.sin(y * 97 - x * 23)
  const wy = y + 0.006 * Math.sin(x * 37 - y * 5) + 0.004 * Math.sin(x * 89 + y * 31)
  let i1 = 0, d1 = 1e9, d2 = 1e9, d3 = 1e9
  for (let i = 0; i < seeds.length; i++) {
    const dx = seeds[i][0] - wx, dy = seeds[i][1] - wy
    const d = dx * dx + dy * dy
    if (d < d1) { d3 = d2; d2 = d1; d1 = d; i1 = i } else if (d < d2) { d3 = d2; d2 = d } else if (d < d3) d3 = d
  }
  d1 = Math.sqrt(d1); d2 = Math.sqrt(d2); d3 = Math.sqrt(d3)
  const gap = Math.min(d2 - d1, (d3 - d1) * 0.42 - 0.0016)
  return [i1, d1, d2, gap]
}

// ---------- measurements ----------
export function metricDefs(channels) {
  const has = (k) => channels.some((c) => c.kind === k)
  const segments = has('membrane') || has('intensity')
  const defs = []
  if (segments) {
    defs.push({ key: 'count', label: 'Fibers analyzed', unit: 'per field', fmt: 0 })
    defs.push({ key: 'csa', label: 'Mean fiber CSA', unit: 'µm²', fmt: 0 })
  }
  if (segments && has('nuclear')) defs.push({ key: 'central', label: 'Centrally nucleated fibers', unit: '%', fmt: 1 })
  const ft = channels.filter((c) => c.kind === 'fibertype')
  ft.forEach((c) => defs.push({ key: 'ft:' + c.ftype, label: `${c.name}+ fibers`, unit: '%', fmt: 1, color: c.color }))
  if (ft.some((c) => c.ftype !== 'regen') && ft.filter((c) => c.ftype !== 'regen').length >= 3)
    defs.push({ key: 'ft:IIx', label: 'IIx fibers (unstained)', unit: '%', fmt: 1, color: '#888' })
  channels.filter((c) => c.kind === 'marker').forEach((c) =>
    defs.push({ key: 'mk:' + c.marker, label: `${c.name}+ cells`, unit: 'per 100 fibers', fmt: 1, color: c.color }))
  channels.filter((c) => c.kind === 'area').forEach((c) =>
    defs.push({ key: 'area:' + c.id, label: `${c.name} area`, unit: '% of tissue', fmt: 1, color: c.color }))
  channels.filter((c) => c.kind === 'intensity').forEach((c) =>
    defs.push({ key: 'int:' + c.id, label: `${c.name} intensity`, unit: 'mean OD', fmt: 2, color: c.color }))
  return defs
}

export function analyze(img, defs, excluded = new Set()) {
  const use = img.fibers.filter((f) => !f.edge && !f.inFold && !excluded.has(f.i))
  const n = use.length || 1
  const out = { usable: use.length, autoExcluded: img.fibers.filter((f) => f.edge || f.inFold).length, csaList: use.map((f) => f.areaUm) }
  for (const d of defs) {
    const [k, sub] = d.key.split(':')
    if (k === 'count') out[d.key] = use.length
    else if (k === 'csa') out[d.key] = use.reduce((s, f) => s + f.areaUm, 0) / n
    else if (k === 'central') out[d.key] = (100 * use.filter((f) => f.central).length) / n
    else if (k === 'ft') out[d.key] = (100 * use.filter((f) => (sub === 'regen' ? f.regen : f.type === sub)).length) / n
    else if (k === 'mk') {
      const ids = new Set(use.map((f) => f.i))
      out[d.key] = (100 * img.nuclei.filter((nu) => nu[sub] && ids.has(nu.f)).length) / n
    } else if (k === 'area') out[d.key] = 100 * img.interstitialFrac
    else if (k === 'int') out[d.key] = use.reduce((s, f) => s + f.intensity, 0) / n
  }
  return out
}

// ---------- stats ----------
export function summarize(vals) {
  const n = vals.length
  const mean = vals.reduce((a, b) => a + b, 0) / (n || 1)
  const sd = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { n, mean, sd, sem: sd / Math.sqrt(n || 1) }
}

export function welch(a, b) {
  const A = summarize(a), B = summarize(b)
  const va = A.sd ** 2 / A.n, vb = B.sd ** 2 / B.n
  const t = (A.mean - B.mean) / Math.sqrt(va + vb || 1e-12)
  const df = (va + vb) ** 2 / ((va * va) / (A.n - 1) + (vb * vb) / (B.n - 1) || 1e-12)
  const p = betai(df / 2, 0.5, df / (df + t * t))
  return { t, df, p }
}
function betai(a, b, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}
function betacf(a, b, x) {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d; h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2))
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return h
}
function lgamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let x = z, y = z, tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const c of g) ser += c / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

export const fmtP = (p) => (p < 0.0001 ? 'p < 0.0001' : `p = ${p.toFixed(p < 0.01 ? 4 : 3)}`)
