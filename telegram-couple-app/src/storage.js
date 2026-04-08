import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { APP_CONFIG, DAILY_QUESTIONS, MATCH_TOPICS } from './content.js'

const dataDir = path.join(process.cwd(), 'data')
const dataFile = path.join(dataDir, 'storage.json')
const DAY_MS = 24 * 60 * 60 * 1000

function baseData() {
  return {
    users: {},
    codes: {},
    couples: {},
    wallets: {},
    dailyAnswers: {},
    matchAnswers: {},
    memories: [],
    purchases: [],
    rewards: {
      daily: {},
      match: {}
    },
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(baseData(), null, 2))
  }
}

function readData() {
  ensureDataFile()

  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    const merged = {
      ...baseData(),
      ...parsed,
      users: parsed.users || {},
      codes: parsed.codes || {},
      couples: parsed.couples || {},
      wallets: parsed.wallets || {},
      dailyAnswers: parsed.dailyAnswers || {},
      matchAnswers: parsed.matchAnswers || {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
      rewards: {
        ...baseData().rewards,
        ...(parsed.rewards || {}),
        daily: parsed.rewards?.daily || {},
        match: parsed.rewards?.match || {}
      }
    }

    // One-time migration from legacy single-household model.
    if (!Object.keys(merged.users).length && parsed.access?.approvedUsers) {
      const legacyUsers = parsed.access.approvedUsers || {}
      for (const [id, legacy] of Object.entries(legacyUsers)) {
        merged.users[id] = {
          id,
          name: legacy.name,
          username: legacy.username || '',
          avatarUrl: legacy.avatarUrl || '',
          createdAt: legacy.approvedAt || Date.now(),
          approvedDateKey: legacy.approvedDateKey || getCurrentDateKey(),
          code: ''
        }
      }
      const ids = Object.keys(merged.users)
      if (ids.length === 2) {
        const coupleId = crypto.randomUUID()
        merged.couples[coupleId] = { id: coupleId, userIds: ids, createdAt: Date.now() }
        for (const id of ids) {
          merged.users[id].coupleId = coupleId
        }
      }
    }

    // Ensure codes for all users.
    for (const user of Object.values(merged.users)) {
      if (!user.code || merged.codes[user.code] !== user.id) {
        user.code = generateUserCode(merged)
        merged.codes[user.code] = user.id
      }
    }

    return merged
  } catch {
    return baseData()
  }
}

function writeData(data) {
  ensureDataFile()
  data.meta.updatedAt = Date.now()
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function getDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_CONFIG.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value || 0),
    month: Number(parts.find((part) => part.type === 'month')?.value || 0),
    day: Number(parts.find((part) => part.type === 'day')?.value || 0)
  }
}

export function getCurrentDateKey() {
  const parts = getDateParts()
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

function timestampToDateKey(timestamp) {
  const parts = getDateParts(new Date(timestamp))
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  if (!year || !month || !day) {
    throw new Error('Некорректная дата.')
  }
  return { year, month, day }
}

function dateKeyToUtc(dateKey) {
  const { year, month, day } = parseDateKey(dateKey)
  return Date.UTC(year, month - 1, day)
}

function utcToDateKey(timestamp) {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function shiftDateKey(dateKey, days) {
  return utcToDateKey(dateKeyToUtc(dateKey) + days * DAY_MS)
}

function compareDateKeys(left, right) {
  return dateKeyToUtc(left) - dateKeyToUtc(right)
}

function monthKey(dateKey) {
  return String(dateKey).slice(0, 7)
}

function weekStart(dateKey) {
  const day = new Date(dateKeyToUtc(dateKey)).getUTCDay() || 7
  return shiftDateKey(dateKey, 1 - day)
}

function ensureWallet(data, userId) {
  if (!data.wallets[userId]) {
    data.wallets[userId] = {
      balance: 0,
      transactions: []
    }
  }

  return data.wallets[userId]
}

function addTransaction(data, userId, amount, type, description) {
  if (!amount) {
    return
  }

  const wallet = ensureWallet(data, userId)
  wallet.balance += amount
  wallet.transactions.unshift({
    id: crypto.randomUUID(),
    amount,
    type,
    description,
    createdAt: Date.now()
  })
  wallet.transactions = wallet.transactions.slice(0, 80)
}

function generateUserCode(data) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = ''
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    if (!data.codes[code]) {
      return code
    }
  }
  return crypto.randomUUID().slice(0, 8).toUpperCase()
}

