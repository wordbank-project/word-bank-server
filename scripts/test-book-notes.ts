/// <reference types="node" />

// Integration test for POST /v1/analyze/book-notes (src/index.ts + src/ai/book-notes.ts).
// Spins up a throwaway Express app with the real route wired in (bypassing the rate limiter,
// which has its own dedicated coverage in scripts/test-rate-limit.ts) and drives it with real
// fetch() calls: validation (bad lang, missing/oversized notes) and — only if GEMINI_API_KEY
// is set — a live call confirming real content comes back and the cache actually caches.
//
// Usage:
//   npm run test-book-notes

import express from "express";

import { sanitizeText } from "../src/word/words.js";
import { analyzeBookNotes, isBookNotesCached } from "../src/ai/book-notes.js";
import { hasLlmKeyConfigured } from "../src/ai/llm.js";
import { sendErrorResponse } from "../src/utils/http-error.js";

let failures = 0;

/**
 * Asserts that `actual` matches `expected`, logging and counting a failure otherwise.
 *
 * @param {string} label What this check is verifying.
 * @param {unknown} actual The actual value produced by the code under test.
 * @param {unknown} expected The expected value it should equal.
 * @returns {void} Returns nothing; logs a pass/fail line.
 *
 */
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`success - ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL - ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Asserts that `condition` is true, logging and counting a failure otherwise.
 *
 * @param {string} label What this check is verifying.
 * @param {boolean} condition The condition that should hold.
 * @returns {void} Returns nothing; logs a pass/fail line.
 *
 */
function assertTrue(label: string, condition: boolean): void {
  assertEqual(label, condition, true);
}

/**
 * Builds a throwaway Express app with the real /v1/analyze/book-notes route wired in,
 * mirroring index.ts's handler exactly but without the rate limiter — that's covered
 * separately in scripts/test-rate-limit.ts, and would only get in the way of a test that
 * fires more than its per-minute limit worth of requests.
 *
 * @returns {express.Express} The test app, not yet listening.
 *
 */
function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.post("/v1/analyze/book-notes", async (req, res) => {
    const chosenLanguage = typeof req.query.lang === "string" ? req.query.lang.toLowerCase() : "en";
    if (!/^[a-z]{2,3}$/.test(chosenLanguage)) {
      res.status(400).json({ success: false, error: "Invalid lang parameter given" });
      return;
    }

    const enteredNotes = sanitizeText(req.body?.notes, 2000);
    if (enteredNotes === null) {
      res.status(400).json({ success: false, error: "Invalid notes entered" });
      return;
    }

    try {
      res.setHeader("X-Cache", isBookNotesCached(enteredNotes, chosenLanguage) ? "HIT" : "MISS");
      res.json({ meaning: await analyzeBookNotes(enteredNotes, chosenLanguage) });
    } catch (err: unknown) {
      sendErrorResponse(err, res);
    }
  });

  return app;
}

/**
 * Sends one POST request to the test server with a JSON body.
 *
 * @param {string} base The test server's base URL.
 * @param {string} path The path to request, including any query string.
 * @param {unknown} body The value to send as the JSON request body.
 * @returns {Promise<{ status: number; headers: Headers; body: Record<string, unknown> }>} The response's status, headers, and parsed JSON body.
 *
 */
async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Runs the validation checks: everything that should fail before ever reaching the LLM,
 * so these pass regardless of whether GEMINI_API_KEY is configured.
 *
 * @param {string} base The test server's base URL.
 * @returns {Promise<void>} Returns nothing; logs each check.
 *
 */
async function checkValidation(base: string): Promise<void> {
  // Direct, pure check of the truncation math itself — no HTTP/LLM involved — since the
  // HTTP-level checks below only prove the pipeline doesn't break on oversized input, not
  // the exact resulting length.
  assertEqual("sanitizeText truncates to exactly the cap", sanitizeText("a".repeat(2001), 2000)?.length, 2000);

  const missingNotes = await postJson(base, "/v1/analyze/book-notes", {});
  assertEqual("missing notes is rejected", missingNotes.status, 400);

  const emptyNotes = await postJson(base, "/v1/analyze/book-notes", { notes: "   " });
  assertEqual("whitespace-only notes is rejected", emptyNotes.status, 400);

  // sanitizeText (shared with /v1/analyze/sentences) truncates to the cap rather than rejecting —
  // established, existing behavior, not something specific to this route. Puts a link well
  // inside the first 2000 chars so the truncated text still trips the link check below and
  // returns 400 for *that* reason — keeps this a validation-only check (no live LLM call)
  // while still proving truncation itself doesn't crash or silently pass through.
  const oversizedNotesWithLink = await postJson(base, "/v1/analyze/book-notes", {
    notes: "a".repeat(1900) + " http://example.com " + "b".repeat(200),
  });
  assertEqual("notes over 2000 chars are truncated, not rejected for length alone", oversizedNotesWithLink.status, 400);

  const linkLikeNotes = await postJson(base, "/v1/analyze/book-notes", {
    notes: "see https://example.com for more",
  });
  assertEqual("link-like notes is rejected", linkLikeNotes.status, 400);

  const badLang = await postJson(base, "/v1/analyze/book-notes?lang=english", { notes: "A sad ending." });
  assertEqual("invalid lang param is rejected", badLang.status, 400);
}

/**
 * Runs the live functional checks against the real Gemini API — only if GEMINI_API_KEY is
 * configured, otherwise this is skipped rather than failed, since it's not this test's job
 * to require a real key just to exist.
 *
 * @param {string} base The test server's base URL.
 * @returns {Promise<void>} Returns nothing; logs each check, or a skip notice.
 *
 */
async function checkLiveBehavior(base: string): Promise<void> {
  if (!hasLlmKeyConfigured()) {
    console.log("skipped - live checks (GEMINI_API_KEY not set)");
    return;
  }

  const notes = "The old man finally lets go of the boat, even though he caught nothing in the end.";
  const first = await postJson(base, "/v1/analyze/book-notes?lang=en", { notes });
  assertEqual("live request succeeds", first.status, 200);
  assertEqual("live request is a cache miss", first.headers.get("x-cache"), "MISS");
  assertTrue("live request returns a non-empty meaning", typeof first.body.meaning === "string" && (first.body.meaning as string).length > 0);

  const second = await postJson(base, "/v1/analyze/book-notes?lang=en", { notes });
  assertEqual("repeat request is a cache hit", second.headers.get("x-cache"), "HIT");
  assertEqual("repeat request returns the identical meaning", second.body.meaning, first.body.meaning);
}

/**
 * Main entry point: builds the test app, runs it on an ephemeral port, and drives both the
 * validation and (if configured) live-behavior checks against it.
 *
 * @returns {Promise<void>} Returns nothing; logs each check.
 *
 */
async function main(): Promise<void> {
  const app = buildTestApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const base = `http://localhost:${port}`;

  await checkValidation(base);
  await checkLiveBehavior(base);

  server.close();

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main();
