import assert from 'node:assert/strict'
import test from 'node:test'
import { askQwen } from './qwen.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('asks Qwen for JSON without sending precise origin or candidate addresses', async () => {
  let requestBody
  globalThis.fetch = async (_request, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        selectedId: 'amap:REAL',
        title: '去真实书店抽一本意外之书',
        mission: '只读第一页。',
        reason: '时间和距离都刚刚好。',
        durationMinutes: 45,
      }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const result = await askQwen({
    input: { vibe: 'curious', availableMinutes: 120, maxBudget: 100 },
    candidates: [{ id: 'amap:REAL', name: '真实书店', category: '书店', walkMinutes: 8 }],
  }, { apiKey: 'test-key', baseUrl: 'https://example.test/v1', model: 'qwen-flash' })

  assert.equal(result.selectedId, 'amap:REAL')
  assert.equal(requestBody.model, 'qwen-flash')
  assert.equal(requestBody.response_format.type, 'json_object')
  assert.doesNotMatch(JSON.stringify(requestBody), /宝安南路|formattedAddress|address/)
})

test('rejects malformed model output so the quest service can use local rules', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"selectedId":"amap:REAL"}' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  await assert.rejects(
    askQwen({ input: {}, candidates: [] }, { apiKey: 'test-key', baseUrl: 'https://example.test/v1' }),
    /缺少 title/,
  )
})
