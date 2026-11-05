import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PRESETS, STAIN_LIBRARY, KIND_LABEL, resolveChannels, makeImageList, generateImage,
  metricDefs, analyze, summarize, welch, fmtP,
} from './data.js'
import { renderImage, TYPE_COLOR } from './render.js'

const GROUP_COLORS = ['#2563eb', '#e4572e']
const cache = new Map() // `${expId}:${idx}` -> generated image

function getImg(exp, meta) {
  const k = `${exp.id}:${meta.idx}`
  if (!cache.has(k)) cache.set(k, generateImage(exp, meta))
  return cache.get(k)
}

function initExp(p, custom = []) {
  return {
    ...p,
    custom,
    channels: resolveChannels(p.channels, custom),
    images: makeImageList(p),
    status: 'queued',
    progress: 0,
    results: {},
    excluded: {},
    reviewed: {},
  }
}

export default function App() {
  const [exps, setExps] = useState(() => PRESETS.map((p) => initExp(p)))
  const [view, setView] = useState({ page: 'home' })
  const [manualMin, setManualMin] = useState(15)
  const update = (id, fn) => setExps((es) => es.map((e) => (e.id === id ? fn(e) : e)))
  const exp = view.page === 'exp' ? exps.find((e) => e.id === view.id) : null

  function run(id) {
    const e = exps.find((x) => x.id === id)
    const defs = metricDefs(e.channels)
    update(id, (x) => ({ ...x, status: 'running', progress: 0, results: {}, startedAt: performance.now() }))
    let i = 0
    const step = () => {
      const t0 = performance.now()
      const batch = {}
      while (i < e.images.length && performance.now() - t0 < 30) {
        const meta = e.images[i]
        batch[i] = analyze(getImg(e, meta), defs)
        i++
      }
      const done = i >= e.images.length
      update(id, (x) => ({
        ...x, results: { ...x.results, ...batch }, progress: i,
        status: done ? 'done' : 'running',
        elapsed: done ? (performance.now() - x.startedAt) / 1000 : x.elapsed,
      }))
      if (!done) setTimeout(step, 60)
    }
    setTimeout(step, 50)
  }

  function createExp(spec) {
    const id = 'exp-' + Date.now()
    const e = initExp({ ...spec, id }, spec.custom)
    setExps((es) => [e, ...es])
    setView({ page: 'exp', id, tab: 'overview' })
    setTimeout(() => runRef.current(id), 100)
  }
  const runRef = useRef(run)
  runRef.current = run

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo" onClick={() => setView({ page: 'home' })}>
          <Logo /> <span>FiberSight</span>
        </div>
        <nav>
          <button className={view.page === 'home' ? 'on' : ''} onClick={() => setView({ page: 'home' })}>Experiments</button>
          <button className={view.page === 'new' ? 'on' : ''} onClick={() => setView({ page: 'new' })}>+ New experiment</button>
        </nav>
        <div className="side-list">
          {exps.map((e) => (
            <button key={e.id} className={exp?.id === e.id ? 'on' : ''} onClick={() => setView({ page: 'exp', id: e.id, tab: 'overview' })}>
              <span className={'dot ' + e.status} /> {e.name}
            </button>
          ))}
        </div>
        <div className="side-foot">Prototype · synthetic images only</div>
      </aside>
      <main className="main">
        {view.page === 'home' && <Home exps={exps} manualMin={manualMin} setManualMin={setManualMin} open={(id) => setView({ page: 'exp', id, tab: 'overview' })} newExp={() => setView({ page: 'new' })} />}
        {view.page === 'new' && <NewExperiment onCreate={createExp} />}
        {exp && (
          <ExperimentView exp={exp} tab={view.tab} setTab={(tab) => setView({ ...view, tab, focus: undefined })}
            focus={view.focus} setFocus={(focus) => setView({ ...view, tab: 'images', focus })}
            run={() => run(exp.id)} update={(fn) => update(exp.id, fn)} manualMin={manualMin} />
        )}
      </main>
    </div>
  )
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="12" fill="#0f2a4a" />
      <path d="M6 9 L13 5 L20 9 L20 17 L13 21 L6 17Z" fill="none" stroke="#ffd23f" strokeWidth="1.6" />
      <path d="M13 5 L13 13 L20 17 M13 13 L6 17" fill="none" stroke="#3ddc97" strokeWidth="1.4" />
    </svg>
  )
}

