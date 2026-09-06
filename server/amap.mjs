const AMAP_ORIGIN = 'https://restapi.amap.com'

function asText(value) {
  return typeof value === 'string' ? value : ''
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function amapRequest(path, params, key, attempt = 0) {
  const url = new URL(path, AMAP_ORIGIN)
  url.search = new URLSearchParams({ ...params, key, output: 'json' }).toString()

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`高德地点服务请求失败（${response.status}）`)
  const payload = await response.json()
  if (payload?.status === '1') return payload

  const info = asText(payload?.info) || '未知错误'
  const rateLimited = /QPS_HAS_EXCEEDED_THE_LIMIT|ACCESS_TOO_FREQUENT/.test(info)
  if (rateLimited && attempt < 2) {
    await wait(1100 * (attempt + 1))
    return amapRequest(path, params, key, attempt + 1)
  }
  throw new Error(`高德地点服务返回失败：${info}`)
}

export async function convertGpsToAmap(coordinates, key) {
  const raw = `${coordinates.longitude.toFixed(6)},${coordinates.latitude.toFixed(6)}`
  const payload = await amapRequest('/v3/assistant/coordinate/convert', {
    locations: raw,
    coordsys: process.env.AMAP_INPUT_COORDSYS || 'gps',
  }, key)
  const [longitude, latitude] = asText(payload.locations).split(',').map(Number)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('定位坐标转换失败')
  return { longitude, latitude }
}

export async function geocodeAddress(address, key) {
  const payload = await amapRequest('/v3/geocode/geo', { address }, key)
  const result = Array.isArray(payload.geocodes) ? payload.geocodes[0] : undefined
  const [longitude, latitude] = asText(result?.location).split(',').map(Number)
  if (!result || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  return {
    longitude,
    latitude,
    formattedAddress: asText(result.formatted_address) || address,
    adcode: asText(result.adcode),
    citycode: asText(result.citycode),
  }
}

export async function reverseGeocode(coordinates, key) {
  const payload = await amapRequest('/v3/geocode/regeo', {
    location: `${coordinates.longitude},${coordinates.latitude}`,
    radius: '500',
    extensions: 'base',
  }, key)
  const regeocode = payload.regeocode || {}
  const component = regeocode.addressComponent || {}
  return {
    formattedAddress: asText(regeocode.formatted_address),
    adcode: asText(component.adcode),
    citycode: asText(component.citycode),
  }
}

export async function searchNearby({ center, keyword, radius, region }, key) {
  const payload = await amapRequest('/v5/place/around', {
    location: `${center.longitude},${center.latitude}`,
    keywords: keyword,
    radius: String(radius),
    sortrule: 'distance',
    page_size: '12',
    page_num: '1',
    show_fields: 'business,navi',
    ...(region ? { region, city_limit: 'true' } : {}),
  }, key)
  return Array.isArray(payload.pois) ? payload.pois : []
}

export async function getWalkingRoute(origin, destination, destinationId, key) {
  const payload = await amapRequest('/v5/direction/walking', {
    origin: `${origin.longitude},${origin.latitude}`,
    destination: `${destination.longitude},${destination.latitude}`,
    destination_id: destinationId,
    show_fields: 'cost',
    isindoor: '0',
  }, key)
  const path = payload.route?.paths?.[0]
  if (!path) return null

  const distance = Number(path.distance)
  const durationSeconds = Number(path.cost?.duration ?? path.duration)
  return {
    distanceMeters: Number.isFinite(distance) ? distance : null,
    durationMinutes: Number.isFinite(durationSeconds) ? Math.max(1, Math.ceil(durationSeconds / 60)) : null,
  }
}
