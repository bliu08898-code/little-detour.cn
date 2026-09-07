export type Vibe = 'quiet' | 'curious' | 'active' | 'local' | 'surprise'
export type Budget = 'free' | '50' | '100' | 'custom'

export interface QuestInput {
  locationLabel: string
  coordinates?: { latitude: number; longitude: number }
  freeUntilDate: string
  freeUntil: string
  vibe: Vibe
  budget: Budget
  customBudget: string
}

export interface Quest {
  id: string
  providerId: string
  eyebrow: string
  title: string
  place: string
  category: string
  address: string
  travel: string
  duration: string
  closing: string
  cost: string
  mission: string
  reason: string
  accent: string
  navigationUrl: string
  sourceLabel: string
  verifiedAt: string
  verificationNote: string
}
