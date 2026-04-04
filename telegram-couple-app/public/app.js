const app = document.querySelector('#app')

const state = {
  telegram: window.Telegram?.WebApp || null,
  auth: null,
  health: null,
  data: null,
  error: '',
  requiresCode: false,
  accessCode: '',
  devName: localStorage.getItem('couple-dev-name') || '',
  activeTab: 'today',
  activeTopicId: 'feelings',
  memoryImageDataUrl: '',
  memoryImageName: '',
  refreshTimer: null
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  if (!year || !month || !day) {
    return dateKey
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function telegramAuth() {
  if (!state.telegram?.initData) {
    return null
  }

  return {
    mode: 'telegram',
    initData: state.telegram.initData
  }
}

function devAuth(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) {
    throw new Error('Введите имя для локального режима.')
  }

  let id = sessionStorage.getItem('couple-dev-id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('couple-dev-id', id)
  }

  localStorage.setItem('couple-dev-name', trimmed)

  return {
    mode: 'dev',
    profile: {
      id,
      name: trimmed
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Ошибка запроса.')
  }
  return data
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

async function bootstrap(accessCode = '') {
  if (!state.auth) {
    return
  }

  const data = await postJson('/api/bootstrap', {
    auth: state.auth,
    accessCode
  })

  state.requiresCode = Boolean(data.requiresCode)
  state.data = data.state || null
  state.error = ''

  if (state.data?.match?.topics?.length) {
    const valid = state.data.match.topics.find((topic) => topic.id === state.activeTopicId)
    state.activeTopicId = valid ? valid.id : state.data.match.topics[0].id
  }
}

async function refresh() {
  if (!state.auth || state.requiresCode) {
    return
  }

  try {
    await bootstrap()
    render()
  } catch (error) {
    state.error = error.message || 'Не удалось обновить данные.'
    render()
  }
}

function startRefreshLoop() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer)
  }

  state.refreshTimer = window.setInterval(refresh, 30000)
}

function renderError() {
  return state.error ? `<div class="toast">${escapeHtml(state.error)}</div>` : ''
}

function weeklyText() {
  const weekly = state.data?.weekly
  if (!weekly) {
    return ''
  }

  if (weekly.answered >= weekly.threshold) {
    return `Неделя закрыта: ${weekly.answered}/7 ответов, бонус уже начислен или готов.`
  }

  return `Сейчас ${weekly.answered}/7 ответов. Ещё ${weekly.remaining} до недельного бонуса.`
}

function renderAuth() {
  const inTelegram = Boolean(telegramAuth())

  app.innerHTML = `
    <main class="shell">
      <section class="hero-grid">
        <section class="card hero-card">
          <div class="eyebrow">Private Mini App</div>
          <h1>291224</h1>
          <p class="lede">Пространство только для двоих: ежедневные вопросы, совпадения, общая карта воспоминаний и месячные итоги.</p>
          <div class="hero-pills">
            <span class="pill">${inTelegram ? 'Telegram готов' : 'Локальный режим'}</span>
            <span class="pill">${state.health?.approvedUsers || 0}/2 участников</span>
            <span class="pill">${state.health?.timeZone || 'Europe/Moscow'}</span>
          </div>
        </section>
        <section class="card">
          ${
            inTelegram
              ? `
                <div class="eyebrow">Вход</div>
                <h2>Открыть приложение</h2>
                <p class="lede">Если этот профиль уже подтверждён, код больше не нужен. Если нет, приложение попросит его один раз.</p>
                <button class="button button-primary" data-action="telegram-enter">Продолжить через Telegram</button>
              `
              : `
                <div class="eyebrow">Dev Mode</div>
                <h2>Локальный вход</h2>
                <form id="dev-form" class="stack-form">
                  <label class="field">
                    <span>Имя</span>
                    <input id="devName" name="devName" maxlength="40" value="${escapeHtml(state.devName)}" placeholder="Например, Алина" />
                  </label>
                  <button class="button button-primary" type="submit">Войти</button>
                </form>
              `
          }
        </section>
      </section>
      ${renderError()}
    </main>
  `
}

