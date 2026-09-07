import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './env.mjs'
import { createQuest, QuestServiceError } from './questService.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadEnv(join(root, '.env'))

const port = Number(process.env.PORT || 8787)
const dist = join(root, 'dist')
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64_000) throw new QuestServiceError('请求内容过大。', 'BAD_REQUEST', 413)
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function serveStatic(pathname, response) {
  if (!existsSync(dist)) return false
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let file = resolve(dist, requested)
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html')
  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(response)
  return true
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, {
      ok: true,
      amapConfigured: Boolean(process.env.AMAP_WEB_SERVICE_KEY),
      llmConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
      llmProvider: process.env.DASHSCOPE_API_KEY ? 'qwen' : 'local-rules',
      llmModel: process.env.QWEN_MODEL || 'qwen-flash',
    })
  }

  if (request.method === 'POST' && url.pathname === '/api/quests') {
    try {
      const payload = await readJson(request)
      return json(response, 200, await createQuest(payload))
    } catch (error) {
      const expected = error instanceof QuestServiceError
      if (!expected) console.error('[little-detour]', error)
      return json(response, expected ? error.status : 502, {
        code: expected ? error.code : 'UPSTREAM_ERROR',
        error: expected ? error.message : '真实地点服务刚刚走神了，请稍后再试。',
      })
    }
  }

  if (request.method === 'GET' && serveStatic(url.pathname, response)) return
  json(response, 404, { code: 'NOT_FOUND', error: '没有这个页面。' })
})

const host = process.env.HOST || '0.0.0.0'

server.listen(port, host, () => {
  console.log(`[little-detour] API running at http://${host}:${port}`)
  console.log(`[little-detour] AMap: ${process.env.AMAP_WEB_SERVICE_KEY ? 'ready' : 'key missing'} · LLM: ${process.env.DASHSCOPE_API_KEY ? 'Qwen ready' : 'grounded fallback'}`)
})
