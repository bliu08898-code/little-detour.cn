const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    selectedId: { type: 'string' },
    title: { type: 'string' },
    mission: { type: 'string' },
    reason: { type: 'string' },
    durationMinutes: { type: 'integer', minimum: 20, maximum: 120 },
  },
  required: ['selectedId', 'title', 'mission', 'reason', 'durationMinutes'],
}

export async function askOpenAI({ input, candidates }, apiKey) {
  if (!apiKey) return null

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.4-nano',
      store: false,
      reasoning: { effort: 'low' },
      instructions: [
        '你是 LITTLE DETOUR 的决策器。只能从提供的真实候选地点中选择，绝不能创造或修改地点名称、地址、距离、营业时间和消费信息。',
        '优先级依次是：赶得上、地点真实、符合预算、符合心情、有一点意外感。',
        '只安排一个目的地。title 是简短行动指令；mission 是到达该地点后能完成、有观察感且不打扰他人的小任务。使用自然、有社媒感的简体中文。',
      ].join('\n'),
      input: JSON.stringify({ user: input, candidates }),
      text: {
        format: {
          type: 'json_schema',
          name: 'little_detour_quest',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) throw new Error(`OpenAI 请求失败（${response.status}）`)
  const payload = await response.json()
  if (!payload.output_text) throw new Error('OpenAI 没有返回可用结果')
  return JSON.parse(payload.output_text)
}
