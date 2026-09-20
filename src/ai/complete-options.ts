/**
 * A Gemini `responseSchema` node (OpenAPI 3.0 subset, per Gemini's `generateContent` API).
 * `type` values are the uppercase strings Gemini's API expects — not standard JSON Schema.
 * Only the shapes this project actually needs are modeled: flat arrays of strings, and
 * arrays of flat string-keyed objects.
 */
export type GeminiSchema = {
    type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";
    items?: GeminiSchema;
    properties?: Record<string, GeminiSchema>;
    required?: string[];
};

/** Options controlling one call to `complete()`. */

export type CompleteOptions = {
    /** JSON Schema describing the required response shape, enforced by Gemini's
     * structured-output mode (`responseMimeType: "application/json"` + `responseSchema`).
     * Omit for a plain-text reply (e.g. sentences.ts). */
    schema?: GeminiSchema;
    /** Maximum tokens the model may generate in its reply. */
    maxTokens?: number;
    /** How long to wait before aborting the request. */
    timeoutMs?: number;
};
