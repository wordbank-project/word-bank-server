import type { Response } from "express";

/** An error that carries the HTTP status it should produce when caught by sendErrorResponse. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

/**
 * If the error is an instance of HttpError, it sends the error's status and message.
 * Otherwise, it logs the error and sends a generic 500 (Internal Server Error) response.
 *
 * @param {unknown} err The caught error.
 * @param {Response} res The response to send on.
 * @returns {void} Returns nothing; sends the response.
 *
 */
export function sendErrorResponse(err: unknown, res: Response): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  console.error("Unexpected error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
}
