import type { Quest, QuestInput } from './types'

interface QuestApiError {
  error?: string
  code?: string
}

export class QuestGenerationError extends Error {
  code: string

  constructor(message: string, code = 'QUEST_FAILED') {
    super(message)
    this.name = 'QuestGenerationError'
    this.code = code
  }
}

export async function generateQuest(input: QuestInput, excludedIds: string[] = []): Promise<Quest> {
  let response: Response

  try {
    response = await fetch('/api/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, excludedIds }),
    })
  } catch {
    throw new QuestGenerationError('真实地点服务暂时没有连上。请确认本地服务正在运行，再试一次。', 'NETWORK_ERROR')
  }

  const payload = await response.json().catch(() => ({})) as Quest | QuestApiError
  if (!response.ok) {
    const error = payload as QuestApiError
    throw new QuestGenerationError(error.error || '这次没有找到足够可靠的地点，请稍后再试。', error.code)
  }

  return payload as Quest
}
