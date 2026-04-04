import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from './config.js'
import { addMemory, getHealth, openSession, submitDailyAnswer, submitMatchAnswer } from './storage.js'
import { resolveUserFromAuth } from './telegram.js'
import { startTelegramBot } from './telegramBot.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.join(__dirname, '..', 'public')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
}

function serveStaticFile(requestPath, response) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath
  const safePath = path
    .normalize(normalizedPath)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '')
  const filePath = path.join(publicDir, safePath)

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  const extension = path.extname(filePath)
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  })
  fs.createReadStream(filePath).pipe(response)
}

async function parseBody(request) {
  let data = ''

  for await (const chunk of request) {
    data += chunk
    if (data.length > 5_000_000) {
      throw new Error('Слишком большой запрос.')
    }
  }

  return data ? JSON.parse(data) : {}
}

function currentUser(body) {
  return resolveUserFromAuth(body.auth, config)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        ...getHealth(),
        telegramAuthEnabled: Boolean(config.telegramBotToken),
        botUsername: config.telegramBotUsername,
        publicAppUrl: config.publicAppUrl
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/bootstrap') {
      const body = await parseBody(request)
      const result = openSession(currentUser(body), body.accessCode)
      sendJson(response, 200, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/daily-answer') {
      const body = await parseBody(request)
      const state = submitDailyAnswer(currentUser(body).id, String(body.dateKey || ''), body.answer)
      sendJson(response, 200, { ok: true, state })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/match-answer') {
      const body = await parseBody(request)
      const state = submitMatchAnswer(currentUser(body).id, String(body.questionId || ''), body.value)
      sendJson(response, 200, { ok: true, state })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/memory') {
      const body = await parseBody(request)
      const state = addMemory(currentUser(body).id, body)
      sendJson(response, 200, { ok: true, state })
      return
    }

    if (request.method === 'GET') {
      serveStaticFile(url.pathname, response)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    const message = error.message || 'Unexpected server error.'
    const statusCode = message.includes('Telegram') || message.includes('Authentication') ? 401 : 400
    sendJson(response, statusCode, { ok: false, error: message })
  }
})

server.listen(config.port, config.host, async () => {
  console.log(`Couple mini app is running at http://${config.host}:${config.port}`)
  console.log(`Public URL: ${config.publicAppUrl || 'not configured yet'}`)
  await startTelegramBot(config)
})