function ensureUser(data, user) {
  if (!data.users[user.id]) {
    const code = generateUserCode(data)
    data.users[user.id] = {
      id: user.id,
      name: user.name,
      username: user.username || '',
      avatarUrl: user.avatarUrl || '',
      createdAt: Date.now(),
      approvedDateKey: getCurrentDateKey(),
      code,
      coupleId: null
    }
    data.codes[code] = user.id
  } else {
    data.users[user.id] = {
      ...data.users[user.id],
      name: user.name,
      username: user.username || '',
      avatarUrl: user.avatarUrl || ''
    }
  }
  ensureWallet(data, user.id)
  return data.users[user.id]
}

function coupleFor(data, userId) {
  const coupleId = data.users[userId]?.coupleId
  if (!coupleId) return null
  return data.couples[coupleId] || null
}

function partnerId(data, userId) {
  const couple = coupleFor(data, userId)
  if (!couple) return null
  return couple.userIds.find((id) => id !== userId) || null
}

function coupleMembers(data, userId) {
  const couple = coupleFor(data, userId)
  if (!couple) return []
  return couple.userIds.map((id) => data.users[id]).filter(Boolean)
}

function cleanText(value, limit = 800) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, limit)
}

function compareText(left, right) {
  const a = cleanText(left).toLowerCase()
  const b = cleanText(right).toLowerCase()

  if (!a || !b) {
    return 0
  }

  if (a === b) {
    return 100
  }

  if (a.includes(b) || b.includes(a)) {
    return 82
  }

  const aTokens = new Set(a.split(/[^a-zа-я0-9ё]+/i).filter((item) => item.length > 1))
  const bTokens = new Set(b.split(/[^a-zа-я0-9ё]+/i).filter((item) => item.length > 1))
  const union = new Set([...aTokens, ...bTokens])

  if (!union.size) {
    return 0
  }

  let common = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      common += 1
    }
  }

  return Math.round((common / union.size) * 100)
}

