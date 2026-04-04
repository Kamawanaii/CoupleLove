import crypto from 'node:crypto'

const MAX_INIT_DATA_AGE_SECONDS = 60 * 60 * 24

function buildDataCheckString(searchParams) {
  return [...searchParams.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function parseTelegramInitData(initData) {
  const params = new URLSearchParams(initData)
  const userJson = params.get('user')
  const user = userJson ? JSON.parse(userJson) : null
  const authDate = Number(params.get('auth_date') || 0)

  return {
    user,
    authDate,
    hash: params.get('hash') || '',
    startParam: params.get('start_param') || '',
    queryId: params.get('query_id') || ''
  }
}

export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return {
      ok: false,
      reason: 'Missing Telegram initData or bot token.'
    }
  }

  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash')
  if (!receivedHash) {
    return {
      ok: false,
      reason: 'Telegram initData does not contain hash.'
    }
  }

  const authDate = Number(params.get('auth_date') || 0)
  const now = Math.floor(Date.now() / 1000)
  if (!authDate || now - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    return {
      ok: false,
      reason: 'Telegram initData is too old.'
    }
  }

  const dataCheckString = buildDataCheckString(params)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest()

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  if (calculatedHash.length !== receivedHash.length) {
    return {
      ok: false,
      reason: 'Telegram initData hash mismatch.'
    }
  }

  return {
    ok: crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(receivedHash, 'hex')
    ),
    reason: 'Telegram initData hash mismatch.'
  }
}

function normalizeName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
}

export function resolveUserFromAuth(auth, config) {
  if (!auth || typeof auth !== 'object') {
    throw new Error('Authentication payload is required.')
  }

  if (auth.mode === 'telegram') {
    if (!config.telegramBotToken) {
      throw new Error('Server is missing TELEGRAM_BOT_TOKEN. Telegram auth cannot be validated yet.')
    }

    const validation = validateTelegramInitData(auth.initData, config.telegramBotToken)
    if (!validation.ok) {
      throw new Error(validation.reason)
    }

    const telegramData = parseTelegramInitData(auth.initData)
    if (!telegramData.user) {
      throw new Error('Telegram did not provide user information.')
    }

    return {
      id: `tg_${telegramData.user.id}`,
      telegramId: telegramData.user.id,
      username: telegramData.user.username || '',
      name: normalizeName(telegramData.user) || `User ${telegramData.user.id}`,
      avatarUrl: telegramData.user.photo_url || '',
      provider: 'telegram'
    }
  }

  if (auth.mode === 'dev') {
    const name = String(auth.profile?.name || '').trim()
    const id = String(auth.profile?.id || '').trim()
    if (!name || !id) {
      throw new Error('Dev profile must contain a name and a stable id.')
    }

    return {
      id: `dev_${id}`,
      telegramId: null,
      username: '',
      name: name.slice(0, 40),
      avatarUrl: '',
      provider: 'dev'
    }
  }

  throw new Error('Unsupported authentication mode.')
}
