import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Compass,
  Crosshair,
  Dices,
  ExternalLink,
  Footprints,
  Info,
  LocateFixed,
  MapPin,
  Sparkles,
  WalletCards,
  X,
} from 'lucide-react'
import { generateQuest } from './questEngine'
import type { Budget, Quest, QuestInput, Vibe } from './types'

type Screen = 'home' | 'setup' | 'loading' | 'quest' | 'accepted' | 'error'

const vibes: { id: Vibe; label: string; hint: string; icon: string }[] = [
  { id: 'quiet', label: '想安静待会儿', hint: '别太吵，也别太赶', icon: '◌' },
  { id: 'curious', label: '想看点新鲜的', hint: '带我去点没见过的', icon: '✦' },
  { id: 'active', label: '想出去走走', hint: '坐够了，动起来', icon: '↗' },
  { id: 'local', label: '想逛得像本地人', hint: '别只推游客打卡点', icon: '⌂' },
  { id: 'surprise', label: '我不想选', hint: '你看着办吧', icon: '?' },
]

const budgets: { id: Budget; label: string }[] = [
  { id: 'free', label: '免费' },
  { id: '50', label: '50 元以内' },
  { id: '100', label: '100 元以内' },
  { id: 'custom', label: '自定义' },
]

const loadingSteps = [
  '正在翻翻你附近有什么',
  '先排除那些来不及的',
  '就选一个，别再纠结了',
  '给这趟出门加点任务感',
]

function chinaDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function deadlineDateLabel(value: string) {
  if (!value) return '选择日期'
  const today = chinaDateValue()
  const tomorrow = chinaDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const [, month, day] = value.split('-').map(Number)
  const prefix = value === today ? '今天' : value === tomorrow ? '明天' : ''
  return `${prefix ? `${prefix} · ` : ''}${month}月${day}日`
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="LITTLE DETOUR 首页">
      <span className="brand-mark"><Compass size={compact ? 18 : 21} strokeWidth={2.2} /></span>
      <span>LITTLE DETOUR</span>
    </div>
  )
}

function QuestTitle({ title, place }: { title: string; place: string }) {
  const placeStart = title.indexOf(place)
  if (placeStart === -1) return <>{title}</>

  return (
    <>
      {title.slice(0, placeStart)}
      <span className="place-highlight">{place}</span>
      {title.slice(placeStart + place.length)}
    </>
  )
}

function BriefModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <article className="brief-modal" role="dialog" aria-modal="true" aria-labelledby="brief-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close-button" onClick={onClose} aria-label="关闭产品说明"><X size={20} /></button>
        <span className="kicker">PRODUCT NOTE · 产品说明</span>
        <h2 id="brief-title">stop紧急攻略了，<br /><em>let's 出发！</em></h2>
        <p className="brief-lede">面对突然空出两三个小时，最烦的不是没地方去，而是打开社媒做攻略后的新一轮纠结。</p>
        <div className="brief-rule" />
        <section>
          <h3>问题是什么</h3>
          <p>收藏夹里躺着 100 个地点，真站到街头还是不知道去哪。距离、营业时间、预算、心情……每一个都要自己重新算一遍，空闲时间先被攻略吃掉一半。</p>
        </section>
        <section>
          <h3>我们提供什么</h3>
          <p>把你在哪儿、几点前有空、今天想怎么待告诉 LITTLE DETOUR。我们先把去不了、来不及、不合适的选项删掉，然后只留一个现在真的可以去的地方。</p>
        </section>
        <div className="brief-pillars">
          <div><strong>One</strong><span>一次只给一个 Quest</span></div>
          <div><strong>3</strong><span>最多切换三次</span></div>
          <div><strong>0</strong><span>无需研究地图</span></div>
        </div>
        <section>
          <h3>为什么不一样</h3>
          <ul>
            <li><Check size={16} /> 包你能去，半包有趣✌</li>
            <li><Check size={16} /> 不做海王，一个即可扬帆起航🌊</li>
            <li><Check size={16} /> 地点只是开场，小任务才是隐藏彩蛋🎁</li>
          </ul>
        </section>
        <p className="brief-footnote">MVP 路线：浏览器定位 → 高德真实地点与步行数据 → LLM 决策。不在产品中展示地图，不生成微型行程，也不提供预订服务。</p>
      </article>
    </div>
  )
}

function Header({ onBrief, onHome }: { onBrief: () => void; onHome: () => void }) {
  return (
    <header className="site-header">
      <button className="brand-button" onClick={onHome}><Brand compact /></button>
      <button className="text-button" onClick={onBrief}><Info size={16} /> 关于</button>
    </header>
  )
}