function renderCodeGate() {
  app.innerHTML = `
    <main class="shell">
      <section class="hero-grid">
        <section class="card hero-card">
          <div class="eyebrow">Доступ</div>
          <h1>Только для вас двоих</h1>
          <p class="lede">Код 291224 вводится один раз для Telegram-профиля. После подтверждения вход больше его не требует. После двух привязок другие пользователи не смогут войти.</p>
        </section>
        <section class="card">
          <div class="eyebrow">Введите код</div>
          <h2>Подтвердить профиль</h2>
          <form id="access-form" class="stack-form">
            <label class="field">
              <span>Код доступа</span>
              <input id="accessCode" name="accessCode" maxlength="12" value="${escapeHtml(state.accessCode)}" placeholder="291224" />
            </label>
            <button class="button button-primary" type="submit">Открыть приложение</button>
          </form>
        </section>
      </section>
      ${renderError()}
    </main>
  `
}

function renderHeader() {
  const streak = state.data?.streak

  return `
    <section class="topbar">
      <section class="card hero-card">
        <div class="eyebrow">Для двоих</div>
        <h1>291224</h1>
        <p class="lede">Каждые 24 часа здесь появляется новый случайный вопрос про ваши отношения. Пропущенные дни можно открывать за искры, а память о ваших местах и историях складывается в общую карту.</p>
        <div class="hero-pills">
          <span class="pill">Искры: ${state.data?.wallet?.balance ?? 0}</span>
          <span class="pill">${streak?.active ? `Огонёк: ${streak.count}` : 'Огонёк с 3 ответов подряд'}</span>
          <span class="pill">${escapeHtml(weeklyText())}</span>
        </div>
      </section>
      <section class="card compact-card">
        <div class="eyebrow">Участники</div>
        <div class="member-list">
          ${(state.data?.household?.members || [])
            .map(
              (member) => `
                <div class="member-chip">
                  <strong>${escapeHtml(member.name)}</strong>
                  <span>${member.id === state.data?.me?.id ? 'Вы' : 'Партнёр'}</span>
                </div>
              `
            )
            .join('')}
        </div>
      </section>
    </section>
  `
}

function renderTabs() {
  const tabs = [
    ['today', 'Сегодня'],
    ['match', 'Совпадения'],
    ['memories', 'Воспоминания'],
    ['month', 'Месяц']
  ]

  return `
    <nav class="tab-row">
      ${tabs
        .map(
          ([id, label]) => `
            <button class="tab-button ${state.activeTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>
          `
        )
        .join('')}
    </nav>
  `
}

function dailyCard(card, featured = false) {
  return `
    <article class="card question-card ${featured ? 'featured-card' : ''}">
      <div class="card-head">
        <div>
          <div class="eyebrow">${featured ? 'Вопрос дня' : 'Архив'}</div>
          <h3>${escapeHtml(formatDate(card.dateKey))}</h3>
        </div>
        <div class="badge-row">
          ${card.isPast ? '<span class="badge badge-soft">Прошлый день</span>' : '<span class="badge badge-accent">Сегодня</span>'}
          ${card.cost ? `<span class="badge badge-coin">-${card.cost} искр</span>` : ''}
        </div>
      </div>
      <p class="question-copy">${escapeHtml(card.question.text)}</p>
      ${
        card.myAnswer
          ? `
            <div class="answer-block">
              <span class="label">Ваш ответ</span>
              <p>${escapeHtml(card.myAnswer.value)}</p>
            </div>
            ${
              card.partnerAnswer
                ? `
                  <div class="answer-block partner-answer">
                    <span class="label">Ответ партнёра</span>
                    <p>${escapeHtml(card.partnerAnswer.value)}</p>
                  </div>
                `
                : '<div class="waiting-box">Ответ партнёра откроется, когда вы оба ответите.</div>'
            }
          `
          : `
            <form class="stack-form" data-form="daily" data-date-key="${card.dateKey}">
              <label class="field">
                <span>${card.cost ? `Ответить за ${card.cost} искр` : 'Ваш ответ'}</span>
                <textarea name="answer" rows="4" maxlength="800" placeholder="Напишите свой ответ"></textarea>
              </label>
              <button class="button button-primary" type="submit">${card.cost ? 'Открыть прошлый вопрос' : 'Сохранить ответ'}</button>
            </form>
          `
      }
    </article>
  `
}

