// Renders scene.html frame by frame and muxes it with music.py's track.
//   node scripts/app-teaser/render.mjs            full 1080p render into apps/web/public/media/app
//   node scripts/app-teaser/render.mjs --sheet    contact sheet only (OUT=<dir>)
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'apps/mobile/e2e/'))('playwright-core')
const FPS = 60
const DURATION = 30
const MEDIA = path.join(ROOT, 'apps/web/public/media/app')

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => { throw e })
await page.goto(`file://${path.join(HERE, 'scene.html')}`)
await page.evaluate(() => document.fonts.ready)
await Promise.all(['Alexandria', 'Vazirmatn', 'Montserrat'].map((f) => page.evaluate((f) => document.fonts.load(`700 40px ${f}`, 'سلام'), f)))

const frameAt = async (t, opts) => { await page.evaluate((x) => window.seek(x), t); return page.screenshot(opts) }

if (process.argv.includes('--sheet')) {
  const out = process.env.OUT ?? os.tmpdir()
  for (const t of (process.env.TIMES ?? '1.8,3.4,5.6,6.4,8.6,11.5,13.3,15,18,21,22.6,26').split(',')) await frameAt(Number(t), { path: path.join(out, `t${t}.png`) })
} else {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'app-teaser-'))
  const wav = path.join(tmp, 'music.wav')
  const music = spawnSync('python3', [path.join(HERE, 'music.py'), wav], { stdio: 'inherit' })
  if (music.status !== 0) throw new Error('music.py failed')
  const out = path.join(MEDIA, 'coming-soon.mp4')
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', wav,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-ar', '48000', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-x264-params', 'aq-mode=3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))))
  const total = DURATION * FPS
  for (let i = 0; i < total; i++) {
    const jpg = await frameAt(i / FPS, { type: 'jpeg', quality: 96 })
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 90 === 0) console.log(`frame ${i}/${total}`)
  }
  ff.stdin.end()
  await done
  await frameAt(26, { path: path.join(MEDIA, 'coming-soon-poster.jpg'), type: 'jpeg', quality: 88 })
  rmSync(tmp, { recursive: true })
  console.log('wrote', out)
}
await browser.close()
