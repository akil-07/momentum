// npm test: compile the logic modules, then run every scenario suite in tests/suites (each prints PASS/FAIL lines)
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const here = path.dirname(new URL(import.meta.url).pathname)
// TEST_BUILD lets parallel runs use separate build dirs (e.g. TEST_BUILD=tests/.build-sync npm test sync)
const out = process.env.TEST_BUILD ? path.resolve(process.env.TEST_BUILD) : path.join(here, '.build')
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
execFileSync('sh', [path.join(here, 'build.sh'), out], { stdio: 'inherit' })
// the Codeforces problemset fixture (public data): fetched once, cached in tests/fixtures (git-ignored)
const fx = path.join(here, 'fixtures', 'problems.json')
if (!fs.existsSync(fx)) {
  console.log('fetching the Codeforces problemset fixture…')
  const r = await fetch('https://codeforces.com/api/problemset.problems'); fs.writeFileSync(fx, await r.text())
}
fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true }); fs.copyFileSync(fx, path.join(out, 'fixtures', 'problems.json'))
const only = process.argv.slice(2)
let pass = 0, fail = 0; const bad = []
for (const f of fs.readdirSync(path.join(here, 'suites')).filter(f => f.endsWith('.mjs')).sort()) {
  if (only.length && !only.some(o => f.includes(o))) continue
  fs.copyFileSync(path.join(here, 'suites', f), path.join(out, f))
  // clock.mjs pins the start to 10:00 today, so suites that fast-forward hours stay on one day
  const r = spawnSync('node', ['--import', path.join(here, 'clock.mjs'), f], { cwd: out, encoding: 'utf8', env: { ...process.env, MOMENTUM_TEST: '1' } })
  const o = (r.stdout || '') + (r.stderr || '')
  const p = (o.match(/^PASS /gm) || []).length, q = (o.match(/^FAIL /gm) || []).length + (r.status && !q0(o) ? 1 : 0)
  pass += p; fail += q
  console.log(`${q ? '✗' : '✓'} ${f.padEnd(22)} ${p} passed${q ? `, ${q} failed` : ''}`)
  if (q) { bad.push(f); console.log(o.split('\n').filter(l => /^FAIL|Error|at file/.test(l)).slice(0, 12).map(l => '    ' + l).join('\n')) }
}
function q0(o) { return /^FAIL /m.test(o) }
console.log(`\n${pass} passed, ${fail} failed${bad.length ? ' — ' + bad.join(', ') : ''}`)
process.exit(fail ? 1 : 0)
