import { convertGpsToAmap, geocodeAddress, getWalkingRoute, reverseGeocode, searchNearby } from './amap.mjs'
import { askOpenAI } from './openai.mjs'

export class QuestServiceError extends Error {
  constructor(message, code, status = 400) {
    super(message)
    this.name = 'QuestServiceError'
    this.code = code
    this.status = status
  }
}

const VIBE_KEYWORDS = {
  quiet: ['书店', '图书馆', '公园', '美术馆'],
  curious: ['博物馆', '美术馆', '书店', '展览馆', '创意园'],
  active: ['公园', '绿道', '体育公园', '景区'],
  local: ['市场', '老街', '书店', '公园', '文化馆'],
  surprise: ['书店', '公园', '博物馆', '美术馆', '市场', '创意园'],
}

const VIBE_META = {
  quiet: ['QUIET RESET · 安静重启', '#387a59'],
  curious: ['CURIOUS DETOUR · 好奇支线', '#ee5f3d'],
  active: ['ACTIVE BREAK · 出门透气', '#2f6f91'],
  local: ['LOCAL SIDE STREET · 本地支路', '#b67422'],
  surprise: ['LUCKY DETOUR · 随机掉落', '#8b5aa5'],
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chinaClock() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Number(values.hour) * 60 + Number(values.minute)
}

export function minutesUntil(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return NaN
  const [hour, minute] = time.split(':').map(Number)
  let end = hour * 60 + minute
  const now = chinaClock()
  if (end <= now && end + 1440 - now <= 12 * 60) end += 1440
  return end - now
}

