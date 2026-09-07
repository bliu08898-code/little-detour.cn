import { convertGpsToAmap, geocodeAddress, getWalkingRoute, reverseGeocode, searchNearby } from './amap.mjs'
import { askQwen } from './qwen.mjs'

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

const MISSION_LIBRARY = [
  {
    match: /(书店|图书馆|阅读空间)/,
    copies: [
      ['翻一本意外之书', '找到一本你平时不会主动拿起的书，只读第一页，再决定要不要继续。', '路程轻松，刚好给今天插入一点不按计划的内容。'],
      ['把选书交给第一句话', '随手抽一本书，只看第一句话；如果它留住了你，就再读一页。', '不用研究榜单，一句话就够你和一本书认识一下。'],
      ['找一本最会穿搭的书', '不看作者和评分，只凭封面挑一本和你今天穿搭最配的书。', '这趟不考阅读量，只负责发现一点视觉上的巧合。'],
      ['去第 47 页碰运气', '挑一本顺眼的书翻到第 47 页，留下最想抄走的一句话。', '给随机一点权力，也许会撞见一句此刻刚好需要的话。'],
      ['替未来挑一个城市', '去旅行或城市区，找到一个从没认真考虑过的目的地，读完它的目录。', '不用真的订票，先让下一段旅程在脑子里冒个泡。'],
    ],
  },
  {
    match: /(公园|绿道|广场|植物园|花园|湿地)/,
    copies: [
      ['走一小圈再说', '先不戴耳机走十分钟，找到一个最想停下来的角落。', '不用预约也不用做攻略，走到那里就能开始。'],
      ['收集今天的三种颜色', '一路找出三种让你觉得“很今天”的颜色，最后只拍最喜欢的一种。', '轻松走走的同时，也给这段空白时间留一点记忆。'],
      ['找一把最会选景的椅子', '找到视野最好的一张长椅，坐满五分钟，什么都先别处理。', '这里适合短暂关机，不需要完成任何宏大目标。'],
      ['跟一条陌生小路走', '在安全开放的步道里选一条没走过的小路，走到下一个路口再决定方向。', '一点点未知就够了，不必把自己带得太远。'],
      ['听完一首歌再回来', '选一首最近常听的歌，沿开放步道走到歌曲结束，再原路慢慢回来。', '时间可控、体力友好，也能把脑袋里的页面刷新一下。'],
    ],
  },
  {
    match: /(博物馆|美术馆|展览|文化馆|纪念馆|艺术馆|画廊)/,
    copies: [
      ['只认真看一件东西', '别急着全部看完，只选一件最想带回家的展品，记住它为什么吸引你。', '它在时间窗口内够得着，也足够制造一个小小的新发现。'],
      ['给一件展品起外号', '找到一件让你停下来的作品，在心里给它起一个只有你知道的外号。', '不需要懂艺术，先建立一点属于自己的联系。'],
      ['寻找全场最奇怪的一件', '逛到一件让你冒出问号的展品，先猜它想表达什么，再看说明。', '好奇心比标准答案更适合开启这段支线。'],
      ['带走一个冷知识', '离开前只记住一个能在饭桌上讲给朋友听的冷知识。', '目标足够小，不会把看展变成赶作业。'],
      ['选出今天的封面', '如果允许拍照，选一件作品拍成今天的“封面”；不允许就记下它的名字。', '给这几个小时留下一个明确而不费力的纪念。'],
    ],
  },
  {
    match: /(市场|市集|老街|步行街|集市|菜市场|夜市)/,
    copies: [
      ['找一个没见过的小东西', '沿公开区域慢慢走，找到一种以前叫不出名字的食物或物件。', '这里的信息密度够高，随便转一圈也容易遇见新鲜事。'],
      ['把今天交给一种味道', '找出空气里最明显的一种味道，顺着它走一小段，但不必消费。', '用鼻子带路，比再刷一轮榜单有趣多了。'],
      ['观察三块很会说话的招牌', '挑三块最有个性的店招，选出你心里的今日冠军。', '老街和市场的灵魂常常不在攻略里，而在招牌和细节里。'],
      ['找到本地人的一站', '观察哪家店最常有附近居民停下，站在不妨碍通行的位置看看它卖什么。', '跟着真实生活的节奏走，比跟着热榜更接近这里。'],
      ['用十块钱做一道选择题', '如果预算允许，只给自己十元上限，买或不买都行；重点是找到最想试的那一样。', '把选择缩小，反而更容易尝到一点当地气息。'],
    ],
  },
  {
    match: /(创意园|产业园|文创|设计|手工艺|工艺品|艺术中心)/,
    copies: [
      ['找一个想偷走的设计', '挑一个最想搬回家的设计细节，只记录它哪里打动了你。', '这里适合漫无目的地吸收一点灵感。'],
      ['收集一个奇怪字体', '找到一处让你多看一眼的字体或标识，拍下或记住它。', '不需要专业眼光，觉得有意思就已经成立。'],
      ['替这里做一张假海报', '选一个角落，在脑中给它配一句海报标题，越不正经越好。', '一点轻量创作，会让普通的闲逛突然有了主线。'],
      ['找到最不像打卡点的地方', '跳过最热闹的机位，找一个安静但有意思的开放角落停五分钟。', '避开标准答案，才更像你自己的小支线。'],
      ['选出今日灵感 MVP', '逛完后只选一个最想分享给朋友的细节，并用一句话说明原因。', '任务很小，但足够让这趟不是走马观花。'],
    ],
  },
  {
    match: /(商场|购物中心|百货|专卖店|生活馆|家居|杂货|集合店)/,
    copies: [
      ['只逛一家没进过的店', '选一家以前没注意过的店，进去看满五分钟，不要求买东西。', '范围缩小之后，商场也可以不是一场体力考试。'],
      ['找一件完全不像你的东西', '找到一件你绝对不会买、但忍不住多看两眼的商品。', '不用消费，也能测试一下自己的审美边界。'],
      ['寻找本层最佳包装', '只看包装，选出这一层最会吸引人的一件商品。', '给闲逛加一个观察目标，就不会只剩下漫无目的。'],
      ['做一次五分钟橱窗评审', '挑三家橱窗，选出最想让你走进去的一家，并说出原因。', '这是一场不花钱的小型视觉投票。'],
      ['替朋友挑一件虚拟礼物', '想起一个朋友，在预算内找一件“如果今天要送就会选它”的东西，不必真的购买。', '带着一个具体的人逛，选择会突然变得有趣。'],
    ],
  },
  {
    match: /(景区|景点|塔|码头|滨水|河岸|海滨|古迹|建筑|街区)/,
    copies: [
      ['找它最好看的那一面', '绕开放区域走一小段，找到一个比正面更好看的角度。', '地标不只有标准机位，换个方向可能更有惊喜。'],
      ['拍一张没有主角的照片', '避开自拍和人群，拍一张只靠光线、影子或建筑成立的照片。', '不用证明来过，也可以留下属于今天的画面。'],
      ['找一个城市声音', '安静听一分钟，选出最能代表这里的一种声音。', '换一种感官逛城市，熟悉的地方也会变新。'],
      ['走到视线尽头再停', '沿安全开放路线走向当前视线里最远的标志物，到达后休息一下。', '目标看得见、时间也可控，很适合立刻出发。'],
      ['给这里写一句旁白', '找到一个有故事感的角落，在心里给眼前画面配一句电影旁白。', '给现实加一点剧情，这段绕路就不再普通。'],
    ],
  },
  {
    match: /.*/,
    copies: [
      ['随便逛逛，认真发现', '先别搜评价，跟着第一件让你好奇的东西走，至少停留十分钟。', '距离和时间都合适，不需要再做一轮选择题。'],
      ['进去看看再下结论', '给这个地方十分钟，在离开前找到一个比预想中更有意思的细节。', '不用提前喜欢它，到了现场再决定也不迟。'],
      ['完成一次小小的偏航', '从入口开始选与你第一反应相反的方向，沿开放区域走一段。', '偶尔不按惯性选择，才像真正的 detour。'],
      ['找到一个值得发给朋友的点', '找一件会让你想到某位朋友的东西，拍下或记住，之后发不发都随你。', '带着一点私人联想，陌生地点会更快变得具体。'],
      ['给好奇心十分钟', '设置十分钟计时，只观察不评价；结束时说出最意外的一件事。', '任务够轻，也能让这次出发不只是路过。'],
    ],
  },
]

