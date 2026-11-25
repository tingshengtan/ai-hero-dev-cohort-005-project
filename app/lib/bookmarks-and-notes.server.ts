import { and, desc, eq } from "drizzle-orm";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import type { Db } from "~/lib/comments.server";
import { noteBodySchema } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// A Student's own flag on a Lesson (Bookmark) and their own writing about it
// (Note). See GLOSSARY.md. Both are private to the Student: every read here is
// scoped to one Student, and nothing outside that Student's Lesson page and
// Saved page may read a Note body.
//
// Content access is the caller's job: the Lesson route checks it with
// requireContentAccess before calling in. Every function takes the database
// first, so tests can hand in an in-memory one.

type Note = typeof notes.$inferSelect;

/** One Student's place on one Lesson. */
export type StudentLesson = { userId: number; lessonId: number };

function bookmarkOn({ userId, lessonId }: StudentLesson) {
  return and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId));
}

function noteOn({ userId, lessonId }: StudentLesson) {
  return and(eq(notes.userId, userId), eq(notes.lessonId, lessonId));
}

export function isBookmarked(db: Db, at: StudentLesson): boolean {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(bookmarkOn(at))
    .get();
}

/**
 * Adds the Bookmark if there is none, removes it if there is one. Returns
 * whether the Lesson is now bookmarked. The unique index on (user, lesson)
 * stops a race from leaving two.
 */
export function toggleBookmark(db: Db, at: StudentLesson, now: Date): boolean {
  return db.transaction((tx) => {
    const removed = tx
      .delete(bookmarks)
      .where(bookmarkOn(at))
      .returning()
      .all();
    if (removed.length > 0) return false;

    tx.insert(bookmarks)
      .values({ ...at, createdAt: now.toISOString() })
      .onConflictDoNothing()
      .run();
    return true;
  });
}

export function getNote(db: Db, at: StudentLesson): Note | undefined {
  return db.select().from(notes).where(noteOn(at)).get();
}

export type SaveNoteResult =
  { ok: true; note: Note } | { ok: false; error: string };

/**
 * Saves the Student's Note on a Lesson. The body is trimmed and capped; an
 * empty or over-long body is refused, never truncated, and leaves any saved
 * Note as it was. A re-save replaces the body and moves `updatedAt` on,
 * keeping `createdAt`.
 */
export function saveNote(
  db: Db,
  at: StudentLesson,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not save that note.",
    };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      ...at,
      body: parsed.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: timestamp },
    })
    .returning()
    .get();

  return { ok: true, note };
}

const lessonRef = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first, each with its Lesson and Course. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRef })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRef,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
