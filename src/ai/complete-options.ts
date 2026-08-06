/** Options controlling one call to `complete()`. */

export type CompleteOptions = {
    /** Ask the model for a JSON object (Groq's OpenAI-compatible JSON mode). */
    json?: boolean;
    /** Maximum tokens the model may generate in its reply. */
    maxTokens?: number;
    /** How long to wait before aborting the request. */
    timeoutMs?: number;
};