// Copies the Python engine into public/ so the browser worker can load it.
// Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'engine', 'fibersight')
const dst = join(here, '..', 'public', 'engine', 'fibersight')
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
const files = readdirSync(src).filter((f) => f.endsWith('.py'))
for (const f of files) cpSync(join(src, f), join(dst, f))
console.log(`copied ${files.length} engine files to public/engine/fibersight`)
