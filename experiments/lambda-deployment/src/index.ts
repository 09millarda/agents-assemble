// Disposable #15 provider probe. No customer data or application services.
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

declare const PROBE_RELEASE: string
declare const PROBE_HEALTHY: boolean

const app = new Hono()
app.get('/health', (c) => c.json({
  healthy: PROBE_HEALTHY,
  release: PROBE_RELEASE,
  environment: process.env.PROBE_ENVIRONMENT ?? 'local',
}, PROBE_HEALTHY ? 200 : 503))

export const handler = handle(app)
