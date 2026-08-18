/** The three AI-generated suggestion lists returned by `/suggestions`. */

export type SuggestedBook = {
    /* Title of the book */
    title: string;
    /* Author of the book */
    author: string;
    /* First published release year */
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
