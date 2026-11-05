import { useEffect, useMemo, useRef, useState } from 'react'

// One worker for the whole session: Python loads once, then stays warm.
let worker = null
const listeners = new Set()
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('pyworker.js', document.baseURI))
    worker.onmessage = (e) => listeners.forEach((fn) => fn(e.data))
    worker.onerror = (e) => listeners.forEach((fn) => fn({ type: 'error', message: e.message || 'The analysis engine failed to start.' }))
    worker.postMessage({ type: 'init' })
  }
  return worker
}

const KIND = {
  membrane: 'outlines fibers', nuclear: 'nuclei', marker: 'counted cells', fibertype: 'fiber type',
  area: '% area', intensity: 'intensity per fiber',
}
const GROUP_COLORS = ['#2563eb', '#e4572e', '#1ea872', '#e8b01c']

function download(name, data, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function Markdown({ text }) {
  const lines = text.split('\n').slice(1)
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))
  const out = []
  let list = []
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list}</ul>); list = [] } }
  lines.forEach((l, i) => {
    if (l.startsWith('- ')) list.push(<li key={i}>{bold(l.slice(2))}</li>)
    else {
      flush()
      if (l.startsWith('## ')) out.push(<h4 key={i}>{l.slice(3)}</h4>)
      else if (l.startsWith('_')) out.push(<p key={i} className="muted small"><i>{l.replace(/_/g, '')}</i></p>)
      else if (l.trim()) out.push(<p key={i}>{bold(l)}</p>)
    }
  })
  flush()
  return <div className="md">{out}</div>
}

const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Number(v).toPrecision(d))
const fmtP = (p) => (p === null || p === undefined ? '–' : p < 0.0001 ? '< 0.0001' : p.toPrecision(2))

