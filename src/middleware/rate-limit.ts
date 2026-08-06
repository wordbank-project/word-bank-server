import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

const WINDOW_MS = 60_000; // 1 minute in milliseconds

/**
 * If parsedLimit is a real, finite (not NaN and not Infinity) number and it's greater than 0, 
 * use it — otherwise fall back to the default limit.
 *
 * @param {string | undefined} rawValue The raw env var value.
 * @param {number} fallbackLimit The default limit to use otherwise.
 * @returns {number} The resolved per-minute limit.
 *
 */
function resolveLimit(rawValue: string | undefined, fallbackLimit: number): number {
  const parsedLimit = Number(rawValue);
  return Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : fallbackLimit;
}

/**
 * Identifies the request for rate-limiting, preferring Cloudflare's
 * get the `Cf-Connecting-Ip` Cloudflare header when present,
 * if not present we use `req.ip` - otherwise (e.g. local development, no Cloudflare in front as a proxy).
 *
 * @param {Request} req The incoming request.
 * @returns {string} The key to put this request under.
 *
 */
function getClientIpAddress(req: Request): string {
  const cloudflareConnectingIpHeader = req.headers["cf-connecting-ip"];
  if (typeof cloudflareConnectingIpHeader === "string" && cloudflareConnectingIpHeader) {
    return ipKeyGenerator(cloudflareConnectingIpHeader);
  }
  return ipKeyGenerator(req.ip ?? "unknown");
}

/**
 * Builds a per-IP rate limiter with the given limit,
 * returning it as Express middleware we can use.
 *
 * @param {number} rateLimitAmount Amount of requests allowed per IP per 60-second window.
 * @returns {RequestHandler} Express middleware — placed before a route handler.
 *
 */
function createRateLimiter(rateLimitAmount: number): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    max: rateLimitAmount,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "Too many requests from this IP, please try again later" },
    keyGenerator: getClientIpAddress,
    validate: { trustProxy: false },
  });
}

export const analyzeRateLimiter = createRateLimiter(resolveLimit(process.env.ANALYZE_PER_MINUTE, 10));
export const wordsRateLimiter = createRateLimiter(resolveLimit(process.env.WORDS_PER_MINUTE, 30));
