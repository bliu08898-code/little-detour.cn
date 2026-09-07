import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuest, fallbackWriting, QuestServiceError } from './questService.mjs'

const originalFetch = globalThis.fetch

function json(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function installAmapMock() {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request))
    if (url.pathname.includes('/coordinate/convert')) return json({ status: '1', locations: '114.123456,22.543210' })
    if (url.pathname.includes('/geocode/regeo')) return json({
      status: '1',
      regeocode: { formatted_address: '广东省深圳市罗湖区宝安南路1881号', addressComponent: { adcode: '440303', citycode: '0755' } },
    })
    if (url.pathname.includes('/place/around')) return json({
      status: '1',
      pois: [{
        id: 'B0REALPLACE', name: '深圳书城罗湖城', location: '114.124000,22.544000', distance: '280',
        type: '购物服务;文化用品店;书店', pname: '广东省', cityname: '深圳市', adname: '罗湖区',
        address: '深南东路5033号', business: { opentime_today: '24小时营业', cost: '88', rating: '4.8' },
      }],
    })
    if (url.pathname.includes('/direction/walking')) return json({
      status: '1', route: { paths: [{ distance: '420', cost: { duration: '360' } }] },
    })
    throw new Error(`Unexpected URL: ${url}`)
  }
}

test.afterEach(() => { globalThis.fetch = originalFetch })

test('returns a grounded quest whose place and address come from the POI provider', async () => {
  installAmapMock()
  const quest = await createQuest({
    input: {
      locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
      freeUntil: '23:59', vibe: 'curious', budget: 'custom', customBudget: '200',
    },
    excludedIds: [],
  }, { AMAP_WEB_SERVICE_KEY: 'test-key' })

  assert.equal(quest.id, 'amap:B0REALPLACE')
  assert.equal(quest.place, '深圳书城罗湖城')
  assert.match(quest.address, /深南东路5033号/)
  assert.match(quest.travel, /6 分钟/)
  assert.match(quest.navigationUrl, /^https:\/\/uri\.amap\.com\/navigation/)
  assert.equal(quest.verificationNote, '真实地点、步行路线、营业时间与预算均已核验。')
  assert.doesNotMatch(JSON.stringify(quest), /转角书房/)
})

test('rejects a known over-budget candidate instead of pretending it is feasible', async () => {
  installAmapMock()
  await assert.rejects(
    createQuest({
      input: {
        locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
        freeUntil: '23:59', vibe: 'curious', budget: '50', customBudget: '',
      },
      excludedIds: [],
    }, { AMAP_WEB_SERVICE_KEY: 'test-key' }),
    (error) => error instanceof QuestServiceError && error.code === 'NO_FEASIBLE_PLACE',
  )
})

test('offers forty distinct grounded mission variants across venue types and vibes', () => {
  const venues = [
    ['reading', '街角图书馆', '图书馆'],
    ['nature', '城市中央公园', '公园'],
    ['exhibition', '今日美术馆', '美术馆'],
    ['market', '周末旧物市集', '市场'],
    ['creative', '南头创意园', '创意园'],
    ['retail', '城市生活馆', '生活馆'],
    ['landmark', '海边灯塔', '景点'],
    ['general', '城市体验空间', '休闲场所'],
  ]
  const vibes = ['quiet', 'curious', 'active', 'local', 'surprise']
  const results = new Set()

  for (const [id, name, category] of venues) {
    for (const vibe of vibes) {
      const copy = fallbackWriting({ id, name, category }, { vibe })
      results.add(`${copy.title}|${copy.mission}|${copy.reason}`)
    }
  }

  assert.equal(results.size, 40)
})
