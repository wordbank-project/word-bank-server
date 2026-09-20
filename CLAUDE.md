# word-bank-server-own

## Purpose

A tiny Express + TypeScript + Node's built-in `node:sqlite` service that collects individual words added
by users in the Word Bank app and serves an aggregated list back to the marketing site's
floating-words background animation. It also hosts three Gemini-backed endpoints:
`/v1/suggestions` (typewriter placeholder words/books, plus example sentences for the app's
Analyze screen), `/v1/analyze/sentences` (plain-language sentence explanation), and
`/v1/analyze/book-notes` (interpretation of a reader's own notes about a book). It stores
nothing but the bare word, a frequency count, and optional
public dictionary metadata (definition, part of speech, phonetic) — no user id, no book id,
no private notes.

## Source files

| File | What it's for |
|------|----------------|
| [`src/word/words.ts`](src/word/words.ts) | SQLite schema/migration, `sanitizeWord`/`sanitizeText` validators, `upsertWord`/`getWords`. `deleteWords` also lives here but is never exposed over HTTP — see "Deleting a word" below. |
| [`src/ai/llm.ts`](src/ai/llm.ts) | The one function (`completeChat`) that calls Gemini's native `generateContent` endpoint directly (not the OpenAI-compat shim — see the file's own comments for why). `hasLlmKeyConfigured()` gates every AI code path. Explicitly sets thinking to its lowest level (`thinkingLevel: "minimal"`) since Gemini 3 models think by default and it draws from the same token budget as the visible reply — `thinkingBudget` (the Gemini 2.5-era control) is rejected outright by Gemini 3 models. |
| [`src/ai/complete-options.ts`](src/ai/complete-options.ts) | `CompleteOptions` — the `schema`/`maxTokens`/`timeoutMs` overrides `completeChat` accepts. `schema` is a `GeminiSchema` (Gemini's OpenAPI-subset `responseSchema` shape, uppercase `type`s) that enforces the reply's JSON structure when present. |
| [`src/suggestion/suggestions.ts`](src/suggestion/suggestions.ts) | Builds the `/v1/suggestions` response: one prompt per list (`wordsPrompt`/`booksPrompt`/`sentencesPrompt`, fired together via `Promise.all` in `getSuggestionPair`), each paired with a `GeminiSchema` so the reply's JSON shape is guaranteed; `parseSuggestionList` validation for words/sentences (per `SuggestionKind`) and `parseBookList` for the structured `{ title, author, year }` book list still filter for *content* sanity (schema only guarantees shape). |
| [`src/ai/sentences.ts`](src/ai/sentences.ts) | Builds the `/v1/analyze/sentences` response: one prompt, one live call to `completeChat`, no parsing needed since the reply is plain text. |
| [`src/ai/book-notes.ts`](src/ai/book-notes.ts) | Builds the `/v1/analyze/book-notes` response: same shape as `sentences.ts` (one prompt, plain-text reply, in-memory cache, no TTL), but keyed by a `(language, notes)` pair instead of `(language, sentence)`, and the prompt asks for the *meaning/themes* behind the notes rather than an explanation of a single sentence. |
| [`src/middleware/rate-limit.ts`](src/middleware/rate-limit.ts) | Builds `analyzeRateLimiter`/`wordsRateLimiter`/`bookNotesRateLimiter`, one `express-rate-limit` instance per limited route. Each keys requests off Cloudflare's tamper-proof `Cf-Connecting-Ip` header when present, falling back to `req.ip` otherwise — see "Rate limiting" below for why. In-memory only — resets on restart. |
| [`src/middleware/cors.ts`](src/middleware/cors.ts) | `parseAllowedOrigins` — turns the `ALLOWED_ORIGIN` env var into what the `cors` middleware expects. |
| [`src/middleware/request-logger.ts`](src/middleware/request-logger.ts) | morgan + chalk request-logging middleware, colored in the Word Bank brand blue (`#208AEF`, the site/app's `--accent` token); status codes colored by outcome. |
| [`src/index.ts`](src/index.ts) | Express app: middleware, routes. |
| [`src/word/word-meta.ts`](src/word/word-meta.ts), [`src/word/feed-word.ts`](src/word/feed-word.ts), [`src/suggestion/suggestion-kind.ts`](src/suggestion/suggestion-kind.ts), [`src/suggestion/suggestion-pair.ts`](src/suggestion/suggestion-pair.ts) | Plain `type` aliases shared across the files above. |
| `scripts/seed-test-words.ts` / `scripts/delete-test-words.ts` / `scripts/delete-word.ts` | Dev convenience: POST a fixed word list to a running server, remove exactly that list again (`scripts/seed-data.ts`), or delete arbitrary word(s) by name — all three talk to the DB directly where possible, no HTTP needed for the latter two. |
| `scripts/test-rate-limit.ts` | Integration test for all three rate limiters: spins up a throwaway Express app on an ephemeral port with the real limiters wired in and drives it with real `fetch()` calls, including a check that `Cf-Connecting-Ip` takes priority over `X-Forwarded-For` and that no two limiters share a budget. |
| `scripts/test-book-notes.ts` | Integration test for `POST /v1/analyze/book-notes`: validation checks (bad `lang`, missing/oversized/link-like `notes`) always run; live checks (real content comes back, caching works) run only when `GEMINI_API_KEY` is set — otherwise skipped, not failed. |

## Endpoints

| Method | Path | Body / Query | Response |
|--------|------|---------------|-----------|
| GET | `/v1` | — | `{ success: true, title: "Word Bank Server REST API" }` health check |
| POST | `/v1/words` | `{ word, definition?, partOfSpeech?, phonetic? }` | `200 { success: true }` / `400 { success: false, error }` / `429 { success: false, error }` / `500 { success: false }` |
| GET | `/v1/words` | `limit` (default 100, clamped 1..500), `order` (`top` \| `recent`, default `recent`) | `200 [{ word, count, definition, partOfSpeech, phonetic }]` |
| GET | `/v1/suggestions` | `lang` (default `en`, must match `^[a-z]{2,3}$`) | `200 { words: string[], books: { title: string, author: string, year: string }[], sentences: string[] }` (empty arrays when `GEMINI_API_KEY` is unset or on any failure) |
| POST | `/v1/analyze/sentences` | `lang` query param (default `en`, same regex), body `{ text }` (`<= 300` chars via `sanitizeText`) | `200 { meaning: string \| null }` / `400 { success: false, error }` / `429 { success: false, error }` |
| POST | `/v1/analyze/book-notes` | `lang` query param (default `en`, same regex), body `{ notes }` (`<= 2000` chars via `sanitizeText` — silently truncated, not rejected, if longer) | `200 { meaning: string \| null }` / `400 { success: false, error }` / `429 { success: false, error }` |

There is deliberately **no DELETE endpoint** — see "Deleting a word" below.

`/v1/analyze/sentences`, `/v1/analyze/book-notes`, and `/v1/words` are each rate limited per IP via
independent 60s-window limiters built on
[`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit) (`ANALYZE_PER_MINUTE`,
default 10; `WORDS_PER_MINUTE`, default 30; `BOOK_NOTES_PER_MINUTE`, default 10; all in-memory,
resets on restart) — see [`src/middleware/rate-limit.ts`](src/middleware/rate-limit.ts). Each
limiter is applied as route middleware (`app.post("/v1/words", wordsRateLimiter, ...)`), not a
manual in-handler check, so an over-limit request never reaches the route handler at all.

All three limiters key requests off Cloudflare's `Cf-Connecting-Ip` header when present — set by
Cloudflare's edge, never influenced by anything the client sends — falling back to `req.ip`
only when it's absent (local dev, no Cloudflare in front). Plain `req.ip` alone isn't
trustworthy behind Cloudflare Tunnel: `cloudflared` has a confirmed open bug
([cloudflared#1426](https://github.com/cloudflare/cloudflared/issues/1426)) where a
client-supplied `X-Forwarded-For` gets appended to, not replaced, which would otherwise let a
client fake a fresh IP — and a fresh rate-limit budget — on every request.
`app.set("trust proxy", 1)` in `index.ts` is defense-in-depth for the same reason, scoped to
exactly one hop instead of trusting an unlimited chain.

`/v1/analyze/sentences` and `/v1/analyze/book-notes` need rate limiting because each costs Gemini quota
per call and has no auth; `/v1/words` because it's the one endpoint anyone can script spam
onto the public word wall.
Both AI endpoints cache in memory. `/v1/suggestions` caches per language
(`SUGGESTIONS_CACHE_TTL_MS`, see `suggestions.ts`) — Gemini's free tier is gated by
requests-per-minute (order of 10-15 RPM depending on model, not a fixed number — check Google
AI Studio's rate-limit page for current figures) rather than tokens, and one `/v1/suggestions`
request already fires three parallel completions (words/books/sentences) at once, so a single
uncached request alone spends a meaningful slice of that budget — the cache is what keeps
ordinary repeat traffic from tripping the ceiling at all, not just a quota-saving nicety.
**Known gap**: nothing currently throttles concurrent *different*-language `/v1/suggestions`
cache misses against that shared RPM budget (e.g. several languages requested within the same
minute could still exceed it) — acceptable at this project's actual (personal/hobby) traffic
scale; a request queue/token-bucket in `llm.ts` would be the fix if it's ever actually observed.
`/v1/analyze/sentences` caches per `(language, sentence)` pair, capped at `ANALYZE_CACHE_MAX_ENTRIES`
entries with the oldest evicted first, **no TTL** — unlike suggestions, a sentence's explanation
doesn't go stale, and repeats are more likely than "arbitrary user text" suggests: the app's
suggested-sentence picker feeds from `/v1/suggestions`' cached `sentences` list, so many users
can pick the same sentence within that cache's window (see `sentences.ts`). `/v1/analyze/book-notes`
caches per `(language, notes)` pair, same `no TTL` reasoning, capped at
`BOOK_NOTES_CACHE_MAX_ENTRIES`. Repeats are less likely here than `/v1/analyze/sentences`'s
(book notes are personal free-form text, not drawn from a shared suggested list), but the
cache is cheap and still guards a re-submitted request for free. There's no same-provider
fallback for any of the three (unlike the old
Groq+Cerebras setup) — `completeChat` calls Gemini directly with no retry wrapper, so a `429`
(or any other failure) surfaces to the client as-is via `sendErrorResponse`, same shape as any
other error already does.

All three routes also send an `X-Cache: HIT`/`MISS` response header, via `isSuggestionPairCached`
(`suggestions.ts`), `isAnalysisCached` (`sentences.ts`), and `isBookNotesCached` (`book-notes.ts`)
— each just peeks the relevant cache (`.has(...)`) without consuming or mutating it, so a
browser can confirm cache behavior directly in DevTools instead of having to compare request
timings by hand. Worth knowing: since none of the caches are scoped per caller, an
`X-Cache: HIT` tells any client that *someone* already submitted that exact input before — a
minor, low-severity cross-caller signal (no identity or count attached, and it requires
guessing the exact text) that already existed implicitly via response timing; the header just
makes it exact instead of noisy.

`sanitizeWord` (`src/word/words.ts`) accepts a word only if: it's a string; non-empty and `<= 60`
chars after `trim().toLowerCase()`; doesn't look like a URL/email (`://`, `http`, `@`); and
matches `^[\p{L}\p{M}][\p{L}\p{M} '-]*$` (Unicode letter/mark start, then letters, marks,
spaces, hyphens, apostrophes). `sanitizeText` is the looser sibling used for optional
dictionary metadata.

## Deleting a word

There's no HTTP route for this — deleting a word is a rare, operator-only action, so it's
kept out of the server entirely rather than adding an authenticated destructive endpoint for
something used maybe once in a while:

- **Locally**: `npm run delete-word -- <word> [word2] ...` (talks to the DB file directly,
  server doesn't need to be running).
- **In production**: a `docker exec` one-liner against the running container — see
  `deployment.md`'s "Deleting a bad word" section.

## Code style

- **Guard clauses, not nested conditionals.** Validate/reject early and return, rather than
  nesting the "happy path" inside `if`/`else`. See `sanitizeWord` in
  [`src/word/words.ts`](src/word/words.ts) for the canonical shape: one `if (...) { return null; }` per
  rule, all at the same indentation level.
- **Every `if`/`for`/`while` body is braced**, even single-statement ones — no one-liners
  like `if (x) return null;`. This is enforced by ESLint's `curly: ["error", "all"]` rule
  in [`eslint.config.js`](eslint.config.js); run `npm run lint` before committing.
- **JSDoc on every exported function, and every function with parameters even if it
  isn't exported** — a prose summary plus a described `@param`/`@returns` for each, even
  when the type is already declared natively and the tag is technically redundant. This
  also covers `index.ts`'s route handlers: they're inline callbacks, not exports, but they
  take `req`/`res` params, so they get the same treatment — match the existing comments
  there. Match the existing comments in `words.ts`/`suggestions.ts`/`llm.ts` too.
  End every JSDoc block with a blank `* ` line right after the last `@returns` line, before
  the closing `*/` — e.g.:
  ```ts
  /**
   * ...
   * @returns {string} ...
   * 
   */
  ```
- Prefer small, single-purpose modules over one large file — `llm.ts` only knows how to
  call the model; `words.ts` only knows SQLite; `suggestions.ts` composes the two.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4000` | Port to listen on. `wiktapi.dev` occupies `3000` when co-hosted (see `deployment.md`). |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin(s) — comma-separated for multiple (e.g. site + app dev server). |
| `DB_PATH` | `./data/words.db` | SQLite file location (parent dir auto-created). |
| `GEMINI_API_KEY` | *(unset)* | Enables all three AI endpoints. Free, no credit card, at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model used by all three AI endpoints. Google's model lineup shifts fast (confirmed live Aug 2026: `gemini-2.5-flash`/`gemini-2.5-flash-lite` had both already stopped accepting new users) — verify this is still current before relying on it. Also confirmed live: newer models can carry a much tighter free-tier **daily** cap than older ones (`gemini-3.6-flash`: 20 requests/day, vs. hundreds/day for the 2.5 line) — check [ai.dev/rate-limit](https://ai.dev/rate-limit) for the model you're actually using before assuming headroom. |
| `ANALYZE_PER_MINUTE` | `10` | Per-IP `/v1/analyze/sentences` requests per minute before `429`. |
| `WORDS_PER_MINUTE` | `30` | Per-IP `/v1/words` requests per minute before `429`. |
| `BOOK_NOTES_PER_MINUTE` | `10` | Per-IP `/v1/analyze/book-notes` requests per minute before `429`. |
| `SUGGESTIONS_CACHE_TTL_MS` | `900000` (15 min) | How long a `/v1/suggestions` result is cached in memory per language before the next request calls Gemini live again. |
| `ANALYZE_CACHE_MAX_ENTRIES` | `500` | Max `(language, sentence)` pairs `/v1/analyze/sentences` keeps cached at once — no TTL, so this entry count (oldest evicted first) is what bounds memory instead. |
| `BOOK_NOTES_CACHE_MAX_ENTRIES` | `500` | Max `(language, notes)` pairs `/v1/analyze/book-notes` keeps cached at once — no TTL, same reasoning as `ANALYZE_CACHE_MAX_ENTRIES`. |

## Run / build

```bash
npm install
npm run dev              # tsx watch src/index.ts (hot reload, auto-loads .env if present)
npm run lint              # eslint .
npm run build             # tsc -> dist/
npm start                 # node dist/index.js (auto-loads .env if present)
npm run seed-test-words        # POST a batch of test words to a running server
npm run delete-test-words      # remove exactly that seeded batch
npm run delete-word -- <word> [word2] ...   # delete arbitrary word(s), no server needed
npm run test-rate-limit   # integration test: real Express app + real fetch() calls, no server needed
npm run test-book-notes   # integration test for /v1/analyze/book-notes; live checks only run if GEMINI_API_KEY is set
```

Note: `ALLOWED_ORIGIN`/CORS restricts which *browser* pages can call this API — it does not
block direct access via Postman, `curl`, or scripts, which never enforce CORS at all. The
rate limiters above are the actual abuse control for non-browser callers.
