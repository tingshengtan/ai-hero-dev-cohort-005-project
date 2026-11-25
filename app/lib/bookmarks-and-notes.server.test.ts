import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function at(lessonIndex: number, userId = base.user.id) {
  return { userId, lessonId: lessonIds[lessonIndex] };
}

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson with no Bookmark, and unbookmarks it on the next press", () => {
    expect(isBookmarked(db, at(0))).toBe(false);

    expect(toggleBookmark(db, at(0), NOW)).toBe(true);
    expect(isBookmarked(db, at(0))).toBe(true);

    expect(toggleBookmark(db, at(0), NOW)).toBe(false);
    expect(isBookmarked(db, at(0))).toBe(false);
  });

  it("never leaves a Student two Bookmarks on one Lesson", () => {
    toggleBookmark(db, at(0), NOW);

    expect(() => db.insert(schema.bookmarks).values(at(0)).run()).toThrow();
    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates a Note, trimmed, on a Lesson with none", () => {
    const result = saveNote(db, at(0), "  Revisit the closure part.  ", NOW);

    expect(result.ok).toBe(true);
    expect(getNote(db, at(0))).toMatchObject({
      body: "Revisit the closure part.",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, at(0), "First thought", NOW);
    saveNote(db, at(0), "Second thought", minutesAfter(5));

    expect(getNote(db, at(0))).toMatchObject({
      body: "Second thought",
      createdAt: NOW.toISOString(),
      updatedAt: minutesAfter(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("never leaves a Student two Notes on one Lesson", () => {
    saveNote(db, at(0), "Mine", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ ...at(0), body: "Another" })
        .run()
    ).toThrow();
  });

  it("accepts a Note of exactly the cap", () => {
    const body = "a".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, at(0), body, NOW).ok).toBe(true);
    expect(getNote(db, at(0))?.body).toBe(body);
  });

  it("refuses a Note over the cap, with a message, and keeps the old one", () => {
    saveNote(db, at(0), "Keep me", NOW);

    const result = saveNote(db, at(0), "a".repeat(MAX_NOTE_LENGTH + 1), NOW);

    expect(result).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, at(0))?.body).toBe("Keep me");
  });

  it("keeps Markdown characters exactly as typed", () => {
    saveNote(db, at(0), "# not a heading\n*not bold*", NOW);

    expect(getNote(db, at(0))?.body).toBe("# not a heading\n*not bold*");
  });

  it("refuses an empty Note, with a message, and keeps the old one", () => {
    saveNote(db, at(0), "Keep me", NOW);

    expect(saveNote(db, at(0), "   ", NOW)).toEqual({
      ok: false,
      error: "Write something before saving your note.",
    });
    expect(getNote(db, at(0))?.body).toBe("Keep me");
  });

  it("refuses an empty Note on a Lesson with none, and creates nothing", () => {
    expect(saveNote(db, at(0), "", NOW).ok).toBe(false);
    expect(getNote(db, at(0))).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("lists only the Student's own Bookmarks, newest first, with Lesson and Course", () => {
    const other = addStudent("Ben");
    toggleBookmark(db, at(0), NOW);
    toggleBookmark(db, at(2), minutesAfter(10));
    toggleBookmark(db, at(1, other.id), minutesAfter(20));

    expect(listBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[2],
        lessonTitle: "Lesson 3",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
      expect.objectContaining({ lessonId: lessonIds[0] }),
    ]);
  });

  it("lists only the Student's own Notes, last edited first, with Lesson and Course", () => {
    const other = addStudent("Ben");
    saveNote(db, at(0), "Older", NOW);
    saveNote(db, at(1), "Newer", minutesAfter(10));
    saveNote(db, at(2, other.id), "Not mine", minutesAfter(20));
    saveNote(db, at(0), "Edited last", minutesAfter(30));

    expect(listNotes(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[0],
        body: "Edited last",
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
      expect.objectContaining({ lessonId: lessonIds[1], body: "Newer" }),
    ]);
  });
});