function renderWallet() {
  const transactions = state.data?.wallet?.transactions || []

  return `
    <section class="card">
      <div class="eyebrow">Искры</div>
      <h2>Баланс</h2>
      <div class="wallet-total">${state.data?.wallet?.balance ?? 0}</div>
      <div class="wallet-list">
        ${
          transactions.length
            ? transactions
                .map(
                  (item) => `
                    <div class="wallet-row">
                      <div>
                        <strong>${escapeHtml(item.description)}</strong>
                        <span>${escapeHtml(formatDateTime(item.createdAt))}</span>
                      </div>
                      <strong class="wallet-amount ${item.amount < 0 ? 'minus' : 'plus'}">${item.amount > 0 ? '+' : ''}${item.amount}</strong>
                    </div>
                  `
                )
                .join('')
            : '<div class="empty">Операции появятся после ответов и записей в блоге.</div>'
        }
      </div>
    </section>
  `
}

function renderToday() {
  const today = state.data?.today
  const archive = (state.data?.dailyFeed || []).filter((item) => item.dateKey !== today?.dateKey)

  return `
    <section class="content-grid">
      <div class="main-stack">
        ${today ? dailyCard(today, true) : ''}
        <section class="card">
          <div class="card-head">
            <div>
              <div class="eyebrow">Архив</div>
              <h2>Прошлые вопросы</h2>
            </div>
            <span class="badge badge-soft">Возврат за искры</span>
          </div>
          <div class="archive-list">
            ${archive.map((item) => dailyCard(item)).join('')}
          </div>
        </section>
      </div>
      <div class="side-stack">
        <section class="card">
          <div class="eyebrow">Неделя</div>
          <h2>Прогресс</h2>
          <p class="lede">${escapeHtml(weeklyText())}</p>
          <div class="progress-line"><div class="progress-fill" style="width:${Math.min(100, ((state.data?.weekly?.answered || 0) / 7) * 100)}%"></div></div>
        </section>
        <section class="card">
          <div class="eyebrow">Огонёк</div>
          <h2>Стрик</h2>
          <div class="streak-number">${state.data?.streak?.count || 0}</div>
          <p class="lede">${state.data?.streak?.active ? `Активен с ${escapeHtml(formatDate(state.data?.streak?.activeFrom))}.` : 'Появится, когда будет 3 ответа подряд без пропуска.'}</p>
        </section>
        ${renderWallet()}
      </div>
    </section>
  `
}

function renderMatchQuestion(question) {
  const form = question.type === 'choice'
    ? `
        <form class="stack-form" data-form="match" data-question-id="${question.id}">
          <div class="choice-list">
            ${question.options
              .map(
                (option, index) => `
                  <label class="choice-item">
                    <span>${escapeHtml(option)}</span>
                    <input type="radio" name="value" value="${escapeHtml(option)}" ${index === 0 ? 'checked' : ''} />
                  </label>
                `
              )
              .join('')}
          </div>
          <button class="button button-primary" type="submit">Сохранить</button>
        </form>
      `
    : `
        <form class="stack-form" data-form="match" data-question-id="${question.id}">
          <label class="field">
            <span>Ваш ответ</span>
            <textarea name="value" rows="4" maxlength="800" placeholder="Напишите свой ответ"></textarea>
          </label>
          <button class="button button-primary" type="submit">Сохранить</button>
        </form>
      `

  return `
    <article class="card match-card">
      <div class="card-head">
        <h3>${escapeHtml(question.prompt)}</h3>
        ${
          question.similarity !== null
            ? `<span class="badge badge-accent">${question.similarity}%</span>`
            : question.waitingForPartner
              ? '<span class="badge badge-soft">Ждём партнёра</span>'
              : ''
        }
      </div>
      ${
        question.myAnswer
          ? `
            <div class="answer-block">
              <span class="label">Ваш ответ</span>
              <p>${escapeHtml(question.myAnswer.value)}</p>
            </div>
            ${
              question.partnerAnswer
                ? `
                  <div class="answer-block partner-answer">
                    <span class="label">Ответ партнёра</span>
                    <p>${escapeHtml(question.partnerAnswer.value)}</p>
                  </div>
                `
                : '<div class="waiting-box">Ответ партнёра появится после его ответа.</div>'
            }
          `
          : form
      }
    </article>
  `
}

