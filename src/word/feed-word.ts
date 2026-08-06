/** Word that is shown in the word wall in the marketing site **/

export type FeedWord = {
    /** The saved word. */
    word: string;
    /** How many times this word has been saved. */
    count: number;
    /** The word's public dictionary definition, if known. */
    definition: string | null;
    /** The word's part of speech, if known. */
    partOfSpeech: string | null;
    /** The word's IPA phonetic spelling, if known. */
    phonetic: string | null;
};