/** The two AI-generated suggestion lists returned by `/suggestions`. */

export type SuggestionPair = {
    /** Evocative vocabulary words for the typewriter placeholder. */
    words: string[];
    /** Well-known book titles for the typewriter placeholder. */
    titles: string[];
};