function renderMatch() {
  const topics = state.data?.match?.topics || []
  const topic = topics.find((item) => item.id === state.activeTopicId) || topics[0]

  return `
    <section class="content-grid">
      <div class="main-stack">
        <section class="card hero-card">
          <div class="eyebrow">Совпадения</div>
          <h2>${state.data?.match?.overall === null ? 'Общий процент появится после первых парных ответов' : `${state.data.match.overall}% общего совпадения`}</h2>
          <p class="lede">Как только вы оба отвечаете на вопрос, приложение открывает ответ партнёра и считает процент совпадения.</p>
          <div class="topic-tabs">
            ${topics
              .map(
                (item) => `
                  <button class="topic-pill ${item.id === topic?.id ? 'active' : ''}" data-topic="${item.id}">
                    ${escapeHtml(item.title)}${item.average === null ? '' : ` ${item.average}%`}
                  </button>
                `
              )
              .join('')}
          </div>
        </section>
        ${topic ? topic.questions.map((question) => renderMatchQuestion(question)).join('') : '<section class="card"><div class="empty">Темы пока не найдены.</div></section>'}
      </div>
      <div class="side-stack">
        <section class="card">
          <div class="eyebrow">Правила</div>
          <h2>Как считается процент</h2>
          <ul class="plain-list">
            <li>В тестовых вопросах совпадение считается по одинаковому варианту.</li>
            <li>В текстовых ответах сравниваются близкие формулировки и общие слова.</li>
            <li>Общий процент строится только по вопросам, на которые ответили оба.</li>
          </ul>
        </section>
      </div>
    </section>
  `
}

function pinPoint(longitude, latitude) {
  return {
    x: ((longitude + 180) / 360) * 1000,
    y: ((90 - latitude) / 180) * 500
  }
}

function mapSvg() {
  const pins = state.data?.mapPins || []

  return `
    <svg class="world-map" viewBox="0 0 1000 500" aria-label="Карта мира">
      <rect width="1000" height="500" rx="32" fill="#17324a"></rect>
      <g fill="#8ac4a3" opacity="0.85">
        <path d="M108 146c57-38 142-45 196-15 39 22 79 17 103 40 22 22 16 67-21 90-30 18-34 40-69 53-56 21-137 15-190-16-58-34-78-112-19-152z"></path>
        <path d="M355 249c32-15 78-18 114 5 24 15 39 42 60 61 27 22 71 30 74 59 2 31-43 41-84 40-58-2-105-19-129-58-20-31-50-76-35-107z"></path>
        <path d="M554 118c57-35 136-39 202-15 39 15 88 8 112 45 18 26-6 62-39 81-37 21-55 47-91 59-73 24-176 11-223-34-31-30-15-107 39-136z"></path>
        <path d="M734 298c28-10 58-10 84 4 26 13 41 36 59 57 22 22 58 34 58 58 0 28-40 43-81 43-61 0-109-18-127-56-17-33-27-90 7-106z"></path>
      </g>
      ${pins
        .map((pin) => {
          const point = pinPoint(pin.longitude, pin.latitude)
          return `<circle cx="${point.x}" cy="${point.y}" r="10" fill="#ffb17a"><title>${escapeHtml(pin.title || pin.locationName || 'Точка')}</title></circle>`
        })
        .join('')}
    </svg>
  `
}