function Home({ onStart, onBrief }: { onStart: () => void; onBrief: () => void }) {
  return (
    <main className="home-screen">
      <Header onBrief={onBrief} onHome={() => undefined} />
      <section className="hero">
        <div className="hero-copy">
          <span className="kicker"><span className="live-dot" /> ONE PLACE · ONE MISSION</span>
          <h1 className="hero-title-en">Your next move,<br /><em>decided.</em></h1>
          <p className="hero-intro">突然空出两三个小时，又懒得临时做攻略？<br />告知你的位置与时间，我们会给你下一个目的地<br />再随机附送一件有点意思的小任务哦☺️</p>
          <button className="primary-button" onClick={onStart}>看看我该去哪 <ArrowRight size={19} /></button>
          <span className="privacy-note"><LocateFixed size={14} /> 无需注册 · 位置仅用于本次推荐</span>
        </div>

        <div className="hero-card-wrap" aria-label="LITTLE DETOUR 示例卡片">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <article className="preview-card">
            <div className="ticket-edge" />
            <div className="preview-top"><span>QUEST SAMPLE · 示例</span><Sparkles size={18} /></div>
            <div className="preview-symbol">A</div>
            <span className="preview-label">CURIOUS DETOUR · 好奇支线</span>
            <h2>去找一本封面很怪的<br />书</h2>
            <div className="preview-place"><MapPin size={17} /><div><strong>转角书房</strong><span>步行 12 分钟 · 正在营业</span></div></div>
            <div className="dashed-rule" />
            <span className="mission-label">YOUR MISSION · 你的任务</span>
            <p>找到一本你平时绝对不会主动拿起的书，先读完第一页。</p>
          </article>
          <div className="annotation annotation-one">不用收藏<br />不用比较</div>
          <div className="annotation annotation-two">真实地点<br />此刻可行</div>
        </div>
      </section>
      <footer className="home-footer"><span>享受旅程，让我们“现在就出发”～</span><span>Move with your day, not against it.</span></footer>
    </main>
  )
}

interface SetupProps {
  form: QuestInput
  setForm: React.Dispatch<React.SetStateAction<QuestInput>>
  onGenerate: () => void
  onBack: () => void
}

