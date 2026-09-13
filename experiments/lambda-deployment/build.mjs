import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'

const healthy = process.env.PROBE_HEALTHY ?? 'true'
if (!['true', 'false'].includes(healthy)) throw new Error('PROBE_HEALTHY must be true or false')
const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim()
if (dirty) throw new Error('Commit fixture changes before building a source-bound release')
const release = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs', bundle: true,
  platform: 'node', target: 'node22', format: 'esm', minify: false,
  define: { PROBE_RELEASE: JSON.stringify(release), PROBE_HEALTHY: healthy },
})
