import type { RequestHandler } from "express";

import morgan from "morgan";
import chalk from "chalk";

const WORD_BANK_BRAND_BLUE = "#208AEF";

/**
 * Colors a response status code the way morgan's own "dev" format does:
 * green for success, cyan for redirects, yellow for client errors, red for
 * server errors.
 *
 * @param {string} status The status code token's raw string value.
 * @returns {string} The status code, wrapped in the matching color.
 * 
 */
function colorStatus(status: string): string {
  const code = Number(status);
  if (code >= 500) {
    return chalk.red(status);
  }
  if (code >= 400) {
    return chalk.yellow(status);
  }
  if (code >= 300) {
    return chalk.cyan(status);
  }
  return chalk.green(status);
}

/**
 * Builds the morgan middleware that logs every request as
 * "METHOD baseUrl/path STATUS N ms", with the method/path in the Word Bank
 * brand blue and the status colored by outcome.
 *
 * @param {string} baseUrl The API's base URL, prefixed onto the logged path.
 * @returns {RequestHandler} The morgan middleware to pass to `app.use()`.
 * 
 */
export function createRequestLogger(baseUrl: string): RequestHandler {
  return morgan((tokens, req, res) => {
    return [
      chalk.hex(WORD_BANK_BRAND_BLUE)(`${tokens.method(req, res)} ${baseUrl}${tokens.url(req, res)}`),
      colorStatus(tokens.status(req, res) ?? ""),
      `${tokens["response-time"](req, res)} ms`,
    ].join(" ");
  });
}

/**
 * Logs the server's listening URL in the Word Bank brand blue, matching the
 * request logger's coloring.
 *
 * @param {string} url The URL the server is listening on.
 * @returns {void} Returns nothing; writes one line to the console.
 * 
 */
export function logListening(url: string): void {
  console.log(chalk.hex(WORD_BANK_BRAND_BLUE)(`Server listening on: ${url}`));
}
