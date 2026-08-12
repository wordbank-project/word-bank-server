import express, { type Request, type Response } from "express";
import cors from "cors";

import { upsertWord, getWords, sanitizeWord, sanitizeText } from "./word/words.js";
import { getSuggestionPair } from "./suggestion/suggestions.js";
import { analyzeSentence } from "./ai/analyze.js";

import { sendErrorResponse } from "./utils/http-error.js";

import { createRequestLogger, logListening } from "./middleware/request-logger.js";
import { analyzeRateLimiter, wordsRateLimiter } from "./middleware/rate-limit.js";
import { parseAllowedOrigins } from "./middleware/cors.js";

const app = express();

// Trust exactly one reverse-proxy hop (Cloudflare Tunnel / Caddy) so req.ip
// reflects the real caller, not 127.0.0.1. Deliberately `1`, not the default `true` —
// trusting an unlimited chain would let a client fake its own IP.
app.set("trust proxy", 1);

// We limit it to 10kb because currently the only POST endpoints are /v1/words and /v1/analyze,
// This is to prevent large body requests being sent to the server
app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: parseAllowedOrigins(process.env.ALLOWED_ORIGIN) }));

const requestedPort = Number(process.env.PORT);
const selectedPort = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 4000;
const apiUrl = process.env.API_URL ?? `http://localhost:${selectedPort}/v1`;

// Bare host+port, deliberately without the `/v1` in `apiUrl` above — morgan's
// `tokens.url()` already returns the full request path (e.g. `/v1/words`), so
// prefixing it with a base that also has `/v1` would double it up in every
// logged line.
const serverOrigin = `http://localhost:${selectedPort}`;

app.use(createRequestLogger(serverOrigin));

/**
 * A simple health check endpoint to verify that the server REST API is running and reachable.
 *
 * @param {Request} _req The incoming request;.
 * @param {Response} res The response used to send the result.
 * @returns {void} Returns nothing; sends `{ success: true }` to test that the server is running.
 * @example GET http://localhost:4000/v1
 * 
 */
app.get("/v1", (_req: Request, res: Response) => {
  res.status(200).json({ success: true, title: "Word Bank Server REST API" });
});

/**
 * Validates and saves a submitted word, along with any optional dictionary
 * metadata, incrementing its count if it was already saved.
 *
 * Rate limited (see middleware/rate-limit.ts) — the limiter runs before this
 * handler, so an over-limit request never even reaches the validation below.
 *
 * @param {Request} req The incoming request; body is `{ word, definition?, partOfSpeech?, phonetic? }`.
 * @param {Response} res The response used to send the result.
 * @returns {void} Returns nothing; sends `{ success: true }`, a `400`, a `429`, or a `500`
 * (an unexpected error is caught below and sent via sendErrorResponse.
 * @example POST http://localhost:4000/v1/words
 *
 */
app.post("/v1/words", wordsRateLimiter, (req: Request, res: Response) => {
  try {
    const enteredWord = sanitizeWord(req.body?.word);
    if (enteredWord === null) {
      res.status(400).json({ success: false, error: "Invalid word added" });
      return;
    }

    // Optional public dictionary metadata — stored so the marketing site's
    // WordWall glossary can show each saved word with its definition.
    upsertWord(enteredWord, {
      definition: sanitizeText(req.body?.definition, 600),
      partOfSpeech: sanitizeText(req.body?.partOfSpeech, 40),
      phonetic: sanitizeText(req.body?.phonetic, 120),
    });
    res.status(200).json({ success: true });
  } catch (err: unknown) {
    sendErrorResponse(err, res);
  }
});

/**
 * Returns the recent or most-saved words, for the marketing site's
 * floating-words animation.
 *
 * @param {Request} req The incoming request; `limit` and `order` query params control paging/sort.
 * @param {Response} res The response used to send the word list as JSON.
 * @returns {void} Returns nothing; sends the JSON array.
 * @example GET http://localhost:4000/v1/words
 * 
 */
app.get("/v1/words", (req: Request, res: Response) => {
  let amountOfWords = Number(req.query.limit ?? 100);
  if (!Number.isFinite(amountOfWords)) {
    amountOfWords = 100;
  }

  amountOfWords = Math.max(1, Math.min(500, Math.floor(amountOfWords)));
  const sortOrder = req.query.order === "top" ? "top" : "recent";
  res.status(200).json(getWords(amountOfWords, sortOrder));
});

/**
 * Returns AI-generated word/book/sentence suggestions for the app's typewriter
 * placeholders (see suggestions.ts). Without `GROQ_API_KEY` returns empty
 * arrays so the app falls back to its built-in lists. Any other failure (a
 * Groq-side rate limit, an unexpected error) is caught below and sent via
 * sendErrorResponse.
 * Default is English (`lang=en`), but any ISO 639 language code is accepted (e.g. `lang=nl`).
 *
 * @param {Request} req The incoming request; `lang` query param selects the language.
 * @param {Response} res The response used to send the suggestion pair.
 * @returns {Promise<void>} Returns nothing; sends the JSON suggestion pair, a `400`, a `429`, or a `500`.
 * @example GET http://localhost:4000/v1/suggestions?lang=nl
 *
 */
app.get("/v1/suggestions", async (req: Request, res: Response) => {
  const chosenLanguage = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : "en";
  if (!/^[a-z]{2,3}$/.test(chosenLanguage)) {
    res.status(400).json({ success: false, error: "Invalid language" });
    return;
  }

  try {
    res.status(200).json(await getSuggestionPair(chosenLanguage));
  } catch (err: unknown) {
    sendErrorResponse(err, res);
  }
});

/**
 * Explains what a submitted sentence means, in plain language (see analyze.ts).
 * Without `GROQ_API_KEY` returns `{ meaning: null }`. Any other failure (a Groq-side rate
 * limit, an unexpected error) is caught below and sent via sendErrorResponse.
 * Rate limited (see middleware/rate-limit.ts) — the limiter runs before this handler,
 * so an over-limit request never even reaches the validation below.
 *
 * @param {Request} req The incoming request; `lang` query param selects the language, body is `{ text }`.
 * @param {Response} res The response used to send the result.
 * @returns {Promise<void>} Returns nothing; sends the JSON explanation, a `400`, a `429`, or a `500`.
 * @example POST http://localhost:4000/v1/analyze?lang=nl
 *
 */
app.post("/v1/analyze", analyzeRateLimiter, async (req: Request, res: Response) => {
  const chosenLanguage = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : "en";
  if (!/^[a-z]{2,3}$/.test(chosenLanguage)) {
    res.status(400).json({ success: false, error: "Invalid lang parameter given" });
    return;
  }

  const enteredSentence = sanitizeText(req.body?.text, 300);
  if (enteredSentence === null) {
    res.status(400).json({ success: false, error: "Invalid text entered" });
    return;
  }

  try {
    res.json({ meaning: await analyzeSentence(enteredSentence, chosenLanguage) });
  } catch (err: unknown) {
    sendErrorResponse(err, res);
  }
});

app.listen(selectedPort, () => {
  logListening(apiUrl);
});
