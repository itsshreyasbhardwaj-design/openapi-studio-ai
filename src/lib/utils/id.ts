import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(ALPHABET, 14);

/** Prefixed, URL-safe, sortable-enough identifier (e.g. `spec_k1n8x…`). */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

/** Deterministic, stable slug for titles used in URLs and generated file names. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}
