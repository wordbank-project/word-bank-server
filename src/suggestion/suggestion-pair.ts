/** The three AI-generated suggestion lists returned by `/suggestions`. */

export type SuggestedBook = {
    title: string;
    author: string;
    year: string;
};

export type SuggestionPair = {
    /** Evocative vocabulary words for the typewriter placeholder. */
    words: string[];
    /** Well-known books (title, author, year) for the typewriter placeholder. */
    books: SuggestedBook[];
    /** Well-known sentences for analyze sentence examples. */
    sentences: string[];
};
