# Word Bank Server

A tiny Express + TypeScript + Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)
service that collects individual words added by users in the Word Bank app and serves an
aggregated list back to the marketing site's floating-words background animation and word wall.
It also hosts three Gemini-backed AI endpoints: `/v1/suggestions` (typewriter placeholder words/books and example sentences),
`/v1/analyze/sentences` (plain-language sentence explanation), and `/v1/analyze/book-notes` (interpretation
of a reader's own notes about a book).

It stores nothing but the bare word, a frequency count, and optional public dictionary
metadata (definition, part of speech, phonetic) — no user id, no book id, no private notes.

## Features

- **Word collection** — `POST /v1/words` saves a word (incrementing its count if already
  seen); `GET /v1/words` serves the aggregated list back, sorted by recency or popularity.
- **AI suggestions** — `GET /v1/suggestions` generates vocabulary words, books (title/author/year)
  and example sentences for the app's typewriter placeholders and the analyze page, via Gemini's
  free-tier LLM, using schema-constrained structured output (guaranteed JSON shape).
- **AI sentence analysis** — `POST /v1/analyze/sentences` explains a submitted sentence in plain
  language, also via Gemini.
- **AI book-notes interpretation** — `POST /v1/analyze/book-notes` explains the meaning/themes
  behind a reader's own free-form notes about a book (up to 2000 chars) — not a summary of
  the notes, an interpretation of them.
- **In-memory caching for AI features**, via [`lru-cache`](https://www.npmjs.com/package/lru-cache)
  — `/v1/suggestions` caches per language (TTL-based); `/v1/analyze/sentences` caches per
  `(language, sentence)` pair, `/v1/analyze/book-notes` per `(language, notes)` pair
  (both no TTL, capped entry count instead). All exist to reduce Gemini's free-tier quota
  usage. In-memory only, resets on restart.
- **Rate limited** — `/v1/words`, `/v1/analyze/sentences`, and `/v1/analyze/book-notes` are each rate
  limited per IP ([`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit)),
  keyed off Cloudflare's tamper-proof `Cf-Connecting-Ip` header when present so a spoofed
  `X-Forwarded-For` can't buy a fresh budget.
- **No accounts, no personally identifiable information** — words are stored anonymously; there's deliberately no DELETE
  endpoint (see [Deleting a word](#deleting-a-word) below).

## Tech stack

- [Node.js](https://nodejs.org/) 24+ with the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module (no native compile step)
- [Express](https://expressjs.com/) 5 + TypeScript
- [Gemini](https://ai.google.dev/gemini-api/docs) for the AI endpoints — calls the native `generateContent` API directly (not the OpenAI-compat endpoint), for reliable schema-guaranteed JSON output
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
| `GEMINI_API_KEY` | *(unset)* | Enables all three AI endpoints. Free, no credit card, at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Without it, they stay up but return empty results. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model used by all three AI endpoints. Newer models can carry much tighter free-tier daily caps than older ones (confirmed: 20 requests/day for this model, vs. hundreds for the 2.5 line) — worth checking [ai.dev/rate-limit](https://ai.dev/rate-limit) before relying on heavy usage. |
| `ANALYZE_PER_MINUTE` | `10` | Per-IP `/v1/analyze/sentences` requests per minute before `429`. |
| `WORDS_PER_MINUTE` | `30` | Per-IP `/v1/words` requests per minute before `429`. |
| `BOOK_NOTES_PER_MINUTE` | `10` | Per-IP `/v1/analyze/book-notes` requests per minute before `429`. |
| `SUGGESTIONS_CACHE_TTL_MS` | `900000` (15 min) | How long a `/v1/suggestions` result is cached in memory per language. |
| `ANALYZE_CACHE_MAX_ENTRIES` | `500` | Max `(language, sentence)` pairs `/v1/analyze/sentences` keeps cached at once (no TTL — oldest evicted first). |
| `BOOK_NOTES_CACHE_MAX_ENTRIES` | `500` | Max `(language, notes)` pairs `/v1/analyze/book-notes` keeps cached at once (no TTL — oldest evicted first). |

`.env` is loaded automatically by `npm run dev`/`npm start`/the scripts below (via Node's
`--env-file-if-exists` flag) — no `dotenv` dependency needed, and a missing `.env` is fine.

## API reference

| Method | Path | Body / Query | Response |
|--------|------|---------------|-----------|
| GET | `/v1` | — | `{ success: true, title: "Word Bank Server REST API" }` health check |
| POST | `/v1/words` | `{ word, definition?, partOfSpeech?, phonetic? }` | `200 { success: true }` / `400 { success: false, error }` / `429 { success: false, error }` / `500 { success: false }` |
| GET | `/v1/words` | `limit` (default 100, clamped 1..500), `order` (`top` \| `recent`, default `recent`) | `200 [{ word, count, definition, partOfSpeech, phonetic }]` |
| GET | `/v1/suggestions` | `lang` (default `en`, must match `^[a-z]{2,3}$`) | `200 { words: string[], books: { title: string, author: string, year: string }[], sentences: string[] }` (empty arrays when `GEMINI_API_KEY` is unset or on any failure) |
| POST | `/v1/analyze/sentences` | `lang` query param (default `en`, same regex), body `{ text }` (`<= 300` chars) | `200 { meaning: string \| null }` / `400 { success: false, error }` / `429 { success: false, error }` |
| POST | `/v1/analyze/book-notes` | `lang` query param (default `en`, same regex), body `{ notes }` (`<= 2000` chars — silently truncated, not rejected, if longer) | `200 { meaning: string \| null }` / `400 { success: false, error }` / `429 { success: false, error }` |

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
npm run test-book-notes   # integration test for /v1/analyze/book-notes: validation always runs; live checks run only if GEMINI_API_KEY is set
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
