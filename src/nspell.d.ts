declare module "nspell" {
  interface Dictionary { aff: string | Uint8Array; dic?: string | Uint8Array }
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): NSpell;
    remove(word: string): NSpell;
    personal(words: string): NSpell;
  }
  export default function nspell(dictionary: Dictionary): NSpell;
}
