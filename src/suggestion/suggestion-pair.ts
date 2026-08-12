/** The three AI-generated suggestion lists returned by `/suggestions`. */

/** A suggested book title with author and publication year. */
export type SuggestedTitle = {
    title: string;
    author: string;
    year: string;
};

export type SuggestionPair = {
    /** Evocative vocabulary words for the typewriter placeholder. */
    words: string[];
    /** Well-known book titles for the typewriter placeholder. */
    titles: SuggestedTitle[];
    /** Well-known sentences for analyze sentence examples. */
    sentences: string[];
};