/* ---------------- Home ---------------- */
function Home({ exps, manualMin, setManualMin, open, newExp }) {
  const total = exps.reduce((s, e) => s + e.images.length, 0)
  const manualH = (total * manualMin) / 60
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Your experiments</h1>
          <p className="muted">Any stain, any marker. Upload the whole experiment and get every image quantified the same way.</p>
        </div>
        <button className="primary" onClick={newExp}>+ New experiment</button>
      </header>
      <section className="stats">
        <Stat big={total} label="images across all experiments" />
        <Stat big={`${manualH.toFixed(0)} h`} label={<>by hand at <input className="inline" type="number" min="1" value={manualMin} onChange={(e) => setManualMin(Math.max(1, +e.target.value || 1))} /> min / image <span className="tag">your estimate</span></>} />
        <Stat big={`~${Math.max(1, Math.round((total * 0.4) / 60 + (total * 0.06 * 2)))} min`} label="with FiberSight, incl. reviewing flagged images" accent />
      </section>
      <div className="cards">
        {exps.map((e) => (
          <div key={e.id} className="card exp-card" onClick={() => open(e.id)}>
            <div className="exp-top">
              <h3>{e.name}</h3>
              <StatusPill e={e} />
            </div>
            <p className="muted small">{e.note}</p>
            <Chips channels={e.channels} />
            <div className="exp-meta">
              <span><b>{e.images.length}</b> images</span>
              <span>{e.groups.map((g) => g.name).join(' vs. ')}</span>
              <span>{e.channels.every((c) => c.mode === 'bright') ? 'Brightfield' : 'Fluorescence'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
function Stat({ big, label, accent }) {
  return <div className={'stat card' + (accent ? ' accent' : '')}><div className="big">{big}</div><div className="muted small">{label}</div></div>
}
function StatusPill({ e }) {
  if (e.status === 'done') return <span className="pill ok">Analyzed</span>
  if (e.status === 'running') return <span className="pill run">Analyzing {e.progress}/{e.images.length}</span>
  return <span className="pill">Ready to run</span>
}
function Chips({ channels }) {
  return (
    <div className="chips">
      {channels.map((c) => (
        <span key={c.id} className="chip" title={`${c.target} · ${KIND_LABEL[c.kind]}`}>
          <i style={{ background: c.color }} /> {c.name}
        </span>
      ))}
    </div>
  )
}

/* ---------------- New experiment ---------------- */
function NewExperiment({ onCreate }) {
  const [name, setName] = useState('')
  const [groups, setGroups] = useState(['Control', 'Treatment'])
  const [mode, setMode] = useState('fluor')
  const [sel, setSel] = useState(['dapi', 'laminin'])
  const [custom, setCustom] = useState([])
  const [cForm, setCForm] = useState({ name: '', kind: 'marker', color: '#00c2a8' })
  const [files, setFiles] = useState(null)
  const [drag, setDrag] = useState(false)
  const lib = [...STAIN_LIBRARY, ...custom].filter((s) => s.mode === mode)
  const channels = resolveChannels(sel, custom)
  const defs = metricDefs(channels)
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const switchMode = (m) => { setMode(m); setSel(m === 'fluor' ? ['dapi', 'laminin'] : ['hema']) }
  const addCustom = () => {
    if (!cForm.name.trim()) return
    const id = 'c-' + cForm.name.toLowerCase().replace(/\W+/g, '') + '-' + custom.length
    const s = { id, name: cForm.name.trim(), target: 'Custom marker', kind: cForm.kind, color: cForm.color, mode, custom: true,
      ...(cForm.kind === 'marker' ? { marker: ['ki67', 'myod', 'pax7'][custom.length % 3] } : {}),
      ...(cForm.kind === 'fibertype' ? { ftype: 'regen' } : {}) }
    setCustom((c) => [...c, s]); setSel((x) => [...x, id]); setCForm({ ...cForm, name: '' })
  }
  const n = files ? files.length : 120
  const ready = name.trim() && sel.length > 0 && defs.length > 0
  function create() {
    onCreate({
      name: name.trim(), note: files ? `${files.length} uploaded files (prototype uses synthetic stand-ins)` : 'Sample batch of 120 synthetic images',
      channels: sel, custom, nImages: Math.max(4, n),
      groups: [{ name: groups[0] || 'Group A', fx: {} }, { name: groups[1] || 'Group B', fx: { size: 0.88, pax7: 0.04, myod: 0.05, typeProbs: [0.16, 0.32, 0.26, 0.26], intensity: 0.52, areaFrac: 1.3, central: 0.07 } }],
    })
  }
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>New experiment</h1><p className="muted">Tell FiberSight what you stained. It works out what to measure.</p></div></header>

      <section className="card step">
        <h2><span className="num">1</span> Experiment</h2>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aged soleus: fibrosis + fiber type" /></label>
        <div className="row2">
          <label>Group 1<input value={groups[0]} onChange={(e) => setGroups([e.target.value, groups[1]])} /></label>
          <label>Group 2<input value={groups[1]} onChange={(e) => setGroups([groups[0], e.target.value])} /></label>
        </div>
      </section>

      <section className="card step">
        <h2><span className="num">2</span> Staining panel</h2>
        <div className="seg">
          <button className={mode === 'fluor' ? 'on' : ''} onClick={() => switchMode('fluor')}>Immunofluorescence</button>
          <button className={mode === 'bright' ? 'on' : ''} onClick={() => switchMode('bright')}>Brightfield / IHC</button>
        </div>
        <div className="lib">
          {lib.map((s) => (
            <button key={s.id} className={'libitem' + (sel.includes(s.id) ? ' on' : '')} onClick={() => toggle(s.id)}>
              <i style={{ background: s.color }} />
              <div><b>{s.name}</b><span>{s.target}</span><em>{KIND_LABEL[s.kind]}</em></div>
            </button>
          ))}
        </div>
        <div className="custom">
          <b className="small">Add your own stain or antibody</b>
          <div className="row3">
            <input placeholder="Name, e.g. CD31" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} />
            <select value={cForm.kind} onChange={(e) => setCForm({ ...cForm, kind: e.target.value })}>
              {['marker', 'fibertype', 'area', 'intensity', 'membrane', 'nuclear'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input type="color" value={cForm.color} onChange={(e) => setCForm({ ...cForm, color: e.target.value })} />
            <button onClick={addCustom}>Add</button>
          </div>
        </div>
        <div className="measures">
          <b className="small">FiberSight will measure</b>
          {defs.length === 0 ? <p className="muted small">Add a membrane, marker, area or intensity stain to get measurements.</p> :
            <ul>{defs.map((d) => <li key={d.key}>{d.label} <span className="muted">({d.unit})</span></li>)}</ul>}
        </div>
      </section>

      <section className="card step">
        <h2><span className="num">3</span> Images</h2>
        <div className={'drop' + (drag ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); setFiles([...e.dataTransfer.files]) }}>
          {files ? <><b>{files.length} files ready</b><span className="muted small">This prototype analyzes synthetic stand-ins with the same panel, so no real data leaves your computer.</span></>
            : <><b>Drop the whole experiment folder here</b><span className="muted small">.tif, .czi, .nd2, .png · or use the sample batch of 120 images</span></>}
          <label className="filebtn">Browse<input type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></label>
        </div>
      </section>
      <div className="actions">
        <button className="primary" disabled={!ready} onClick={create}>Analyze {n} images</button>
      </div>
    </div>
  )
}

/* ---------------- Experiment ---------------- */
function ExperimentView({ exp, tab, setTab, focus, setFocus, run, update, manualMin }) {
  const defs = useMemo(() => metricDefs(exp.channels), [exp.channels])
  // recompute per-image results when fibers are excluded
  const results = useMemo(() => {
    const out = {}
    for (const [k, v] of Object.entries(exp.results)) {
      const ex = exp.excluded[k]
      out[k] = ex && ex.size ? analyze(getImg(exp, exp.images[k]), defs, ex) : v
    }
    return out
  }, [exp, defs])
  const flagged = exp.images.filter((m) => getImgSafe(exp, m)?.artifact)
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{exp.name}</h1>
          <p className="muted">{exp.note}</p>
          <Chips channels={exp.channels} />
        </div>
        {exp.status === 'queued' && <button className="primary" onClick={run}>Run analysis on {exp.images.length} images</button>}
        {exp.status === 'done' && <button onClick={run}>Re-run</button>}
      </header>
      {exp.status !== 'done' ? (
        <Running exp={exp} manualMin={manualMin} />
      ) : (
        <>
          <div className="tabs">
            {['overview', 'images', 'results'].map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'overview' ? 'Overview' : t === 'images' ? `Images (${exp.images.length})` : 'Results & stats'}
              </button>
            ))}
          </div>
          {tab === 'overview' && <Overview exp={exp} defs={defs} results={results} flagged={flagged} manualMin={manualMin} open={setFocus} setTab={setTab} />}
          {tab === 'images' && <Images exp={exp} results={results} focus={focus} setFocus={setFocus} update={update} defs={defs} />}
          {tab === 'results' && <Results exp={exp} defs={defs} results={results} />}
        </>
      )}
    </div>
  )
}
function getImgSafe(exp, m) { return exp.status === 'done' || exp.results[m.idx] ? getImg(exp, m) : null }

