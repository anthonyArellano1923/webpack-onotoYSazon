/**
 * PLAN-12 (ADR-5): webhook del bot de Telegram.
 *
 *   POST /api/telegram/webhook
 *
 * Se registra con setWebhook + secret_token (scripts/telegram-webhook.js).
 * Telegram manda ese secreto en el header X-Telegram-Bot-Api-Secret-Token en
 * cada request; sin él (o distinto) → 401. Sin TELEGRAM_BOT_TOKEN o sin
 * TELEGRAM_WEBHOOK_SECRET el bot queda inactivo y todo request recibe 401:
 * nunca se procesa un update sin poder autenticarlo.
 *
 * Se monta ANTES del apiLimiter (server.js): un 429 haría que Telegram
 * reintente el update y el dueño vería sus botones "colgados".
 */
const crypto = require('crypto');
const { Router } = require('express');
const bot = require('../services/telegramBot');

const router = Router();

/**
 * Constant-time comparison of the received secret against the configured one.
 * timingSafeEqual lanza si los largos difieren, por eso se comparan antes.
 * @param {unknown} received
 * @param {string} expected
 * @returns {boolean}
 */
function secretMatches(received, expected) {
  if (typeof received !== 'string' || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/webhook', async (req, res) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!token || !secret || !secretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'), secret)) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  // handleUpdate nunca lanza y aplica la lista blanca de chats; se responde
  // 200 siempre para que Telegram no reintente un update ya procesado.
  await bot.handleUpdate(req.body);
  return res.json({ ok: true });
});

module.exports = router;
module.exports.secretMatches = secretMatches;