export default function Analyze() {
  const [engine, setEngine] = useState({ ready: false, text: 'Starting the analysis engine…', library: [] })
  const [mode, setMode] = useState('fluor')
  const [name, setName] = useState('My experiment')
  const [px, setPx] = useState(0.65)
  const [channels, setChannels] = useState(['dapi', 'laminin', 'pax7', 'myod'])
  const [bright, setBright] = useState(['hema', 'dab'])
  const [groups, setGroups] = useState([['Wild-type', 'WT'], ['Mutant', 'MUT']])
  const [animalRegex, setAnimalRegex] = useState('_M(\\d+)_')
  const [files, setFiles] = useState([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [overlay, setOverlay] = useState('')
  const [tab, setTab] = useState('summary')
  const t0 = useRef(0)

  useEffect(() => {
    const fn = (m) => {
      if (m.type === 'status') setEngine((e) => ({ ...e, text: m.text }))
      if (m.type === 'ready') setEngine({ ready: true, text: 'Ready', library: m.library })
      if (m.type === 'progress') setBusy({ i: m.i, n: m.n, name: m.name })
      if (m.type === 'result') {
        setBusy(null); setResult(m.result); setTab('summary')
        setOverlay(Object.keys(m.result.overlays)[0] || '')
      }
      if (m.type === 'error') { setBusy(null); setError(m.message) }
    }
    listeners.add(fn)
    getWorker()
    return () => listeners.delete(fn)
  }, [])

  const lib = engine.library
  const byId = useMemo(() => Object.fromEntries(lib.map((s) => [s.id, s])), [lib])
  const fluorLib = lib.filter((s) => s.mode === 'fluor')
  const brightLib = lib.filter((s) => s.mode === 'bright')
  const chosen = (mode === 'fluor' ? channels : bright).map((id) => byId[id]).filter(Boolean)
  const kinds = new Set(chosen.map((s) => s.kind))
  const measures = []
  if (kinds.has('membrane') || (mode === 'bright' && chosen.length)) measures.push('Fiber size (CSA, min Feret) and size variability')
  if (kinds.has('nuclear')) measures.push('Nuclei per fiber and centrally nucleated fibers')
  chosen.filter((s) => s.kind === 'fibertype').forEach((s) => measures.push(`${s.name}+ fibers (%)`))
  chosen.filter((s) => s.kind === 'marker').forEach((s) => measures.push(`${s.name}+ cells per 100 fibers`))
  chosen.filter((s) => s.kind === 'area').forEach((s) => measures.push(`${s.name} area (% of tissue)`))
  chosen.filter((s) => s.kind === 'intensity').forEach((s) => measures.push(`${s.name} intensity per fiber`))
  const missingMembrane = mode === 'fluor' && !kinds.has('membrane')

  const config = () => {
    const cfg = {
      name, pixel_size_um: Number(px), mode, animal_regex: animalRegex,
      groups: Object.fromEntries(groups.filter(([g, p]) => g && p).map(([g, p]) => [g, `*${p}*`])),
    }
    if (mode === 'fluor') cfg.channels = Object.fromEntries(channels.map((c, i) => [i, c]))
    else cfg.stains = bright
    return cfg
  }

  async function runUpload() {
    setError(''); setResult(null); t0.current = Date.now()
    setBusy({ i: 0, n: files.length, name: 'Reading files…' })
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })))
    getWorker().postMessage({ type: 'run', files: payload, config: config() }, payload.map((p) => p.buffer))
  }
  function runSample() {
    setError(''); setResult(null); setBusy({ i: 0, n: 4, name: 'Generating sample images…' })
    getWorker().postMessage({ type: 'sample', mode })
  }

  const overlayUrl = useMemo(() => {
    if (!result || !overlay || !result.overlays[overlay]) return ''
    return URL.createObjectURL(new Blob([result.overlays[overlay]], { type: 'image/png' }))
  }, [result, overlay])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Analyze your images</h1>
          <p className="muted">The real FiberSight engine, running entirely in your browser. <b>Your images never leave your computer.</b></p>
        </div>
        <span className={'pill ' + (engine.ready ? 'ok' : 'run')}>{engine.ready ? 'Engine ready' : engine.text}</span>
      </header>
      {!engine.ready && (
        <div className="card notice">
          <b>{engine.text}</b>
          <span className="muted small">The first load downloads Python and its science libraries (about 30 seconds). After that it stays ready until you close the tab.</span>
          <div className="bar"><div className="indeterminate" /></div>
        </div>
      )}

      <div className="an-grid">
        <div>
          <section className="card step">
            <h2><span className="num">1</span> Experiment</h2>
            <div className="row2">
              <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label>Pixel size (µm per pixel)<input type="number" step="0.01" min="0.01" value={px} onChange={(e) => setPx(e.target.value)} /></label>
            </div>
            <div className="seg">
              <button className={mode === 'fluor' ? 'on' : ''} onClick={() => setMode('fluor')}>Immunofluorescence</button>
              <button className={mode === 'bright' ? 'on' : ''} onClick={() => setMode('bright')}>Brightfield / IHC</button>
            </div>
          </section>

          <section className="card step">
            <h2><span className="num">2</span> Stains</h2>
            {mode === 'fluor' ? (
              <>
                <p className="muted small">One row per channel, in the order they are stored in your TIFF files.</p>
                {channels.map((c, i) => (
                  <div key={i} className="chrow">
                    <span className="mono">Channel {i}</span>
                    <select value={c} onChange={(e) => setChannels(channels.map((x, j) => (j === i ? e.target.value : x)))}>
                      {fluorLib.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.target}</option>)}
                    </select>
                    <span className="muted small kind">{KIND[byId[c]?.kind] || ''}</span>
                    <button className="x" disabled={channels.length <= 1} onClick={() => setChannels(channels.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button onClick={() => setChannels([...channels, 'mhc1'])} disabled={channels.length >= 8}>+ Add channel</button>
              </>
            ) : (
              <>
                <p className="muted small">Pick up to 3 stains in your RGB images. FiberSight separates them by color.</p>
                <div className="lib">
                  {brightLib.map((s) => (
                    <button key={s.id} className={'libitem' + (bright.includes(s.id) ? ' on' : '')}
                      onClick={() => setBright(bright.includes(s.id) ? bright.filter((x) => x !== s.id) : bright.length < 3 ? [...bright, s.id] : bright)}>
                      <div><b>{s.name}</b><span>{s.target}</span><em>{KIND[s.kind]}</em></div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card step">
            <h2><span className="num">3</span> Groups</h2>
            <p className="muted small">Images join a group when their file name contains the text. The first group is the reference.</p>
            {groups.map(([g, p], i) => (
              <div key={i} className="row2">
                <label>Group {i + 1}<input value={g} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} /></label>
                <label>File name contains<input value={p} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} /></label>
              </div>
            ))}
            <label>Animal ID pattern (optional)<input className="mono" value={animalRegex} onChange={(e) => setAnimalRegex(e.target.value)} /></label>
            <p className="muted small">Default reads animal 3 from names like <span className="mono">WT_M3_s02.tif</span>, so statistics use animals, not images. Clear it to use images.</p>
          </section>
        </div>

        <div>
          <section className="card step">
            <h2><span className="num">4</span> Images</h2>
            <div className={'drop' + (drag ? ' over' : '')}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); setFiles([...e.dataTransfer.files]) }}>
              {files.length ? <b>{files.length} images selected</b> : <b>Drop a whole experiment here</b>}
              <span className="muted small">Multi-channel TIFF for fluorescence · RGB TIFF, PNG or JPG for brightfield</span>
              <label className="filebtn">Browse<input type="file" multiple accept=".tif,.tiff,.png,.jpg,.jpeg" onChange={(e) => setFiles([...e.target.files])} /></label>
            </div>
            <div className="actions2">
              <button className="primary" disabled={!engine.ready || !files.length || !!busy || missingMembrane} onClick={runUpload}>
                Analyze {files.length || ''} images
              </button>
              <button disabled={!engine.ready || !!busy} onClick={runSample}>Try sample data</button>
            </div>
          </section>
          <section className="card step">
            <h2>FiberSight will measure</h2>
            {missingMembrane && <p className="warnt small">Add a membrane stain (laminin, dystrophin or WGA) so fibers can be outlined.</p>}
            <ul className="measures-list">{measures.map((m) => <li key={m}>{m}</li>)}</ul>
          </section>
        </div>
      </div>

      {busy && (
        <div className="card running-real">
          <h3>{busy.i ? `Analyzed ${busy.i} of ${busy.n}` : busy.name}</h3>
          <div className="bar"><div style={{ width: `${busy.n ? (100 * busy.i) / busy.n : 0}%` }} /></div>
          {busy.i > 0 && <p className="muted small mono">{busy.name}</p>}
          <p className="muted small">Running in your browser. Large images can take 10–20 seconds each; keep this tab open.</p>
        </div>
      )}
      {error && <div className="card errorbox"><b>Analysis stopped.</b> {error}</div>}

      {result && (
        <section className="results">
          <h2 className="res-title">Results · {result.name}</h2>
          <section className="stats">
            <div className="stat card"><div className="big">{result.n_images}</div><div className="muted small">images</div></div>
            <div className="stat card"><div className="big">{result.n_fibers.toLocaleString()}</div><div className="muted small">fibers measured</div></div>
            <div className="stat card accent"><div className="big">{Math.round(result.seconds)} s</div><div className="muted small">analysis time, same settings on every image</div></div>
          </section>
          <div className="tabs">
            {[['summary', 'Summary'], ['groups', 'Group comparison'], ['images', 'Per image'], ['review', 'Review images'], ['download', 'Download']].map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'summary' && <div className="card"><Markdown text={result.summary} /></div>}
          {tab === 'groups' && (
            <div className="card scroll">
              <table className="tbl">
                <thead><tr><th>Measure</th>{result.groups.map((g, i) => <th key={g}><i className="sw" style={{ background: GROUP_COLORS[i] }} />{g}</th>)}<th>% diff.</th><th>p</th></tr></thead>
                <tbody>
                  {result.per_group.map((r) => (
                    <tr key={r.measure}>
                      <td>{r.label}</td>
                      {result.groups.map((g) => <td key={g}>{fmt(r[`${g} mean`])} <span className="muted small">± {fmt(r[`${g} SD`], 2)} (n={r[`${g} n`]})</span></td>)}
                      <td>{r['% difference'] === undefined || r['% difference'] === null ? '–' : `${r['% difference'] > 0 ? '+' : ''}${Math.round(r['% difference'])}%`}</td>
                      <td className={r.p_value < 0.05 ? 'sig' : 'muted'}>{fmtP(r.p_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Welch's t-test, n = {result.per_group[0]?.['unit of n']}.</p>
            </div>
          )}
          {tab === 'images' && (
            <div className="card scroll">
              <table className="tbl mini2">
                <thead><tr>{result.per_image_cols.map((c) => <th key={c}>{result.labels[c]}</th>)}</tr></thead>
                <tbody>{result.per_image.map((r, i) => <tr key={i}>{result.per_image_cols.map((c) => <td key={c}>{typeof r[c] === 'number' ? fmt(r[c]) : r[c]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {tab === 'review' && (
            <div className="card">
              <select value={overlay} onChange={(e) => setOverlay(e.target.value)}>
                {Object.keys(result.overlays).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {overlayUrl && <img className="overlay-img" src={overlayUrl} alt={`Analysis overlay for ${overlay}`} />}
              <p className="muted small">Yellow = measured fibers · gray = excluded (touching the edge) · dots = fiber type (green I, red IIa, gray IIx, yellow IIb) · pink circles = marker+ cells · cyan squares = central nuclei</p>
            </div>
          )}
          {tab === 'download' && (
            <div className="card downloads">
              <button className="primary" onClick={() => download(`${result.name}_FiberSight.zip`, result.zip, 'application/zip')}>Download everything (.zip)</button>
              <button onClick={() => download('per_fiber.csv', result.csv.per_fiber, 'text/csv')}>per_fiber.csv</button>
              <button onClick={() => download('per_image.csv', result.csv.per_image, 'text/csv')}>per_image.csv</button>
              <button onClick={() => download('per_group.csv', result.csv.per_group, 'text/csv')}>per_group.csv</button>
              <p className="muted small">Thresholds used for every image: {Object.entries(result.thresholds).map(([k, v]) => `${k} ${v}`).join(', ') || 'none needed'}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
