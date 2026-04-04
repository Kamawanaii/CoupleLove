async function telegramApiCall(botToken, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const data = await response.json()
  if (!data.ok) {
    throw new Error(data.description || `Telegram API call failed for ${method}.`)
  }

  return data.result
}

async function sendLaunchMessage(botToken, chatId, appUrl, buttonText) {
  return telegramApiCall(botToken, 'sendMessage', {
    chat_id: chatId,
    text: 'Открой ваше личное мини-приложение для двоих.',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: buttonText,
            web_app: {
              url: appUrl
            }
          }
        ]
      ]
    }
  })
}

async function configureMenuButton(botToken, appUrl, buttonText) {
  try {
    await telegramApiCall(botToken, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: buttonText,
        web_app: {
          url: appUrl
        }
      }
    })
  } catch (error) {
    console.warn('[telegram] Could not set menu button:', error.message)
  }
}

export async function startTelegramBot(config) {
  if (!config.telegramBotToken || !config.publicAppUrl || !config.enableBotPolling) {
    return
  }

  await configureMenuButton(
    config.telegramBotToken,
    config.publicAppUrl,
    config.menuButtonText
  )

  let offset = 0

  const poll = async () => {
    try {
      const updates = await telegramApiCall(config.telegramBotToken, 'getUpdates', {
        timeout: 30,
        offset
      })

      for (const update of updates) {
        offset = update.update_id + 1

        const message = update.message
        if (!message || !message.text) {
          continue
        }

        if (message.text.startsWith('/start')) {
          await sendLaunchMessage(
            config.telegramBotToken,
            message.chat.id,
            config.publicAppUrl,
            config.menuButtonText
          )
        }
      }
    } catch (error) {
      console.warn('[telegram] Polling error:', error.message)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    setTimeout(poll, 1000)
  }

  poll()
}