function renderMemories() {
  const memories = state.data?.memories || []

  return `
    <section class="content-grid">
      <div class="main-stack">
        <section class="card hero-card">
          <div class="eyebrow">Карта воспоминаний</div>
          <h2>Ваши места и истории</h2>
          <p class="lede">Можно добавлять фото, блоговые заметки и координаты, чтобы на карте мира появились ваши пины.</p>
          ${mapSvg()}
        </section>
        <section class="card">
          <div class="eyebrow">Новая запись</div>
          <h2>Фото, место или блог</h2>
          <form id="memory-form" class="stack-form">
            <label class="field">
              <span>Заголовок</span>
              <input name="title" maxlength="80" placeholder="Например, Наш вечер в Праге" />
            </label>
            <label class="field">
              <span>Текст</span>
              <textarea name="text" rows="5" maxlength="1500" placeholder="Что вы хотите сохранить об этом моменте"></textarea>
            </label>
            <label class="field">
              <span>Локация</span>
              <input name="locationName" maxlength="120" placeholder="Город или название места" />
            </label>
            <div class="split-grid">
              <label class="field">
                <span>Широта</span>
                <input name="latitude" placeholder="55.7558" />
              </label>
              <label class="field">
                <span>Долгота</span>
                <input name="longitude" placeholder="37.6173" />
              </label>
            </div>
            <label class="field">
              <span>Фото</span>
              <input id="memoryImage" type="file" accept="image/*" />
            </label>
            ${state.memoryImageName ? `<div class="mini-note">Выбрано: ${escapeHtml(state.memoryImageName)}</div>` : ''}
            <button class="button button-primary" type="submit">Сохранить и получить искры</button>
          </form>
        </section>
        <section class="memory-feed">
          ${
            memories.length
              ? memories
                  .map(
                    (item) => `
                      <article class="card memory-card">
                        ${item.imageDataUrl ? `<img class="memory-image" src="${item.imageDataUrl}" alt="${escapeHtml(item.title || 'Воспоминание')}" />` : ''}
                        <div class="card-head">
                          <div>
                            <div class="eyebrow">${escapeHtml(item.authorName)}</div>
                            <h3>${escapeHtml(item.title || 'Без названия')}</h3>
                          </div>
                          <span class="badge badge-soft">${escapeHtml(formatDateTime(item.createdAt))}</span>
                        </div>
                        ${item.locationName ? `<div class="place-tag">${escapeHtml(item.locationName)}</div>` : ''}
                        ${item.text ? `<p>${escapeHtml(item.text)}</p>` : ''}
                      </article>
                    `
                  )
                  .join('')
              : '<div class="card"><div class="empty">Здесь появятся ваши записи, фото и точки на карте.</div></div>'
          }
        </section>
      </div>
      <div class="side-stack">
        <section class="card">
          <div class="eyebrow">Зачем это</div>
          <h2>Механика валюты</h2>
          <ul class="plain-list">
            <li>Каждая новая запись в воспоминаниях даёт валюту.</li>
            <li>Эту валюту можно тратить на пропущенные вопросы прошлых дней.</li>
            <li>Если координаты не нужны, можно оставить запись просто как блог.</li>
          </ul>
        </section>
        ${renderWallet()}
      </div>
    </section>
  `
}

function monthCard(item, current = false) {
  return `
    <article class="card month-card">
      <div class="card-head">
        <div>
          <div class="eyebrow">${current ? 'Текущий месяц' : 'Итоги'}</div>
          <h3>${escapeHtml(item.label)}</h3>
        </div>
        ${item.averageMatch === null ? '' : `<span class="badge badge-accent">${item.averageMatch}% match</span>`}
      </div>
      <div class="stat-grid">
        <div><span>Ваши daily</span><strong>${item.myDaily}</strong></div>
        <div><span>Ответили оба</span><strong>${item.pairedDaily}</strong></div>
        <div><span>Воспоминания</span><strong>${item.memories}</strong></div>
        <div><span>Заработано искр</span><strong>${item.earned}</strong></div>
      </div>
      <div class="month-meta">
        <span>Ваших постов: ${item.mineMemories}</span>
        <span>Постов партнёра: ${item.partnerMemories}</span>
        <span>Потрачено: ${item.spent}</span>
      </div>
    </article>
  `
}

function renderMonth() {
  const summaries = state.data?.months?.summaries || []
  const currentKey = state.data?.months?.currentMonthKey
  const current = summaries.find((item) => item.monthKey === currentKey)
  const archive = summaries.filter((item) => item.monthKey !== currentKey)

  return `
    <section class="content-grid">
      <div class="main-stack">
        ${current ? monthCard(current, true) : '<section class="card"><div class="empty">Статистика месяца появится после первых действий.</div></section>'}
        <section class="card">
          <div class="eyebrow">Архив месяцев</div>
          <h2>Прошлые итоги</h2>
          <div class="month-feed">
            ${archive.length ? archive.map((item) => monthCard(item)).join('') : '<div class="empty">Когда накопятся данные, здесь появятся прошлые месяцы.</div>'}
          </div>
        </section>
      </div>
      <div class="side-stack">
        <section class="card">
          <div class="eyebrow">Сводка</div>
          <h2>Что входит в итоги</h2>
          <ul class="plain-list">
            <li>Сколько daily-вопросов вы закрыли за месяц.</li>
            <li>Сколько было дней, где ответили оба.</li>
            <li>Сколько записей памяти было добавлено.</li>
            <li>Сколько искр заработано и потрачено.</li>
            <li>Средний процент совпадений по тематическим вопросам.</li>
          </ul>
        </section>
      </div>
    </section>
  `
}

function renderApp() {
  let content = ''

  if (state.activeTab === 'today') content = renderToday()
  if (state.activeTab === 'match') content = renderMatch()
  if (state.activeTab === 'memories') content = renderMemories()
  if (state.activeTab === 'month') content = renderMonth()

  app.innerHTML = `
    <main class="shell">
      ${renderHeader()}
      ${renderTabs()}
      ${content}
      ${renderError()}
    </main>
  `
}

