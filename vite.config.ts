import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/** stamp the service worker with this build's id, so every deploy installs a fresh shell and prunes old caches */
const swVersion = (): Plugin => ({
  name: 'momentum-sw-version', apply: 'build',
  writeBundle(opts) {
    const f = path.join(opts.dir || 'dist', 'sw.js')
    if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('__BUILD__', Date.now().toString(36)))
  },
})
export default defineConfig({ plugins: [react(), swVersion()], server: { port: 5181 } })
