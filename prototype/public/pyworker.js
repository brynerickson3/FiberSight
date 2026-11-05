// FiberSight engine in the browser: Pyodide (Python compiled to WebAssembly) in a Web Worker.
// Images are written to Pyodide's in-memory file system and never leave the user's computer.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';
importScripts(PYODIDE + 'pyodide.js');

const ENGINE_FILES = ['__init__', 'stains', 'config', 'io', 'segment', 'pipeline', 'report', 'synth', 'web'];
let py = null;
let web = null;

const status = (text) => postMessage({ type: 'status', text });

async function init() {
  status('Loading Python…');
  py = await loadPyodide({ indexURL: PYODIDE });
  status('Loading NumPy, SciPy, scikit-image and pandas…');
  await py.loadPackage(['numpy', 'scipy', 'scikit-image', 'pandas', 'pyyaml', 'pillow', 'micropip']);
  status('Installing the TIFF reader…');
  await py.pyimport('micropip').install('tifffile');
  status('Loading the FiberSight engine…');
  py.FS.mkdirTree('/engine/fibersight');
  for (const f of ENGINE_FILES) {
    const r = await fetch(`engine/fibersight/${f}.py`);
    if (!r.ok) throw new Error(`Could not load engine file ${f}.py`);
    py.FS.writeFile(`/engine/fibersight/${f}.py`, await r.text());
  }
  py.runPython("import sys; sys.path.insert(0, '/engine')");
  web = py.pyimport('fibersight.web');
  postMessage({ type: 'ready', library: JSON.parse(web.library_json()) });
}

function cleanError(err) {
  const msg = String((err && err.message) || err);
  const lines = msg.trim().split('\n').filter(Boolean);
  return lines[lines.length - 1] || msg;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      if (!web) await init();
      else postMessage({ type: 'ready', library: JSON.parse(web.library_json()) });
      return;
    }
    if (m.type !== 'run' && m.type !== 'sample') return;
    let cfg;
    let inDir;
    if (m.type === 'sample') {
      status('Generating sample images…');
      cfg = web.make_sample(m.mode, '/sample', 2);
      inDir = '/sample/images';
    } else {
      py.runPython("import shutil; shutil.rmtree('/in', ignore_errors=True)");
      py.FS.mkdirTree('/in');
      for (const f of m.files) py.FS.writeFile(`/in/${f.name}`, new Uint8Array(f.buffer));
      cfg = JSON.stringify(m.config);
      inDir = '/in';
    }
    status('Analyzing…');
    const progress = (i, n, name) => postMessage({ type: 'progress', i, n, name });
    const resPy = web.run(cfg, inDir, '/out', progress);
    const result = resPy.toJs({ dict_converter: Object.fromEntries });
    resPy.destroy();
    postMessage({ type: 'result', result, sample: m.type === 'sample' });
  } catch (err) {
    postMessage({ type: 'error', message: cleanError(err) });
  }
};
