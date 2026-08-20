# Word Bank Server

A tiny Express + TypeScript + Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)
service that collects individual words added by users in the Word Bank app and serves an
aggregated list back to the marketing site's floating-words background animation and word wall.
It also hosts two Groq-backed (Cerebras fallback) AI endpoints: `/v1/suggestions` (typewriter placeholder words/books and example sentences)
and `/v1/analyze` (plain-language sentence explanation).

It stores nothing but the bare word, a frequency count, and optional public dictionary
metadata (definition, part of speech, phonetic) — no user id, no book id, no private notes.

## Features

- **Word collection** — `POST /v1/words` saves a word (incrementing its count if already
  seen); `GET /v1/words` serves the aggregated list back, sorted by recency or popularity.
- **AI suggestions** — `GET /v1/suggestions` generates vocabulary words, books (title/author/year)
  and example sentences for the app's typewriter placeholders and the analyze page, via Groq's free-tier LLM (Cerebras as fallback).
- **AI sentence analysis** — `POST /v1/analyze` explains a submitted sentence in plain
  language, also via Groq.
- **In-memory caching for AI features**, via [`lru-cache`](https://www.npmjs.com/package/lru-cache)
  — `/v1/suggestions` caches per language (TTL-based); `/v1/analyze` caches per
  `(language, sentence)` pair (no TTL, capped entry count instead). Both exist to reduce
  Groq's free-tier quota usage. In-memory only, resets on restart.
- **Rate limited** — `/v1/words` and `/v1/analyze` are each rate limited per IP
  ([`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit)), keyed off
  Cloudflare's tamper-proof `Cf-Connecting-Ip` header when present so a spoofed
  `X-Forwarded-For` can't buy a fresh budget.
- **No accounts, no personally identifiable information** — words are stored anonymously; there's deliberately no DELETE
  endpoint (see [Deleting a word](#deleting-a-word) below).

## Tech stack

- [Node.js](https://nodejs.org/) 24+ with the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module (no native compile step)
- [Express](https://expressjs.com/) 5 + TypeScript
- [Groq](https://console.groq.com) (OpenAI-compatible chat-completions API) for the AI endpoints
- [Cerebras](https://cloud.cerebras.ai) (OpenAI-compatible chat-completions API) as a fallback when Groq returns a 429 rate limit
- [lru-cache](https://www.npmjs.com/package/lru-cache) for the in-memory AI response caches
- [express-rate-limit](https://www.npmjs.com/package/express-rate-limit), [cors](https://www.npmjs.com/package/cors), [morgan](https://www.npmjs.com/package/morgan) + [chalk](https://www.npmjs.com/package/chalk) for request logging

## Getting started

Requires Node.js **24 or later** (see `engines` in `package.json`).

```bash
npm install
cp .env.example .env   # fill in real values — every var has a sensible default though
npm run dev            # tsx watch, hot reload, auto-loads .env
```

The server listens on `http://localhost:4000` by default; try `curl http://localhost:4000/v1`
or visit it for a health check.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4000` | Port to listen on. |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin(s) — comma-separated for multiple (e.g. site + app dev server). |
| `DB_PATH` | `./data/words.db` | SQLite file location (parent dir auto-created). |
| `GROQ_API_KEY` | *(unset)* | Enables `/v1/suggestions` and `/v1/analyze`. Free at [console.groq.com](https://console.groq.com). Without it, both endpoints stay up but return empty results. |
| `SUGGESTIONS_MODEL` | `openai/gpt-oss-120b` | Groq model used by both AI endpoints. |
| `CEREBRAS_API_KEY` | *(unset)* | Optional fallback: retries once via Cerebras when Groq returns a `429`. Free at [cloud.cerebras.ai](https://cloud.cerebras.ai). |
| `CEREBRAS_MODEL` | `gpt-oss-120b` | Cerebras model used for the fallback retry. |
| `ANALYZE_PER_MINUTE` | `10` | Per-IP `/v1/analyze` requests per minute before `429`. |
| `WORDS_PER_MINUTE` | `30` | Per-IP `/v1/words` requests per minute before `429`. |
| `SUGGESTIONS_CACHE_TTL_MS` | `900000` (15 min) | How long a `/v1/suggestions` result is cached in memory per language. |
| `ANALYZE_CACHE_MAX_ENTRIES` | `500` | Max `(language, sentence)` pairs `/v1/analyze` keeps cached at once (no TTL — oldest evicted first). |

`.env` is loaded automatically by `npm run dev`/`npm start`/the scripts below (via Node's
`--env-file-if-exists` flag) — no `dotenv` dependency needed, and a missing `.env` is fine.

## API reference

| Method | Path | Body / Query | Response |
|--------|------|---------------|-----------|
| GET | `/v1` | — | `{ success: true, title: "Word Bank Server REST API" }` health check |
| POST | `/v1/words` | `{ word, definition?, partOfSpeech?, phonetic? }` | `200 { success: true }` / `400 { success: false, error }` / `429 { success: false, error }` / `500 { success: false }` |
| GET | `/v1/words` | `limit` (default 100, clamped 1..500), `order` (`top` \| `recent`, default `recent`) | `200 [{ word, count, definition, partOfSpeech, phonetic }]` |
| GET | `/v1/suggestions` | `lang` (default `en`, must match `^[a-z]{2,3}$`) | `200 { words: string[], books: { title: string, author: string, year: string }[], sentences: string[] }` (empty arrays when `GROQ_API_KEY` is unset or on any failure) |
| POST | `/v1/analyze` | `lang` query param (default `en`, same regex), body `{ text }` (`<= 300` chars) | `200 { meaning: string \| null }` / `400 { success: false, error }` / `429 { success: false, error }` |

A submitted word is only accepted if it's a non-empty string `<= 60` characters, doesn't look
like a URL or email, and matches `^[\p{L}\p{M}][\p{L}\p{M} '-]*$` (a Unicode letter/mark,
followed by letters, marks, spaces, hyphens, or apostrophes).

Note: `ALLOWED_ORIGIN`/CORS restricts which *browser* pages can call this API — it does not
block direct access via Postman, `curl`, or scripts, which never enforce CORS at all. The
rate limiters above are the actual abuse control for non-browser callers.

## Scripts

```bash
npm run dev              # tsx watch src/index.ts (hot reload, auto-loads .env if present)
npm run lint              # eslint using eslint.config.js file
npm run build             # tsc -> dist/
npm start                 # node dist/index.js (auto-loads .env if present)
npm run seed-test-words        # POST a batch of test words to a running server
npm run delete-test-words      # remove exactly that seeded batch
npm run delete-word -- <word> [word2] ...   # delete arbitrary word(s), no server needed
npm run test-rate-limit   # integration test: real Express app + real fetch() calls, no server needed
```

## Deleting a word

There's no HTTP route for this — deleting a word is a rare, operator-only action, so it's
kept out of the server entirely rather than adding an authenticated destructive endpoint for
something used maybe once in a while. Locally, run:

```bash
npm run delete-word -- <word> [word2] ...
```

This talks to the DB file directly, so the server doesn't need to be running.

## License

MIT
