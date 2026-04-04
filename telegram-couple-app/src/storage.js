import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { APP_CONFIG, DAILY_QUESTIONS, MATCH_TOPICS } from './content.js'

const dataDir = path.join(process.cwd(), 'data')
const dataFile = path.join(dataDir, 'storage.json')
const DAY_MS = 24 * 60 * 60 * 1000

function baseData() {
  return {
    access: {
      approvedUsers: {}
    },
    wallets: {},
    dailyAnswers: {},
    matchAnswers: {},
    memories: [],
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
    return {
      ...baseData(),
      ...parsed,
      access: {
        ...baseData().access,
        ...(parsed.access || {}),
        approvedUsers: parsed.access?.approvedUsers || {}
      },
      wallets: parsed.wallets || {},
      dailyAnswers: parsed.dailyAnswers || {},
      matchAnswers: parsed.matchAnswers || {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : []
    }
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

function approvedUserIds(data) {
  return Object.keys(data.access.approvedUsers)
}

function partnerId(data, userId) {
  return approvedUserIds(data).find((id) => id !== userId) || null
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
  const cards = []

  for (let index = 0; index < APP_CONFIG.backlogDays; index += 1) {
    cards.push(oneDailyCard(data, userId, shiftDateKey(today, -index)))
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

function worldPins(data) {
  return data.memories
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({
      id: item.id,
      title: item.title,
      locationName: item.locationName,
      latitude: item.latitude,
      longitude: item.longitude
    }))
}

function memberCards(data) {
  return approvedUserIds(data).map((id) => ({
    id,
    name: data.access.approvedUsers[id].name,
    avatarUrl: data.access.approvedUsers[id].avatarUrl || ''
  }))
}

export function buildState(userId) {
  const data = readData()
  applyWeeklyReward(data, userId)
  writeData(data)

  const wallet = ensureWallet(data, userId)

  return {
    app: {
      name: APP_CONFIG.appName,
      subtitle: APP_CONFIG.subtitle,
      rewindCost: APP_CONFIG.rewindCost,
      memoryReward: APP_CONFIG.memoryReward,
      weeklyGoal: APP_CONFIG.weeklyGoal,
      weeklyReward: APP_CONFIG.weeklyReward
    },
    me: data.access.approvedUsers[userId] || null,
    partner: data.access.approvedUsers[partnerId(data, userId)] || null,
    household: {
      count: approvedUserIds(data).length,
      maxUsers: APP_CONFIG.maxUsers,
      members: memberCards(data)
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
    mapPins: worldPins(data),
    months: monthState(data, userId),
    generatedAt: Date.now()
  }
}

export function openSession(user, accessCode = '') {
  const data = readData()
  const known = data.access.approvedUsers[user.id]

  if (!known) {
    if (approvedUserIds(data).length >= APP_CONFIG.maxUsers) {
      throw new Error('Это приложение уже привязано к двум пользователям.')
    }

    if (String(accessCode).trim() !== APP_CONFIG.accessCode) {
      return {
        ok: true,
        requiresCode: true
      }
    }

    data.access.approvedUsers[user.id] = {
      id: user.id,
      name: user.name,
      username: user.username || '',
      avatarUrl: user.avatarUrl || '',
      approvedAt: Date.now(),
      lastSeenAt: Date.now()
    }
    ensureWallet(data, user.id)
  } else {
    data.access.approvedUsers[user.id] = {
      ...known,
      name: user.name,
      username: user.username || '',
      avatarUrl: user.avatarUrl || '',
      lastSeenAt: Date.now()
    }
  }

  applyWeeklyReward(data, user.id)
  writeData(data)

  return {
    ok: true,
    requiresCode: false,
    state: buildState(user.id)
  }
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

  const latitude = payload.latitude === '' || payload.latitude === undefined ? null : Number(payload.latitude)
  const longitude = payload.longitude === '' || payload.longitude === undefined ? null : Number(payload.longitude)

  if ((latitude === null) !== (longitude === null)) {
    throw new Error('Чтобы поставить пин, укажите и широту, и долготу.')
  }

  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new Error('Широта должна быть от -90 до 90.')
  }

  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new Error('Долгота должна быть от -180 до 180.')
  }

  if (imageDataUrl.length > 1_800_000) {
    throw new Error('Фото слишком большое.')
  }

  const data = readData()
  data.memories.unshift({
    id: crypto.randomUUID(),
    authorId: userId,
    authorName: data.access.approvedUsers[userId]?.name || 'Вы',
    title,
    text,
    locationName,
    latitude,
    longitude,
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
    approvedUsers: approvedUserIds(data).length,
    timeZone: APP_CONFIG.timeZone
  }
}