function Running({ exp, manualMin }) {
  const ref = useRef()
  const cur = exp.images[Math.max(0, exp.progress - 1)]
  useEffect(() => {
    if (!ref.current || exp.status !== 'running') return
    renderImage(ref.current, getImg(exp, cur), exp.channels, new Set(exp.channels.map((c) => c.id)), { overlay: true, noBlur: true })
  }, [exp.progress])
  if (exp.status === 'queued')
    return (
      <div className="card empty">
        <p><b>{exp.images.length} images</b> are queued. Manually, this experiment is about <b>{((exp.images.length * manualMin) / 60).toFixed(0)} hours</b> of tracing and counting.</p>
        <p className="muted small">FiberSight segments every fiber, applies the same thresholds to every image, and flags the ones that need a human look.</p>
      </div>
    )
  const pct = (100 * exp.progress) / exp.images.length
  return (
    <div className="card running">
      <canvas ref={ref} width={320} height={240} />
      <div className="run-info">
        <h3>Analyzing {exp.progress} of {exp.images.length}</h3>
        <div className="bar"><div style={{ width: pct + '%' }} /></div>
        <p className="muted small mono">{cur?.name}</p>
        <ul className="small">
          <li>Segmenting fibers from {exp.channels.find((c) => c.kind === 'membrane')?.name || 'tissue morphology'}</li>
          <li>Applying identical thresholds to every image</li>
          <li>Checking focus and tissue folds</li>
        </ul>
      </div>
    </div>
  )
}