function dailyQuestion(dateKey) {
  let hash = 0
  for (const char of `${dateKey}-${APP_CONFIG.appName}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  const index = hash % DAILY_QUESTIONS.length
  return {
    id: `daily-${index}`,
    text: DAILY_QUESTIONS[index]
  }
}

function findQuestion(questionId) {
  for (const topic of MATCH_TOPICS) {
    const question = topic.questions.find((item) => item.id === questionId)
    if (question) {
      return { topic, question }
    }
  }

  return null
}

function weeklyProgress(data, userId, anchorDate = getCurrentDateKey()) {
  const start = weekStart(anchorDate)
  let answered = 0

  for (let offset = 0; offset < 7; offset += 1) {
    const dateKey = shiftDateKey(start, offset)
    if (data.dailyAnswers[dateKey]?.[userId]) {
      answered += 1
    }
  }

  return {
    weekKey: start,
    answered,
    total: 7,
    threshold: APP_CONFIG.weeklyGoal,
    remaining: Math.max(0, APP_CONFIG.weeklyGoal - answered)
  }
}

function applyWeeklyReward(data, userId) {
  const progress = weeklyProgress(data, userId)
  if (progress.answered < APP_CONFIG.weeklyGoal) {
    return
  }

  const wallet = ensureWallet(data, userId)
  const alreadyClaimed = wallet.transactions.some(
    (item) => item.type === 'weekly' && item.description === progress.weekKey
  )

  if (!alreadyClaimed) {
    addTransaction(data, userId, APP_CONFIG.weeklyReward, 'weekly', progress.weekKey)
  }
}

function streakInfo(data, userId) {
  const answeredDates = Object.entries(data.dailyAnswers)
    .filter(([, answers]) => answers[userId])
    .map(([dateKey]) => dateKey)
    .sort(compareDateKeys)

  if (!answeredDates.length) {
    return {
      count: 0,
      active: false,
      activeFrom: null
    }
  }

  let count = 1
  for (let index = answeredDates.length - 1; index > 0; index -= 1) {
    if (compareDateKeys(answeredDates[index], shiftDateKey(answeredDates[index - 1], 1)) === 0) {
      count += 1
      continue
    }
    break
  }

  return {
    count,
    active: count >= 3,
    activeFrom: answeredDates[answeredDates.length - count]
  }
}

function oneDailyCard(data, userId, dateKey) {
  const partner = partnerId(data, userId)
  const myAnswer = data.dailyAnswers[dateKey]?.[userId] || null
  const theirAnswer = partner ? data.dailyAnswers[dateKey]?.[partner] || null : null
  const isPast = compareDateKeys(dateKey, getCurrentDateKey()) < 0

  return {
    dateKey,
    question: dailyQuestion(dateKey),
    isPast,
    cost: isPast && !myAnswer ? APP_CONFIG.rewindCost : 0,
    myAnswer: myAnswer
      ? {
          value: myAnswer.answer,
          createdAt: myAnswer.answeredAt
        }
      : null,
    partnerAnswered: Boolean(theirAnswer),
    partnerAnswer:
      myAnswer && theirAnswer
        ? {
            value: theirAnswer.answer,
            createdAt: theirAnswer.answeredAt
          }
        : null
  }
}

function dailyFeed(data, userId) {
  const today = getCurrentDateKey()
  const approvedFrom = data.users[userId]?.approvedDateKey || today
  const cards = []

  let index = 0
  while (index < APP_CONFIG.backlogDays) {
    const dateKey = shiftDateKey(today, -index)
    cards.push(oneDailyCard(data, userId, dateKey))
    if (compareDateKeys(dateKey, approvedFrom) === 0) {
      break
    }
    index += 1
  }

  return cards
}

function matchState(data, userId) {
  const partner = partnerId(data, userId)
  const allScores = []

  const topics = MATCH_TOPICS.map((topic) => {
    const questions = topic.questions.map((question) => {
      const mine = data.matchAnswers[question.id]?.[userId] || null
      const theirs = partner ? data.matchAnswers[question.id]?.[partner] || null : null

      let similarity = null
      if (mine && theirs) {
        similarity =
          question.type === 'choice'
            ? cleanText(mine.value).toLowerCase() === cleanText(theirs.value).toLowerCase()
              ? 100
              : 0
            : compareText(mine.value, theirs.value)
        allScores.push(similarity)
      }

      return {
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        options: question.options || [],
        myAnswer: mine ? { value: mine.value, createdAt: mine.answeredAt } : null,
        partnerAnswer: mine && theirs ? { value: theirs.value, createdAt: theirs.answeredAt } : null,
        waitingForPartner: Boolean(mine && !theirs),
        similarity
      }
    })

    const completed = questions.filter((item) => item.similarity !== null)
    return {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      average: completed.length
        ? Math.round(
            completed.reduce((sum, item) => sum + Number(item.similarity || 0), 0) / completed.length
          )
        : null,
      questions
    }
  })

  return {
    overall: allScores.length
      ? Math.round(allScores.reduce((sum, item) => sum + item, 0) / allScores.length)
      : null,
    topics
  }
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))

  return label.charAt(0).toUpperCase() + label.slice(1)
}

function monthSummary(data, userId, targetMonth) {
  const partner = partnerId(data, userId)
  const myDaily = Object.entries(data.dailyAnswers).filter(
    ([dateKey, answers]) => monthKey(dateKey) === targetMonth && answers[userId]
  ).length
  const pairedDaily = Object.entries(data.dailyAnswers).filter(
    ([dateKey, answers]) => monthKey(dateKey) === targetMonth && answers[userId] && answers[partner]
  ).length

  const memories = data.memories.filter((item) => monthKey(timestampToDateKey(item.createdAt)) === targetMonth)
  const wallet = ensureWallet(data, userId)
  const walletMonth = wallet.transactions.filter(
    (item) => monthKey(timestampToDateKey(item.createdAt)) === targetMonth
  )

  const matchScores = []
  for (const topic of MATCH_TOPICS) {
    for (const question of topic.questions) {
      const mine = data.matchAnswers[question.id]?.[userId]
      const theirs = data.matchAnswers[question.id]?.[partner]
      if (!mine || !theirs) {
        continue
      }
      if (
        monthKey(timestampToDateKey(mine.answeredAt)) !== targetMonth ||
        monthKey(timestampToDateKey(theirs.answeredAt)) !== targetMonth
      ) {
        continue
      }

      matchScores.push(
        question.type === 'choice'
          ? cleanText(mine.value).toLowerCase() === cleanText(theirs.value).toLowerCase()
            ? 100
            : 0
          : compareText(mine.value, theirs.value)
      )
    }
  }

  return {
    monthKey: targetMonth,
    label: monthLabel(targetMonth),
    myDaily,
    pairedDaily,
    memories: memories.length,
    mineMemories: memories.filter((item) => item.authorId === userId).length,
    partnerMemories: memories.filter((item) => item.authorId === partner).length,
    earned: walletMonth.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
    spent: Math.abs(walletMonth.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0)),
    averageMatch: matchScores.length
      ? Math.round(matchScores.reduce((sum, item) => sum + item, 0) / matchScores.length)
      : null
  }
}

function monthState(data, userId) {
  const current = monthKey(getCurrentDateKey())
  const months = new Set([current])

  for (const dateKey of Object.keys(data.dailyAnswers)) {
    months.add(monthKey(dateKey))
  }
  for (const item of data.memories) {
    months.add(monthKey(timestampToDateKey(item.createdAt)))
  }

  return {
    currentMonthKey: current,
    summaries: [...months]
      .sort((left, right) => right.localeCompare(left))
      .slice(0, APP_CONFIG.monthLimit)
      .map((targetMonth) => monthSummary(data, userId, targetMonth))
  }
}

function memberCards(data, userId) {
  return coupleMembers(data, userId).map((member) => ({
    id: member.id,
    name: member.name,
    avatarUrl: member.avatarUrl || ''
  }))
}

export function buildState(userId) {
  const data = readData()
  applyWeeklyReward(data, userId)
  writeData(data)

  const wallet = ensureWallet(data, userId)
  const me = data.users[userId] || null
  const partner = partnerId(data, userId) ? data.users[partnerId(data, userId)] : null

  return {
    app: {
      name: APP_CONFIG.appName,
      subtitle: APP_CONFIG.subtitle,
      rewindCost: APP_CONFIG.rewindCost,
      memoryReward: APP_CONFIG.memoryReward,
      weeklyGoal: APP_CONFIG.weeklyGoal,
      weeklyReward: APP_CONFIG.weeklyReward
    },
    me,
    partner,
    pairing: {
      code: me?.code || '',
      coupled: Boolean(me?.coupleId && partner),
      coupleId: me?.coupleId || null
    },
    household: me?.coupleId
      ? {
          count: coupleMembers(data, userId).length,
          maxUsers: 2,
          members: memberCards(data, userId)
        }
      : {
          count: 1,
          maxUsers: 2,
          members: me ? [{ id: me.id, name: me.name, avatarUrl: me.avatarUrl || '' }] : []
        },
    wallet: {
      balance: wallet.balance,
      transactions: wallet.transactions.slice(0, 8)
    },
    streak: streakInfo(data, userId),
    weekly: weeklyProgress(data, userId),
    today: oneDailyCard(data, userId, getCurrentDateKey()),
    dailyFeed: dailyFeed(data, userId),
    match: matchState(data, userId),
    memories: data.memories.slice().sort((left, right) => right.createdAt - left.createdAt),
    months: monthState(data, userId),
    generatedAt: Date.now()
  }
}

export function openSession(user) {
  const data = readData()
  ensureUser(data, user)

  applyWeeklyReward(data, user.id)
  writeData(data)

  return {
    ok: true,
    state: buildState(user.id)
  }
}

export function linkPartner(userId, partnerCode) {
  const code = cleanText(partnerCode, 40).toUpperCase()
  if (!code) {
    throw new Error('Введите код партнёра.')
  }

  const data = readData()
  const me = data.users[userId]
  if (!me) {
    throw new Error('Пользователь не найден.')
  }
  if (me.coupleId) {
    throw new Error('Вы уже связаны с партнёром.')
  }

  const partnerUserId = data.codes[code]
  if (!partnerUserId) {
    throw new Error('Код не найден.')
  }
  if (partnerUserId === userId) {
    throw new Error('Нельзя указать свой код.')
  }
  const partner = data.users[partnerUserId]
  if (!partner) {
    throw new Error('Партнёр не найден.')
  }
  if (partner.coupleId) {
    throw new Error('Этот код уже связан с другим аккаунтом.')
  }

  const coupleId = crypto.randomUUID()
  data.couples[coupleId] = {
    id: coupleId,
    userIds: [userId, partnerUserId],
    createdAt: Date.now()
  }
  data.users[userId] = { ...me, coupleId }
  data.users[partnerUserId] = { ...partner, coupleId }

  writeData(data)
  return buildState(userId)
}

export function submitDailyAnswer(userId, dateKey, answer) {
  const cleanAnswerValue = cleanText(answer)
  if (!cleanAnswerValue) {
    throw new Error('Ответ не может быть пустым.')
  }

  const data = readData()
  const today = getCurrentDateKey()
  if (compareDateKeys(dateKey, today) > 0) {
    throw new Error('Нельзя отвечать на будущие вопросы.')
  }

  data.dailyAnswers[dateKey] ||= {}
  if (data.dailyAnswers[dateKey][userId]) {
    throw new Error('Вы уже отвечали на этот вопрос.')
  }

  if (compareDateKeys(dateKey, today) < 0) {
    const wallet = ensureWallet(data, userId)
    if (wallet.balance < APP_CONFIG.rewindCost) {
      throw new Error('Недостаточно искр для возврата к прошлому вопросу.')
    }

    addTransaction(data, userId, -APP_CONFIG.rewindCost, 'rewind', `Возврат к ${dateKey}`)
  }

  data.dailyAnswers[dateKey][userId] = {
    answer: cleanAnswerValue,
    answeredAt: Date.now()
  }

  // Earn sparks when both partners answered the same.
  const partner = partnerId(data, userId)
  if (partner) {
    const theirs = data.dailyAnswers[dateKey]?.[partner]
    const mine = data.dailyAnswers[dateKey]?.[userId]
    const coupleId = data.users[userId]?.coupleId
    if (theirs && mine && coupleId) {
      const rewardKey = `${coupleId}:${dateKey}`
      if (!data.rewards.daily[rewardKey]) {
        const a = cleanText(mine.answer).toLowerCase()
        const b = cleanText(theirs.answer).toLowerCase()
        if (a && b && a === b) {
          data.rewards.daily[rewardKey] = true
          addTransaction(data, userId, 8, 'match', `Совпадение дня: ${dateKey}`)
          addTransaction(data, partner, 8, 'match', `Совпадение дня: ${dateKey}`)
        }
      }
    }
  }

  applyWeeklyReward(data, userId)
  writeData(data)
  return buildState(userId)
}

export function submitMatchAnswer(userId, questionId, value) {
  const resolved = findQuestion(questionId)
  if (!resolved) {
    throw new Error('Вопрос не найден.')
  }

  const answer = cleanText(value)
  if (!answer) {
    throw new Error('Ответ не может быть пустым.')
  }

  if (resolved.question.type === 'choice' && !resolved.question.options.includes(answer)) {
    throw new Error('Недоступный вариант ответа.')
  }

  const data = readData()
  data.matchAnswers[questionId] ||= {}
  if (data.matchAnswers[questionId][userId]) {
    throw new Error('Вы уже отвечали на этот вопрос.')
  }

  data.matchAnswers[questionId][userId] = {
    value: answer,
    answeredAt: Date.now()
  }

  const partner = partnerId(data, userId)
  if (partner) {
    const theirs = data.matchAnswers[questionId]?.[partner]
    const mine = data.matchAnswers[questionId]?.[userId]
    const coupleId = data.users[userId]?.coupleId
    if (theirs && mine && coupleId) {
      const rewardKey = `${coupleId}:${questionId}`
      if (!data.rewards.match[rewardKey]) {
        const similarity =
          resolved.question.type === 'choice'
            ? cleanText(mine.value).toLowerCase() === cleanText(theirs.value).toLowerCase()
              ? 100
              : 0
            : compareText(mine.value, theirs.value)
        if (similarity === 100) {
          data.rewards.match[rewardKey] = true
          addTransaction(data, userId, 10, 'match', `Совпадение: ${resolved.topic.title}`)
          addTransaction(data, partner, 10, 'match', `Совпадение: ${resolved.topic.title}`)
        }
      }
    }
  }

  writeData(data)
  return buildState(userId)
}

export function addMemory(userId, payload) {
  const title = cleanText(payload.title, 80)
  const text = cleanText(payload.text, 1500)
  const locationName = cleanText(payload.locationName, 120)
  const imageDataUrl = String(payload.imageDataUrl || '')

  if (!title && !text) {
    throw new Error('Добавьте заголовок или текст воспоминания.')
  }

  if (imageDataUrl.length > 1_800_000) {
    throw new Error('Фото слишком большое.')
  }

  const data = readData()
  data.memories.unshift({
    id: crypto.randomUUID(),
    authorId: userId,
    authorName: data.users[userId]?.name || 'Вы',
    title,
    text,
    locationName,
    imageDataUrl,
    createdAt: Date.now()
  })
  data.memories = data.memories.slice(0, 120)

  addTransaction(data, userId, APP_CONFIG.memoryReward, 'memory', title || 'Новое воспоминание')
  writeData(data)
  return buildState(userId)
}

export function getHealth() {
  const data = readData()
  return {
    ok: true,
    appName: APP_CONFIG.appName,
    users: Object.keys(data.users || {}).length,
    timeZone: APP_CONFIG.timeZone
  }
}

export function purchase(userId, item) {
  const data = readData()
  const wallet = ensureWallet(data, userId)
  const title = cleanText(item?.title, 80)
  const price = Number(item?.price || 0)
  if (!title || !Number.isFinite(price) || price <= 0) {
    throw new Error('Некорректная покупка.')
  }
  if (wallet.balance < price) {
    throw new Error('Недостаточно искр.')
  }

  addTransaction(data, userId, -price, 'shop', title)
  data.purchases.unshift({
    id: crypto.randomUUID(),
    userId,
    coupleId: data.users[userId]?.coupleId || null,
    title,
    price,
    createdAt: Date.now()
  })
  data.purchases = data.purchases.slice(0, 200)
  writeData(data)
  return buildState(userId)
}