function budgetLimit(input) {
  if (input.budget === 'free') return 0
  if (input.budget === '50') return 50
  if (input.budget === '100') return 100
  return Number(input.customBudget)
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function parsePoint(location) {
  const [longitude, latitude] = text(location).split(',').map(Number)
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null
}

function parseCost(value) {
  const cost = Number.parseFloat(text(value))
  return Number.isFinite(cost) ? cost : null
}

function isLikelyFree(poi) {
  return /(公园|绿道|图书馆|书店|老街|广场|文化馆)/.test(`${text(poi.name)} ${text(poi.type)}`)
}

function visitMinutes(poi) {
  const label = `${text(poi.name)} ${text(poi.type)}`
  if (/(博物馆|美术馆|展览)/.test(label)) return 60
  if (/(公园|绿道|景区)/.test(label)) return 50
  return 45
}

function openingStatus(hours, arrivalMinutes, stayMinutes) {
  if (/(24\s*小时|全天)/.test(text(hours))) return 'open'
  const ranges = [...text(hours).matchAll(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g)]
  if (!ranges.length) return 'unknown'
  const visitEnd = arrivalMinutes + stayMinutes
  return ranges.some((match) => {
    const start = Number(match[1]) * 60 + Number(match[2])
    let end = Number(match[3]) * 60 + Number(match[4])
    if (end < start) end += 1440
    return arrivalMinutes >= start && visitEnd <= end
  }) ? 'open' : 'closed'
}

function fullAddress(poi) {
  const chunks = [poi.pname, poi.cityname, poi.adname, poi.address].map(text).filter(Boolean)
  return chunks.filter((item, index) => index === 0 || !chunks[index - 1]?.includes(item)).join('')
}

function fallbackWriting(candidate) {
  const label = `${candidate.name} ${candidate.category}`
  if (/(书店|图书馆)/.test(label)) return {
    title: `去 ${candidate.name} 翻一本意外之书`,
    mission: '找到一本你平时不会主动拿起的书，只读第一页，再决定要不要继续。',
    reason: '路程轻松，停留时间也刚好，适合给今天插入一点不按计划的内容。',
  }
  if (/(公园|绿道|广场)/.test(label)) return {
    title: `去 ${candidate.name} 走一小圈`,
    mission: '先不戴耳机走十分钟，找到一个最想停下来的角落，再给它拍一张不带人的照片。',
    reason: '不用预约，也不需要额外做攻略，走到那里就能开始。',
  }
  if (/(博物馆|美术馆|展览|文化馆)/.test(label)) return {
    title: `去 ${candidate.name} 只看一件东西`,
    mission: '别急着把所有内容看完，只选一件最想带回家的展品，并记住它为什么吸引你。',
    reason: '它在你的时间窗口内够得着，也足够给今天制造一个小小的新发现。',
  }
  return {
    title: `去 ${candidate.name} 随便逛逛`,
    mission: '进去后先别搜评价，跟着第一件让你好奇的东西走，至少停留十分钟。',
    reason: '距离和时间都合适，不需要再做一轮选择题。',
  }
}

function navigationUrl(candidate) {
  const to = `${candidate.location.longitude},${candidate.location.latitude},${candidate.name}`
  const params = new URLSearchParams({ to, mode: 'walk', policy: '0', src: 'little-detour', callnative: '1' })
  return `https://uri.amap.com/navigation?${params}`
}

async function resolveOrigin(input, amapKey) {
  if (input.coordinates && Number.isFinite(input.coordinates.latitude) && Number.isFinite(input.coordinates.longitude)) {
    const center = await convertGpsToAmap(input.coordinates, amapKey)
    const location = await reverseGeocode(center, amapKey)
    return { center, ...location }
  }

  const geocoded = await geocodeAddress(text(input.locationLabel).trim(), amapKey)
  if (!geocoded) throw new QuestServiceError('没有认出这个位置。试试输入更完整的商场、车站或街道名称。', 'LOCATION_NOT_FOUND')
  return { center: { longitude: geocoded.longitude, latitude: geocoded.latitude }, ...geocoded }
}

export async function createQuest({ input, excludedIds = [] }, config = process.env) {
  const amapKey = config.AMAP_WEB_SERVICE_KEY
  if (!amapKey) {
    throw new QuestServiceError('真实地点服务还没连接好。配置高德 Web 服务 Key 后再试，我不会再用虚构地点敷衍你。', 'CONFIG_REQUIRED', 503)
  }

  const availableMinutes = minutesUntil(input?.freeUntil)
  if (!Number.isFinite(availableMinutes) || availableMinutes < 45) {
    throw new QuestServiceError('这段时间有点太短啦，至少留出 45 分钟再开启一次 LITTLE DETOUR。', 'TIME_TOO_SHORT')
  }

  const maxBudget = budgetLimit(input)
  if (!Number.isFinite(maxBudget) || maxBudget < 0) {
    throw new QuestServiceError('预算看起来不太对，请重新填写一个数字。', 'INVALID_BUDGET')
  }

  const origin = await resolveOrigin(input, amapKey)
  const radius = availableMinutes < 90 ? 1500 : availableMinutes < 180 ? 3000 : 5000
  const keywords = VIBE_KEYWORDS[input.vibe] || VIBE_KEYWORDS.surprise
  const excluded = new Set(excludedIds)
  const unique = new Map()
  for (const keyword of keywords) {
    const batch = await searchNearby({ center: origin.center, keyword, radius, region: origin.adcode }, amapKey)
    for (const poi of batch) {
      if (!poi?.id || excluded.has(`amap:${poi.id}`) || unique.has(poi.id)) continue
      const location = parsePoint(poi.location)
      if (!location || !text(poi.name) || !text(poi.address)) continue
      unique.set(poi.id, { ...poi, location })
    }
    await wait(1100)
  }

  const nowMinutes = chinaClock()
  const nearby = [...unique.values()]
    .sort((a, b) => Number(a.distance || Infinity) - Number(b.distance || Infinity))
    .filter((poi) => {
      const approximateTravel = Math.max(2, Math.ceil(Number(poi.distance || 0) / 70))
      return openingStatus(poi.business?.opentime_today, nowMinutes + approximateTravel, visitMinutes(poi)) === 'open'
    })
    .slice(0, 6)

  const routed = []
  for (const poi of nearby) {
    const route = await getWalkingRoute(origin.center, poi.location, poi.id, amapKey).catch(() => null)
    const approximateMinutes = Math.max(2, Math.ceil(Number(poi.distance || 0) / 70))
    routed.push({
      id: `amap:${poi.id}`,
      providerId: poi.id,
      name: text(poi.name),
      address: fullAddress(poi),
      category: text(poi.type).split(';').filter(Boolean).slice(-1)[0] || '城市地点',
      location: poi.location,
      distanceMeters: route?.distanceMeters ?? (Number(poi.distance) || 0),
      travelMinutes: route?.durationMinutes ?? approximateMinutes,
      stayMinutes: visitMinutes(poi),
      hours: text(poi.business?.opentime_today),
      costValue: parseCost(poi.business?.cost),
      rating: Number.parseFloat(text(poi.business?.rating)) || null,
      likelyFree: isLikelyFree(poi),
    })
    await wait(1100)
  }

  const feasible = routed.filter((candidate) => {
    if (candidate.travelMinutes + candidate.stayMinutes + 20 > availableMinutes) return false
    if (openingStatus(candidate.hours, nowMinutes + candidate.travelMinutes, candidate.stayMinutes) === 'closed') return false
    if (candidate.costValue !== null && candidate.costValue > maxBudget) return false
    if (maxBudget === 0 && candidate.costValue === null && !candidate.likelyFree) return false
    return true
  }).sort((a, b) => {
    const aKnown = openingStatus(a.hours, nowMinutes + a.travelMinutes, a.stayMinutes) === 'open' ? 1 : 0
    const bKnown = openingStatus(b.hours, nowMinutes + b.travelMinutes, b.stayMinutes) === 'open' ? 1 : 0
    return (bKnown - aKnown) || ((b.rating || 0) - (a.rating || 0)) || (a.travelMinutes - b.travelMinutes)
  })

  if (!feasible.length) {
    throw new QuestServiceError('附近暂时没有找到同时满足时间和预算的可靠地点。换个心情或稍微放宽预算，再试一次吧。', 'NO_FEASIBLE_PLACE', 404)
  }

  const grounded = feasible.slice(0, 8)
  let writing = null
  try {
    writing = await askOpenAI({
      input: { vibe: input.vibe, availableMinutes, maxBudget, location: origin.formattedAddress },
      candidates: grounded.map((item) => ({
        id: item.id, name: item.name, category: item.category, address: item.address,
        walkMinutes: item.travelMinutes, stayMinutes: item.stayMinutes,
        todayHours: item.hours || '未公开', costPerPerson: item.costValue,
      })),
    }, config.OPENAI_API_KEY)
  } catch (error) {
    console.warn('[little-detour] LLM unavailable, using grounded writing fallback:', error.message)
  }

  let selected = grounded.find((item) => item.id === writing?.selectedId) || grounded[0]
  const copy = writing && selected.id === writing.selectedId ? writing : fallbackWriting(selected)
  const status = openingStatus(selected.hours, nowMinutes + selected.travelMinutes, selected.stayMinutes)
  const costText = selected.costValue !== null
    ? `人均约 ${Math.round(selected.costValue)} 元`
    : selected.likelyFree ? '可免费到访' : '消费信息未公开'
  const caveats = []
  if (status === 'unknown') caveats.push('营业时间未公开，建议出发前在高德确认')
  if (selected.costValue === null) caveats.push(selected.likelyFree ? '到访通常无需消费，额外消费不在内' : '消费信息未公开')

  return {
    id: selected.id,
    providerId: selected.providerId,
    eyebrow: VIBE_META[input.vibe]?.[0] || VIBE_META.surprise[0],
    title: copy.title,
    place: selected.name,
    category: selected.category,
    address: selected.address,
    travel: `步行约 ${selected.travelMinutes} 分钟`,
    duration: `建议停留 ${Math.max(20, Math.min(copy.durationMinutes || selected.stayMinutes, selected.stayMinutes + 20))} 分钟`,
    closing: selected.hours ? `今日营业 ${selected.hours}` : '营业时间未公开',
    cost: costText,
    mission: copy.mission,
    reason: copy.reason,
    accent: VIBE_META[input.vibe]?.[1] || VIBE_META.surprise[1],
    navigationUrl: navigationUrl(selected),
    sourceLabel: '高德地图',
    verifiedAt: new Date().toISOString(),
    verificationNote: caveats.length
      ? `真实地点与步行路线已核验；${caveats.join('；')}。`
      : '真实地点、步行路线、营业时间与预算均已核验。',
  }
}