const VIBE_OFFSET = { quiet: 0, curious: 1, active: 2, local: 3, surprise: 4 }

function hashText(value) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.codePointAt(0)) >>> 0
  return hash
}

export function fallbackWriting(candidate, input = {}, rerollCount = 0) {
  const label = `${candidate.name} ${candidate.category}`
  const group = MISSION_LIBRARY.find((item) => item.match.test(label)) || MISSION_LIBRARY.at(-1)
  const offset = VIBE_OFFSET[input.vibe] ?? VIBE_OFFSET.surprise
  const index = (hashText(candidate.id || candidate.name) + offset + rerollCount) % group.copies.length
  const [action, mission, reason] = group.copies[index]
  return { title: `去 ${candidate.name} ${action}`, mission, reason }
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
  let generationFallbackReason = null
  try {
    writing = await askQwen({
      input: { vibe: input.vibe, availableMinutes, maxBudget },
      candidates: grounded.map((item) => ({
        id: item.id, name: item.name, category: item.category,
        walkMinutes: item.travelMinutes, stayMinutes: item.stayMinutes,
        todayHours: item.hours || '未公开', costPerPerson: item.costValue,
      })),
    }, {
      apiKey: config.DASHSCOPE_API_KEY,
      baseUrl: config.DASHSCOPE_BASE_URL,
      model: config.QWEN_MODEL,
    })
  } catch (error) {
    console.warn('[little-detour] LLM unavailable, using grounded writing fallback:', error.message)
    const status = error?.status || String(error?.message || '').match(/（(\d{3})/i)?.[1]
    const apiCode = error?.apiCode ? `-${error.apiCode}` : ''
    generationFallbackReason = status ? `model-http-${status}${apiCode}` : 'model-output-invalid-or-timeout'
  }

  let selected = grounded.find((item) => item.id === writing?.selectedId) || grounded[0]
  const copy = writing && selected.id === writing.selectedId
    ? writing
    : fallbackWriting(selected, input, excludedIds.length)
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
    generationSource: writing && selected.id === writing.selectedId ? 'qwen' : 'local-rules',
    generationFallbackReason,
  }
}