function Overview({ exp, defs, results, flagged, manualMin, open, setTab }) {
  const manualH = (exp.images.length * manualMin) / 60
  const reviewMin = flagged.length * 2
  const fsMin = (exp.elapsed || 1) / 60 + reviewMin
  const fibers = Object.values(results).reduce((s, r) => s + r.usable, 0)
  const key = defs.filter((d) => d.key !== 'count')
  return (
    <div className="ov">
      <section className="stats">
        <Stat big={`${manualH.toFixed(0)} h`} label={`manual estimate (${manualMin} min × ${exp.images.length} images)`} />
        <Stat big={`${fsMin < 1 ? '<1' : Math.round(fsMin)} min`} label={`FiberSight: ${(exp.elapsed || 0).toFixed(1)} s analysis + ${reviewMin} min reviewing flags`} accent />
        <Stat big={fibers.toLocaleString()} label="fibers measured, every one counted" />
      </section>
      <div className="ov-grid">
        <section className="card">
          <h3>Key results</h3>
          <table className="tbl">
            <thead><tr><th>Measure</th>{exp.groups.map((g, i) => <th key={i}><i className="sw" style={{ background: GROUP_COLORS[i] }} />{g.name}</th>)}<th /></tr></thead>
            <tbody>
              {key.map((d) => {
                const per = exp.groups.map((_, gi) => exp.images.filter((m) => m.group === gi).map((m) => results[m.idx][d.key]))
                const s = per.map(summarize)
                const w = welch(per[0], per[1])
                return (
                  <tr key={d.key}>
                    <td>{d.label} <span className="muted small">{d.unit}</span></td>
                    {s.map((x, i) => <td key={i}>{x.mean.toFixed(d.fmt)} <span className="muted small">± {x.sd.toFixed(d.fmt)}</span></td>)}
                    <td className={w.p < 0.05 ? 'sig' : 'muted'}>{fmtP(w.p)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button className="link" onClick={() => setTab('results')}>See charts and export →</button>
        </section>
        <section className="card">
          <h3>Needs your eyes <span className="pill warn">{flagged.length}</span></h3>
          <p className="muted small">Everything else passed quality checks automatically.</p>
          <ul className="flags">
            {flagged.map((m) => {
              const im = getImg(exp, m)
              return (
                <li key={m.idx} onClick={() => open(m.idx)}>
                  <span className="mono small">{m.name}</span>
                  <span className={'small ' + (exp.reviewed[m.idx] ? 'okt' : 'warnt')}>{exp.reviewed[m.idx] ? 'Reviewed' : im.artifact.label}</span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}

/* ---------------- Images ---------------- */
function Images({ exp, results, focus, setFocus, update, defs }) {
  const [filter, setFilter] = useState('all')
  const list = exp.images.filter((m) =>
    filter === 'all' ? true : filter === 'flag' ? getImg(exp, m).artifact : m.group === +filter)
  if (focus !== undefined) return <Viewer exp={exp} idx={focus} results={results} setFocus={setFocus} update={update} defs={defs} list={list} />
  return (
    <div>
      <div className="seg small-seg">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'flag' ? 'on' : ''} onClick={() => setFilter('flag')}>Flagged</button>
        {exp.groups.map((g, i) => <button key={i} className={filter === String(i) ? 'on' : ''} onClick={() => setFilter(String(i))}>{g.name}</button>)}
      </div>
      <div className="grid">
        {list.map((m) => <Thumb key={m.idx} exp={exp} meta={m} onClick={() => setFocus(m.idx)} res={results[m.idx]} />)}
      </div>
    </div>
  )
}
function Thumb({ exp, meta, onClick, res }) {
  const ref = useRef()
  useEffect(() => {
    const el = ref.current
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) {
        requestAnimationFrame(() => renderImage(el, getImg(exp, meta), exp.channels, new Set(exp.channels.map((c) => c.id)), {}))
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [exp.id, meta.idx])
  const im = getImg(exp, meta)
  return (
    <div className="thumb" onClick={onClick}>
      <canvas ref={ref} width={168} height={126} />
      <div className="tcap">
        <span className="mono">{meta.name}</span>
        <span><i className="sw" style={{ background: GROUP_COLORS[meta.group] }} />{res?.usable} fibers</span>
      </div>
      {im.artifact && <span className={'flag ' + (exp.reviewed[meta.idx] ? 'done' : '')}>{exp.reviewed[meta.idx] ? '✓' : '!'}</span>}
    </div>
  )
}

function Viewer({ exp, idx, results, setFocus, update, defs, list }) {
  const ref = useRef()
  const [vis, setVis] = useState(() => new Set(exp.channels.map((c) => c.id)))
  const [overlay, setOverlay] = useState(true)
  const meta = exp.images[idx]
  const img = getImg(exp, meta)
  const excluded = exp.excluded[idx] || new Set()
  const res = results[idx]
  useEffect(() => {
    renderImage(ref.current, img, exp.channels, vis, { overlay, excluded })
  }, [idx, vis, overlay, exp.excluded[idx]])
  const pos = list.findIndex((m) => m.idx === idx)
  const go = (d) => { const m = list[(pos + d + list.length) % list.length]; if (m) setFocus(m.idx) }
  function click(e) {
    const rect = ref.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width, y = ((e.clientY - rect.top) / rect.height) * 0.75
    let best = -1, bd = 1e9
    img.seeds.forEach(([sx, sy], i) => { const d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = i } })
    const f = img.fibers[best]
    if (!f || f.edge || f.inFold) return
    update((x2) => {
      const s = new Set(x2.excluded[idx] || [])
      s.has(best) ? s.delete(best) : s.add(best)
      return { ...x2, excluded: { ...x2.excluded, [idx]: s } }
    })
  }
  return (
    <div className="viewer">
      <div className="vbar">
        <button onClick={() => setFocus(undefined)}>← All images</button>
        <span className="mono">{meta.name}</span>
        <span className="muted small">{pos + 1} / {list.length}</span>
        <button onClick={() => go(-1)}>‹</button><button onClick={() => go(1)}>›</button>
      </div>
      <div className="vbody">
        <div className="vcanvas">
          <canvas ref={ref} width={720} height={540} onClick={click} />
          {img.artifact && <div className="banner">{img.artifact.label}{img.artifact.kind === 'fold' ? ' · fibers under the fold were excluded automatically' : ''}</div>}
          <p className="muted small">Click a fiber to exclude or include it. Every result updates instantly.</p>
        </div>
        <div className="vside">
          <h4>Channels</h4>
          {exp.channels.map((c) => (
            <label key={c.id} className="tog">
              <input type="checkbox" checked={vis.has(c.id)} onChange={() => { const s = new Set(vis); s.has(c.id) ? s.delete(c.id) : s.add(c.id); setVis(s) }} />
              <i style={{ background: c.color }} />{c.name}
            </label>
          ))}
          <label className="tog"><input type="checkbox" checked={overlay} onChange={() => setOverlay(!overlay)} /><i className="ov-sw" />Segmentation overlay</label>
          {exp.channels.filter((c) => c.kind === 'fibertype' && c.ftype !== 'regen').length >= 2 && (
            <div className="legend small">{Object.entries(TYPE_COLOR).map(([t, c]) => <span key={t}><i style={{ background: c }} />{t}</span>)}</div>
          )}
          <h4>This image</h4>
          <table className="tbl mini">
            <tbody>
              {defs.map((d) => <tr key={d.key}><td>{d.label}</td><td>{res[d.key].toFixed(d.fmt)}</td></tr>)}
              <tr><td>Auto-excluded (edge / artifact)</td><td>{res.autoExcluded}</td></tr>
              <tr><td>Excluded by you</td><td>{excluded.size}</td></tr>
            </tbody>
          </table>
          <button className={'primary wide' + (exp.reviewed[idx] ? ' done' : '')}
            onClick={() => update((x) => ({ ...x, reviewed: { ...x.reviewed, [idx]: true } }))}>
            {exp.reviewed[idx] ? '✓ Reviewed' : 'Mark reviewed'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Results ---------------- */
function Results({ exp, defs, results }) {
  const per = (key) => exp.groups.map((_, gi) => exp.images.filter((m) => m.group === gi).map((m) => results[m.idx][key]))
  function exportCsv() {
    const head = ['image', 'group', ...defs.map((d) => `${d.label} (${d.unit})`)]
    const rows = exp.images.map((m) => [m.name, exp.groups[m.group].name, ...defs.map((d) => results[m.idx][d.key].toFixed(d.fmt))])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = exp.name.replace(/\W+/g, '_') + '_FiberSight.csv'
    a.click()
  }
  const hasCsa = defs.some((d) => d.key === 'csa')
  return (
    <div>
      <div className="res-head">
        <p className="muted small">Each dot is one image. Bars show mean ± SD. Welch's t-test on image-level means; check with your PI whether animal-level stats fit your design better.</p>
        <button className="primary" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="charts">
        {hasCsa && <section className="card chart wide2"><h4>Fiber size distribution</h4><Histogram exp={exp} results={results} /></section>}
        {defs.filter((d) => d.key !== 'count').map((d) => {
          const v = per(d.key)
          return (
            <section key={d.key} className="card chart">
              <h4>{d.label} <span className="muted small">{d.unit}</span></h4>
              <DotBar groups={exp.groups} vals={v} fmt={d.fmt} />
              <p className={'small ' + (welch(v[0], v[1]).p < 0.05 ? 'sig' : 'muted')}>{fmtP(welch(v[0], v[1]).p)}</p>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DotBar({ groups, vals, fmt }) {
  const W = 260, H = 190, P = 34
  const all = vals.flat()
  const max = Math.max(...all) * 1.12 || 1
  const y = (v) => H - 22 - (v / max) * (H - 40)
  const bw = (W - P - 20) / groups.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg">
      {[0, 0.5, 1].map((t) => (
        <g key={t}><line x1={P} x2={W - 8} y1={y(max * t / 1.12)} y2={y(max * t / 1.12)} className="grid-l" />
          <text x={P - 4} y={y(max * t / 1.12) + 3} className="ax" textAnchor="end">{(max * t / 1.12).toFixed(fmt > 1 ? 1 : 0)}</text></g>
      ))}
      {vals.map((v, gi) => {
        const s = summarize(v)
        const cx = P + 10 + bw * gi + bw / 2
        return (
          <g key={gi}>
            <rect x={cx - bw * 0.3} y={y(s.mean)} width={bw * 0.6} height={H - 22 - y(s.mean)} fill={GROUP_COLORS[gi]} opacity="0.18" rx="3" />
            {v.map((val, i) => <circle key={i} cx={cx + (((i * 37) % 21) - 10) * bw * 0.018} cy={y(val)} r="2" fill={GROUP_COLORS[gi]} opacity="0.55" />)}
            <line x1={cx} x2={cx} y1={y(s.mean + s.sd)} y2={y(Math.max(0, s.mean - s.sd))} stroke="#111" strokeWidth="1.4" />
            <line x1={cx - bw * 0.3} x2={cx + bw * 0.3} y1={y(s.mean)} y2={y(s.mean)} stroke="#111" strokeWidth="2.2" />
            <text x={cx} y={H - 6} textAnchor="middle" className="ax">{groups[gi].name}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Histogram({ exp, results }) {
  const W = 560, H = 200, P = 36
  const bins = 24, maxA = 6000
  const hist = exp.groups.map((_, gi) => {
    const h = new Array(bins).fill(0)
    let n = 0
    exp.images.filter((m) => m.group === gi).forEach((m) => results[m.idx].csaList.forEach((a) => { h[Math.min(bins - 1, Math.floor((a / maxA) * bins))]++; n++ }))
    return h.map((c) => c / (n || 1))
  })
  const ymax = Math.max(...hist.flat()) * 1.1
  const x = (i) => P + (i / bins) * (W - P - 10)
  const y = (v) => H - 24 - (v / ymax) * (H - 40)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg">
      {hist.map((h, gi) => (
        <path key={gi} d={'M' + h.map((v, i) => `${x(i + 0.5)},${y(v)}`).join(' L')} fill="none" stroke={GROUP_COLORS[gi]} strokeWidth="2.4" />
      ))}
      {hist.map((h, gi) => h.map((v, i) => <rect key={gi + '-' + i} x={x(i) + 1} width={(W - P - 10) / bins - 2} y={y(v)} height={H - 24 - y(v)} fill={GROUP_COLORS[gi]} opacity="0.12" />))}
      {[0, 1500, 3000, 4500].map((t) => <text key={t} x={x((t / maxA) * bins)} y={H - 8} className="ax" textAnchor="middle">{t}</text>)}
      <text x={W - 10} y={H - 8} className="ax" textAnchor="end">6000 µm²</text>
      {exp.groups.map((g, gi) => <g key={gi}><rect x={W - 150} y={12 + gi * 16} width="10" height="10" fill={GROUP_COLORS[gi]} /><text x={W - 135} y={21 + gi * 16} className="ax">{g.name}</text></g>)}
    </svg>
  )
}
