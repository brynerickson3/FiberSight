import { ASPECT, nearest2 } from './data.js'

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const TYPE_COLOR = { I: '#3ddc97', IIa: '#ff5c5c', IIx: '#9aa0a6', IIb: '#ffd23f' }

// Draw a synthetic stained section onto a canvas.
// channels: resolved stain objects; visible: Set of channel ids shown
// opts: { overlay, excluded:Set, highlight }
export function renderImage(canvas, img, channels, visible, opts = {}) {
  const W = canvas.width, H = canvas.height
  const ctx = canvas.getContext('2d')
  const bright = channels.length > 0 && channels.every((c) => c.mode === 'bright')
  const vis = channels.filter((c) => visible.has(c.id))
  const scale = W // unit -> px
  const data = ctx.createImageData(W, H)
  const px = data.data
  const memb = vis.filter((c) => c.kind === 'membrane').map((c) => hex(c.color))
  const ftypes = vis.filter((c) => c.kind === 'fibertype').map((c) => ({ t: c.ftype, col: hex(c.color) }))
  const areas = vis.filter((c) => c.kind === 'area').map((c) => hex(c.color))
  const ints = vis.filter((c) => c.kind === 'intensity').map((c) => hex(c.color))
  const { seeds, fibers, artifact } = img
  const excluded = opts.excluded || new Set()
  for (let py = 0; py < H; py++) {
    for (let pxx = 0; pxx < W; pxx++) {
      const x = (pxx + 0.5) / W, y = ((py + 0.5) / H) * ASPECT
      const [i, , , gap] = nearest2(seeds, x, y)
      const b = smooth(0.0065, 0.0015, gap) // membrane-ness
      const inter = smooth(0.0075, 0.003, gap)
      const f = fibers[i]
      const noise = hashNoise(pxx, py) * 0.08
      let r, g, bl
      if (!bright) {
        r = 6 + noise * 60; g = 7 + noise * 60; bl = 10 + noise * 60
        for (const c of memb) { r += c[0] * b; g += c[1] * b; bl += c[2] * b }
        for (const t of ftypes) {
          const on = t.t === 'regen' ? f.regen : f.type === t.t
          if (on) { const k = 0.78 * f.intensity * (1 - inter) * (0.85 + noise); r += t.col[0] * k; g += t.col[1] * k; bl += t.col[2] * k }
        }
        for (const c of areas) { const k = 0.75 * inter; r += c[0] * k; g += c[1] * k; bl += c[2] * k }
      } else {
        let tr = 1, tg = 1, tb = 1
        for (const c of ints) {
          const k = 0.9 * f.intensity * (1 - inter) * (0.9 + noise)
          tr *= 1 - k * (1 - c[0] / 255); tg *= 1 - k * (1 - c[1] / 255); tb *= 1 - k * (1 - c[2] / 255)
        }
        for (const c of areas) {
          const k = 0.8 * inter
          tr *= 1 - k * (1 - c[0] / 255); tg *= 1 - k * (1 - c[1] / 255); tb *= 1 - k * (1 - c[2] / 255)
        }
        if (!ints.length && !areas.length) { const k = 0.18 * (1 - inter); tr *= 1 - k * 0.2; tg *= 1 - k * 0.5; tb *= 1 - k * 0.35 }
        r = 246 * tr - noise * 40; g = 241 * tg - noise * 40; bl = 240 * tb - noise * 40
      }
      if (opts.overlay) {
        const edgeLine = gap < 0.0028
        if (edgeLine) {
          const col = f.edge || f.inFold ? [120, 120, 120] : excluded.has(i) ? [255, 70, 70] : [255, 230, 0]
          r = col[0]; g = col[1]; bl = col[2]
        } else if (excluded.has(i)) {
          r = r * 0.5 + 90; g *= 0.5; bl *= 0.5
        }
      }
      const o = (py * W + pxx) * 4
      px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255
    }
  }
  ctx.putImageData(data, 0, 0)

  // nuclei + markers
  const nuc = vis.find((c) => c.kind === 'nuclear')
  const markers = vis.filter((c) => c.kind === 'marker')
  const rad = Math.max(1, scale * 0.0068)
  ctx.save()
  ctx.globalCompositeOperation = bright ? 'multiply' : 'lighter'
  for (const n of img.nuclei) {
    const X = n.x * scale, Y = (n.y / ASPECT) * H
    const isMarker = markers.some((m) => n[m.marker])
    if (nuc && (!isMarker || n.pax7 || n.myod || n.ki67)) {
      ctx.fillStyle = nuc.color
      ctx.globalAlpha = bright ? 0.85 : 0.9
      ellipse(ctx, X, Y, rad * 1.25, rad * 0.8, (n.x * 37) % Math.PI)
    }
    for (const m of markers) {
      if (!n[m.marker]) continue
      ctx.fillStyle = m.color
      ctx.globalAlpha = 0.95
      ellipse(ctx, X, Y, rad * 1.3, rad * 0.95, (n.y * 53) % Math.PI)
    }
  }
  ctx.restore()

  if (opts.overlay) {
    ctx.save()
    for (const m of markers) {
      ctx.strokeStyle = m.color
      ctx.lineWidth = Math.max(1, W / 320)
      for (const n of img.nuclei) {
        if (!n[m.marker] || excluded.has(n.f)) continue
        ctx.beginPath(); ctx.arc(n.x * scale, (n.y / ASPECT) * H, rad * 3, 0, Math.PI * 2); ctx.stroke()
      }
    }
    const typed = ftypesAll(channels)
    if (typed && W >= 300) {
      for (const f of fibers) {
        if (f.edge || f.inFold || excluded.has(f.i)) continue
        ctx.fillStyle = TYPE_COLOR[f.type]
        ctx.globalAlpha = 0.95
        ctx.beginPath(); ctx.arc(f.cx * scale, (f.cy / ASPECT) * H, Math.max(2, W / 200), 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.restore()
  }

  if (artifact?.kind === 'fold') {
    ctx.save()
    ctx.globalAlpha = bright ? 0.55 : 0.6
    ctx.fillStyle = bright ? '#b78f8f' : '#2c3550'
    ctx.beginPath()
    const y0 = (artifact.y0 / ASPECT) * H, y1 = (artifact.y1 / ASPECT) * H, s = (artifact.slope / ASPECT) * H
    ctx.moveTo(0, y0); ctx.lineTo(W, y0 + s); ctx.lineTo(W, y1 + s); ctx.lineTo(0, y1); ctx.closePath(); ctx.fill()
    if (opts.overlay) {
      ctx.globalAlpha = 1; ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.stroke()
    }
    ctx.restore()
  }
  if (artifact?.kind === 'blur' && !opts.noBlur) {
    const tmp = document.createElement('canvas')
    tmp.width = W; tmp.height = H
    tmp.getContext('2d').drawImage(canvas, 0, 0)
    ctx.save(); ctx.filter = `blur(${Math.max(1.5, W / 220)}px)`; ctx.drawImage(tmp, 0, 0); ctx.restore()
  }
}

function ftypesAll(channels) {
  return channels.filter((c) => c.kind === 'fibertype' && c.ftype !== 'regen').length >= 2
}
function ellipse(ctx, x, y, rx, ry, rot) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill()
}
function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
function hashNoise(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177)
  h ^= h >>> 13
  return ((h >>> 0) % 1000) / 1000
}

export { TYPE_COLOR }
