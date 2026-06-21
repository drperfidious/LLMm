/**
 * Debug-only Metro shim for `phonemize`.
 *
 * `@pocketpalai/react-native-speech` already treats a missing `toIPA` export
 * as "phonemize unavailable" and falls back to its mmap/dict-only path. The
 * real `phonemize` package embeds a multi-megabyte generated English G2P
 * dictionary that Hermes fails to bytecode-encode in Debug app bundles.
 */
export {};
