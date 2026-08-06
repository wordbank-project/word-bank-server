/// <reference types="node" />

// Integration test for src/middleware/rate-limit.ts's two limiters.
// Exercises them over real HTTP, confirming that each limiter allows the
// expected number of requests per minute, blocks over-limit requests, and
// keeps each IP's budget separate from other IPs.
//
// Usage:
//   npm run test-rate-limit

import express from "express";
import { analyzeRateLimiter, wordsRateLimiter } from "../src/middleware/rate-limit.js";

const ANALYZE_LIMIT = 10;
const WORDS_LIMIT = 30;

let failures = 0;

/**
 * Test function that asserts that `actual` matches `expected`, 
 * logging and counting a failure otherwise.
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
  console.log(`FAIL - ${label}: expected ${expected}, got ${actual}`);
}

/**
 * Sends one GET request to the server with the given IP-identifying
 * headers faked.
 *
 * @param {string} base The server's base URL.
 * @param {string} path The path to request.
 * @param {Record<string, string>} headers The headers to fake.
 * @returns {Promise<number>} The response's HTTP status code.
 *
 */
async function hitServerWithHeaders(base: string, path: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`${base}${path}`, { headers });
  return res.status;
}

/**
 * Sends one GET request to the test server, faking the caller's IP via
 * `X-Forwarded-For` so each simulated client gets its own rate-limit budget.
 *
 * @param {string} base The test server's base URL.
 * @param {string} path The path to request.
 * @param {string} ip The IP to simulate.
 * @returns {Promise<number>} The response's HTTP status code.
 *
 */
async function hitServer(base: string, path: string, ip: string): Promise<number> {
  return hitServerWithHeaders(base, path, { "X-Forwarded-For": ip });
}

/**
 * Exercises one rate limiter over real HTTP: the first `limit` requests from a
 * fresh IP should succeed, the next two should be blocked, and a different
 * IP's budget should stay unaffected.
 *
 * @param {string} base The test server's base URL.
 * @param {string} name Label for this limiter, used in log output.
 * @param {string} path The route this limiter guards.
 * @param {number} limit The number of requests it should allow per minute.
 * @returns {Promise<void>} Returns nothing; logs each check.
 *
 */
async function checkRateLimiter(base: string, name: string, path: string, limit: number): Promise<void> {
  const ip = `203.0.113.${limit}`; // distinct fake IP per limiter, so tests don't collide
  for (let i = 1; i <= limit; i++) {
    assertEqual(`${name}: request ${i}/${limit} from a fresh IP is allowed`, await hitServer(base, path, ip), 200);
  }

  assertEqual(`${name}: request ${limit + 1} is blocked`, await hitServer(base, path, ip), 429);
  assertEqual(`${name}: request ${limit + 2} is blocked`, await hitServer(base, path, ip), 429);

  const otherIp = `198.51.100.${limit}`;
  assertEqual(`${name}: a different IP has its own independent bucket`, await hitServer(base, path, otherIp), 200);
}

/**
 * Confirms `Cf-Connecting-Ip` takes priority over `X-Forwarded-For`: requests
 * sharing one `Cf-Connecting-Ip` but each with a *different* `X-Forwarded-For`
 * should still share one budget, and a different `Cf-Connecting-Ip` should
 * get its own independent budget even while reusing an old `X-Forwarded-For`.
 *
 * @param {string} base The test server's base URL.
 * @returns {Promise<void>} Returns nothing; logs each check.
 *
 */
async function checkCloudFlaringIpPreference(base: string): Promise<void> {
  const cfIp = "203.0.113.77";
  for (let i = 1; i <= WORDS_LIMIT; i++) {
    const status = await hitServerWithHeaders(base, "/words", {
      "X-Forwarded-For": `9.9.9.${i}`, // different every time — should be ignored
      "Cf-Connecting-Ip": cfIp,
    });
    assertEqual(
      `Cf-Connecting-Ip: request ${i}/${WORDS_LIMIT} sharing one Cf-Connecting-Ip is allowed`,
      status,
      200,
    );
  }

  const blockedStatus = await hitServerWithHeaders(base, "/words", {
    "X-Forwarded-For": "9.9.9.999",
    "Cf-Connecting-Ip": cfIp,
  });
  assertEqual(
    "Cf-Connecting-Ip: over-limit request (same Cf-Connecting-Ip, new X-Forwarded-For) is blocked",
    blockedStatus,
    429,
  );

  const otherCfIp = "203.0.113.78";
  const freshStatus = await hitServerWithHeaders(base, "/words", {
    "X-Forwarded-For": "9.9.9.1", // reuses request #1's X-Forwarded-For above
    "Cf-Connecting-Ip": otherCfIp,
  });
  assertEqual(
    "Cf-Connecting-Ip: a different Cf-Connecting-Ip has its own independent bucket",
    freshStatus,
    200,
  );
}

/**
 * Main entry point: spins up a throwaway Express app with the real limiters
 * wired in, then drives it with real fetch() calls to confirm the limiters
 * behave as expected.
 *
 * @returns {Promise<void>} Returns nothing; logs each check.
 *
 */
async function main(): Promise<void> {
  const app = express();
  app.set("trust proxy", true); // so X-Forwarded-For above simulates distinct IPs, like production
  app.get("/analyze", analyzeRateLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.get("/words", wordsRateLimiter, (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const base = `http://localhost:${port}`;

  await checkRateLimiter(base, "analyzeRateLimiter", "/analyze", ANALYZE_LIMIT);
  await checkRateLimiter(base, "wordsRateLimiter", "/words", WORDS_LIMIT);

  assertEqual(
    "analyzeRateLimiter and wordsRateLimiter don't share a budget",
    await hitServer(base, "/words", `203.0.113.${ANALYZE_LIMIT}`), // an IP already blocked on the analyze limiter above
    200,
  );

  await checkCloudFlaringIpPreference(base);

  server.close();

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main();