function Setup({ form, setForm, onGenerate, onBack }: SetupProps) {
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [draftHour, setDraftHour] = useState('')
  const [draftMinute, setDraftMinute] = useState('')
  const timePickerRef = useRef<HTMLDivElement>(null)

  const useLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('当前浏览器无法获取位置，请在下方输入附近的地标或区域。')
      return
    }
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({
          ...current,
          locationLabel: '我的当前位置',
          coordinates: { latitude: coords.latitude, longitude: coords.longitude },
        }))
        setLocating(false)
      },
      () => {
        setLocationError('无法获取你的位置，请改为输入附近的车站、地标或区域。')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  const customBudget = Number(form.customBudget)
  const hasValidBudget = form.budget !== 'custom' || (Number.isFinite(customBudget) && customBudget > 0)
  const deadlineTimestamp = form.freeUntilDate && form.freeUntil
    ? Date.parse(`${form.freeUntilDate}T${form.freeUntil}:00+08:00`)
    : NaN
  const deadlineMinutes = Math.floor((deadlineTimestamp - Date.now()) / 60000)
  const hasValidDeadline = Number.isFinite(deadlineMinutes) && deadlineMinutes >= 45
  const isValid = form.locationLabel.trim().length > 1 && hasValidDeadline && hasValidBudget

  useEffect(() => {
    if (!timePickerOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!timePickerRef.current?.contains(event.target as Node)) setTimePickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTimePickerOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [timePickerOpen])

  return (
    <main className="setup-screen">
      <div className="setup-header">
        <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> 返回</button>
        <Brand compact />
        <span className="step-count">01 / 01</span>
      </div>
      <section className="setup-layout">
        <aside className="setup-intro">
          <span className="kicker">QUICK CHECK · 花 20 秒告诉我</span>
          <h1 className="setup-title"><span>给我几个线索。</span><em>剩下的我来。</em></h1>
          <p>放心，不查户口。这里只问真正会影响推荐的几件事，也不会试图把你的空闲时间塞得满满当当。</p>
          <div className="principle-note"><span>JUST ONE</span><p>一次只给一个 Quest，不把选择题重新丢回给你。实在不喜欢，还有三次换题机会。</p></div>
        </aside>

        <form className="setup-form" onSubmit={(event) => { event.preventDefault(); if (isValid) onGenerate() }}>
          <fieldset>
            <legend><span>1</span> 你现在在哪儿？</legend>
            <button type="button" className="location-button" onClick={useLocation} disabled={locating}>
              <Crosshair size={19} /> {locating ? '正在获取位置…' : form.coordinates ? '已获取当前位置' : '使用我的当前位置'}
              {form.coordinates && <CheckCircle2 size={18} className="success-icon" />}
            </button>
            <div className="or-row"><span /> 或输入附近的车站、地标或区域 <span /></div>
            <div className="input-wrap"><MapPin size={18} /><input aria-label="当前位置" value={form.locationLabel} onChange={(e) => setForm({ ...form, locationLabel: e.target.value, coordinates: undefined })} placeholder="例如：上海静安寺" /></div>
            {locationError && <p className="field-error">{locationError}</p>}
          </fieldset>

          <fieldset>
            <legend><span>2</span> 哪天几点前都归你？</legend>
            <div className="time-picker-field" ref={timePickerRef}>
              <button
                type="button"
                className="input-wrap time-input-wrap"
                aria-label={`空闲截止时间，${deadlineDateLabel(form.freeUntilDate)}${form.freeUntil ? ` ${form.freeUntil}` : '，尚未选择时间'}`}
                aria-expanded={timePickerOpen}
                onClick={() => {
                  if (!timePickerOpen) {
                    const [hour = '', minute = ''] = form.freeUntil ? form.freeUntil.split(':') : []
                    setDraftHour(hour)
                    setDraftMinute(minute)
                  }
                  setTimePickerOpen((open) => !open)
                }}
              >
                <CalendarDays size={18} aria-hidden="true" />
                <span className="deadline-field-copy">
                  <strong>{deadlineDateLabel(form.freeUntilDate)}</strong>
                  <small className={form.freeUntil ? '' : 'is-placeholder'}>{form.freeUntil || '--:--'}</small>
                </span>
              </button>
              {timePickerOpen && (
                <div className="time-picker-popover" role="group" aria-label="选择空闲截止时间">
                  <span className="time-picker-caption">SELECT DEADLINE · 选个结束时间</span>
                  <label className="date-picker-control">
                    <span>先选日期</span>
                    <input
                      type="date"
                      aria-label="空闲截止日期"
                      min={chinaDateValue()}
                      value={form.freeUntilDate}
                      onChange={(event) => setForm((current) => ({ ...current, freeUntilDate: event.target.value }))}
                    />
                  </label>
                  <span className="time-picker-section-label">再选时间</span>
                  <div className="time-picker-selects">
                    <label>
                      <span>小时</span>
                      <select aria-label="小时" value={draftHour} onChange={(event) => setDraftHour(event.target.value)}>
                        <option value="" disabled>--</option>
                        {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                      </select>
                    </label>
                    <b>:</b>
                    <label>
                      <span>分钟</span>
                      <select aria-label="分钟" value={draftMinute} onChange={(event) => setDraftMinute(event.target.value)}>
                        <option value="" disabled>--</option>
                        {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')).map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="time-picker-done"
                    disabled={!draftHour || !draftMinute}
                    onClick={() => {
                      setForm((current) => ({ ...current, freeUntil: `${draftHour}:${draftMinute}` }))
                      setTimePickerOpen(false)
                    }}
                  >
                    就到这里 <Check size={15} />
                  </button>
                </div>
              )}
            </div>
            <p className={`field-hint ${form.freeUntil && !hasValidDeadline ? 'is-warning' : ''}`}>
              {form.freeUntil && deadlineMinutes <= 0
                ? '这个时间已经过去啦，换一个还没到的时间吧。'
                : form.freeUntil && deadlineMinutes < 45
                  ? '至少留出 45 分钟，才够开启一次 LITTLE DETOUR。'
                  : '默认今天；如果空闲跨过零点，点开就能换到明天或其他日期。'}
            </p>
          </fieldset>

          <fieldset>
            <legend><span>3</span> 现在想来点什么？</legend>
            <div className="vibe-grid">
              {vibes.map((vibe) => (
                <button type="button" key={vibe.id} className={`vibe-option ${form.vibe === vibe.id ? 'is-selected' : ''}`} onClick={() => setForm({ ...form, vibe: vibe.id })}>
                  <span className="vibe-icon">{vibe.icon}</span><span><strong>{vibe.label}</strong><small>{vibe.hint}</small></span>{form.vibe === vibe.id && <Check size={16} />}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend><span>4</span> 预算 <small>选填</small></legend>
            <div className="budget-row">
              {budgets.map((budget) => <button type="button" key={budget.id} className={form.budget === budget.id ? 'is-selected' : ''} onClick={() => setForm({ ...form, budget: budget.id })}>{budget.label}</button>)}
            </div>
            {form.budget === 'custom' && (
              <div className="custom-budget-wrap">
                <label className="custom-budget">
                  <WalletCards size={18} />
                  <span>¥</span>
                  <input
                    aria-label="自定义最高预算"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="1"
                    value={form.customBudget}
                    onChange={(event) => setForm({ ...form, customBudget: event.target.value })}
                    placeholder="输入最高预算"
                    autoFocus
                  />
                  <small>元</small>
                </label>
                <p className="field-hint">填一个你今天愿意花的最高金额。</p>
              </div>
            )}
          </fieldset>

          <button className="primary-button generate-button" disabled={!isValid}>好了，给我一个 Quest <ArrowRight size={19} /></button>
          <p className="demo-note">只会从真实地点中做决定。地点、地址和步行时间均来自高德地图；AI 不负责编地点。</p>
        </form>
      </section>
    </main>
  )
}

function Loading({ step }: { step: number }) {
  return (
    <main className="loading-screen">
      <Brand />
      <div className="radar"><span /><span /><Compass size={36} /></div>
      <span className="kicker">MAKING YOUR QUEST · 正在生成</span>
      <h1>{loadingSteps[step]}<span className="loading-dots">…</span></h1>
      <div className="loading-track"><span style={{ width: `${(step + 1) * 25}%` }} /></div>
      <p>正在核对真实地点、步行时间和你的预算。</p>
    </main>
  )
}

interface QuestViewProps {
  quest: Quest
  rerolls: number
  onReroll: () => void
  onAccept: () => void
  onEdit: () => void
  rerolling: boolean
}

function QuestView({ quest, rerolls, onReroll, onAccept, onEdit, rerolling }: QuestViewProps) {
  return (
    <main className="quest-screen" style={{ '--quest-accent': quest.accent } as React.CSSProperties}>
      <div className="quest-page-header"><Brand compact /><button className="text-button" onClick={onEdit}><ArrowLeft size={15} /> 修改条件</button></div>
      <section className={`quest-stage ${rerolling ? 'is-rerolling' : ''}`}>
        <div className="quest-number">SIDE<br />QUEST<br /><strong>#{quest.id.length + 7}</strong></div>
        <article className="quest-card">
          <div className="quest-card-top"><span className="kicker">{quest.eyebrow}</span><span className="verified"><span /> 真实地点 · 已核验</span></div>
          <h1><QuestTitle title={quest.title} place={quest.place} /></h1>
          <div className="destination-block">
            <div className="destination-pin"><MapPin size={22} /></div>
            <div><span>DESTINATION · 目的地</span><h2>{quest.place}</h2><p>{quest.category} · {quest.address}</p></div>
          </div>
          <div className="facts-grid">
            <div><Footprints size={17} /><span>{quest.travel}</span></div>
            <div><Clock3 size={17} /><span>{quest.duration}</span></div>
            <div><CheckCircle2 size={17} /><span>{quest.closing}</span></div>
            <div><WalletCards size={17} /><span>{quest.cost}</span></div>
          </div>
          <div className="mission-block">
            <span className="mission-number">01</span>
            <div><span>YOUR MISSION · 你的任务</span><p>{quest.mission}</p></div>
          </div>
          <div className="why-block"><Sparkles size={17} /><p><strong>为什么是它：</strong>{quest.reason}</p></div>
          <p className="verification-note"><CheckCircle2 size={14} /> {quest.verificationNote} · 数据来自{quest.sourceLabel}</p>
        </article>
      </section>
      <div className="quest-actions">
        <button className="primary-button accept-button" onClick={onAccept}>就它了，出发 <ArrowRight size={19} /></button>
        <button className="reroll-button" onClick={onReroll} disabled={rerolls === 0 || rerolling}><Dices size={19} /> {rerolls === 0 ? '切换次数已用完' : rerolls === 1 ? '最后一次 Reroll' : `换一个 · 还剩 ${rerolls} 次`}</button>
        <p>点一次就少一次，换掉的 Quest 不会再回来哦。</p>
      </div>
    </main>
  )
}

function Accepted({ quest, onReset }: { quest: Quest; onReset: () => void }) {
  const [copied, setCopied] = useState(false)

  const copyPlace = async () => {
    await navigator.clipboard?.writeText(`${quest.place}\n${quest.address}\n${quest.navigationUrl}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="accepted-screen" style={{ '--quest-accent': quest.accent } as React.CSSProperties}>
      <Brand />
      <div className="accepted-stamp"><Check size={35} /><span>QUEST<br />已接受</span></div>
      <span className="kicker">YOUR NEXT MOVE · 你的下一步</span>
      <h1><QuestTitle title={quest.title} place={quest.place} /></h1>
      <p className="accepted-place"><MapPin size={19} /> {quest.place} · {quest.travel}</p>
      <div className="accepted-mission"><span>到了别忘记</span><p>{quest.mission}</p></div>
      <div className="accepted-actions">
        <a className="primary-button" href={quest.navigationUrl} target="_blank" rel="noreferrer">打开高德去这里 <ExternalLink size={18} /></a>
        <button className="secondary-button" onClick={copyPlace}>{copied ? '已复制真实地址' : '复制地点信息'} <BookOpen size={18} /></button>
        <button className="text-button" onClick={onReset}>开始新的 LITTLE DETOUR</button>
      </div>
      <p className="sign-off">走慢一点，今天说不定会多记住点什么。</p>
    </main>
  )
}

function ErrorScreen({ message, onRetry, onEdit }: { message: string; onRetry: () => void; onEdit: () => void }) {
  return (
    <main className="error-screen">
      <Brand />
      <div className="error-symbol"><AlertTriangle size={36} /></div>
      <span className="kicker">NO FAKE PLACES · 不拿假地点凑数</span>
      <h1>这次先不乱指路。</h1>
      <p>{message}</p>
      <div className="error-actions">
        <button className="primary-button" onClick={onRetry}>再认真找一次 <ArrowRight size={18} /></button>
        <button className="text-button" onClick={onEdit}>返回修改条件</button>
      </div>
    </main>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [showBrief, setShowBrief] = useState(false)
  const [form, setForm] = useState<QuestInput>({ locationLabel: '', freeUntilDate: chinaDateValue(), freeUntil: '', vibe: 'curious', budget: 'free', customBudget: '' })
  const [quest, setQuest] = useState<Quest | null>(null)
  const [seenIds, setSeenIds] = useState<string[]>([])
  const [rerolls, setRerolls] = useState(3)
  const [loadingStep, setLoadingStep] = useState(0)
  const [rerolling, setRerolling] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [screen])

  const reset = () => {
    setScreen('setup')
    setQuest(null)
    setSeenIds([])
    setRerolls(3)
  }

  const createQuest = async () => {
    setScreen('loading')
    setErrorMessage('')
    setLoadingStep(0)
    const timer = window.setInterval(() => setLoadingStep((current) => Math.min(current + 1, 3)), 380)
    try {
      const next = await generateQuest(form, [])
      setQuest(next)
      setSeenIds([next.id])
      setScreen('quest')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '这次没有找到足够可靠的地点。')
      setScreen('error')
    } finally {
      window.clearInterval(timer)
    }
  }

  const reroll = async () => {
    if (rerolls <= 0 || rerolling) return
    setRerolling(true)
    try {
      const next = await generateQuest(form, seenIds)
      setQuest(next)
      setSeenIds((ids) => [...ids, next.id])
      setRerolls((count) => count - 1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '这次没有找到足够可靠的地点。')
      setScreen('error')
    } finally {
      setRerolling(false)
    }
  }

  const content = useMemo(() => {
    if (screen === 'home') return <Home onStart={() => setScreen('setup')} onBrief={() => setShowBrief(true)} />
    if (screen === 'setup') return <Setup form={form} setForm={setForm} onGenerate={createQuest} onBack={() => setScreen('home')} />
    if (screen === 'loading') return <Loading step={loadingStep} />
    if (screen === 'quest' && quest) return <QuestView quest={quest} rerolls={rerolls} onReroll={reroll} onAccept={() => setScreen('accepted')} onEdit={() => setScreen('setup')} rerolling={rerolling} />
    if (screen === 'accepted' && quest) return <Accepted quest={quest} onReset={reset} />
    if (screen === 'error') return <ErrorScreen message={errorMessage} onRetry={createQuest} onEdit={() => setScreen('setup')} />
    return null
  }, [screen, form, loadingStep, quest, rerolls, rerolling, errorMessage])

  return <>{content}{showBrief && <BriefModal onClose={() => setShowBrief(false)} />}</>
}