function render() {
  if (!state.auth) {
    renderAuth()
    return
  }

  if (state.requiresCode) {
    renderCodeGate()
    return
  }

  if (!state.data) {
    renderAuth()
    return
  }

  renderApp()
}

async function compressImage(file) {
  if (!file) {
    return { dataUrl: '', name: '' }
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'))
    reader.readAsDataURL(file)
  })

  const image = await new Promise((resolve, reject) => {
    const preview = new Image()
    preview.onload = () => resolve(preview)
    preview.onerror = () => reject(new Error('Не удалось обработать изображение.'))
    preview.src = dataUrl
  })

  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    name: file.name
  }
}

document.addEventListener('submit', async (event) => {
  try {
    if (event.target.id === 'dev-form') {
      event.preventDefault()
      const name = String(new FormData(event.target).get('devName') || '')
      state.devName = name
      state.auth = devAuth(name)
      await bootstrap()
      startRefreshLoop()
      render()
      return
    }

    if (event.target.id === 'access-form') {
      event.preventDefault()
      const accessCode = String(new FormData(event.target).get('accessCode') || '')
      state.accessCode = accessCode
      await bootstrap(accessCode)
      startRefreshLoop()
      render()
      return
    }

    if (event.target.dataset.form === 'daily') {
      event.preventDefault()
      const result = await postJson('/api/daily-answer', {
        auth: state.auth,
        dateKey: event.target.dataset.dateKey,
        answer: String(new FormData(event.target).get('answer') || '')
      })
      state.data = result.state
      state.error = ''
      render()
      return
    }

    if (event.target.dataset.form === 'match') {
      event.preventDefault()
      const result = await postJson('/api/match-answer', {
        auth: state.auth,
        questionId: event.target.dataset.questionId,
        value: String(new FormData(event.target).get('value') || '')
      })
      state.data = result.state
      state.error = ''
      render()
      return
    }

    if (event.target.id === 'memory-form') {
      event.preventDefault()
      const formData = new FormData(event.target)
      const result = await postJson('/api/memory', {
        auth: state.auth,
        title: formData.get('title'),
        text: formData.get('text'),
        locationName: formData.get('locationName'),
        latitude: formData.get('latitude'),
        longitude: formData.get('longitude'),
        imageDataUrl: state.memoryImageDataUrl
      })

      state.data = result.state
      state.memoryImageDataUrl = ''
      state.memoryImageName = ''
      event.target.reset()
      state.error = ''
      render()
    }
  } catch (error) {
    state.error = error.message || 'Не удалось сохранить данные.'
    render()
  }
})

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-tab]')
  if (tab) {
    state.activeTab = tab.dataset.tab
    render()
    return
  }

  const topic = event.target.closest('[data-topic]')
  if (topic) {
    state.activeTopicId = topic.dataset.topic
    render()
    return
  }

  const action = event.target.closest('[data-action]')
  if (!action) {
    return
  }

  try {
    if (action.dataset.action === 'telegram-enter') {
      state.auth = telegramAuth()
      await bootstrap()
      startRefreshLoop()
      render()
    }
  } catch (error) {
    state.error = error.message || 'Не удалось войти.'
    render()
  }
})

document.addEventListener('input', (event) => {
  if (event.target.id === 'devName') {
    state.devName = event.target.value.slice(0, 40)
  }
  if (event.target.id === 'accessCode') {
    state.accessCode = event.target.value.slice(0, 12)
  }
})

document.addEventListener('change', async (event) => {
  if (event.target.id === 'memoryImage') {
    try {
      const prepared = await compressImage(event.target.files?.[0])
      state.memoryImageDataUrl = prepared.dataUrl
      state.memoryImageName = prepared.name
      render()
    } catch (error) {
      state.error = error.message || 'Не удалось подготовить фото.'
      render()
    }
  }
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refresh()
  }
})

async function init() {
  if (state.telegram) {
    state.telegram.ready()
    state.telegram.expand()
  }

  state.health = await fetchJson('/api/health')

  const tgAuth = telegramAuth()
  if (tgAuth) {
    state.auth = tgAuth
    try {
      await bootstrap()
      startRefreshLoop()
    } catch (error) {
      state.error = error.message || 'Не удалось открыть mini app.'
    }
  }

  render()
}

init().catch((error) => {
  state.error = error.message || 'Приложение не загрузилось.'
  render()
})
