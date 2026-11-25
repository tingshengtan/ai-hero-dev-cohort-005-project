import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

export const NOTE_EMPTY_MESSAGE = "Write something before saving your note.";

export const NOTE_TOO_LONG_MESSAGE = `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`;

/**
 * A Note body: plain text, trimmed, not empty, capped. Never rendered as
 * Markdown.
 */
export const noteBodySchema = z
  .string()
  .trim()
  .min(1, NOTE_EMPTY_MESSAGE)
  .max(MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE);
