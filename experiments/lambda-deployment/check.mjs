// Checks the real Hono Lambda adapter with an HTTP API v2 event.
import assert from 'node:assert/strict'
import { handler } from './dist/index.mjs'

const expected = process.env.PROBE_HEALTHY !== 'false'
process.env.PROBE_ENVIRONMENT = 'local-check'
const response = await handler({
  version: '2.0', routeKey: 'GET /health', rawPath: '/health', rawQueryString: '',
  headers: { host: 'fixture.invalid' }, isBase64Encoded: false,
  requestContext: {
    domainName: 'fixture.invalid', requestId: 'local', stage: '$default',
    http: { method: 'GET', path: '/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
  },
}, {})
assert.equal(response.statusCode, expected ? 200 : 503)
const body = JSON.parse(response.body)
assert.equal(body.healthy, expected)
assert.equal(body.environment, 'local-check')
assert.match(body.release, /^[a-f0-9]{40}$/)
console.log(`Hono Lambda adapter: expected health ${response.statusCode} passed`)
