/**
 * loader.ts
 *
 * Loads all *.pgn files from the module folder.
 * FIX: Changed `as: 'raw'` to `query: '?raw', import: 'default'`
 *      (the `as` option was deprecated in Vite 5+)
 */

import { parsePgn, parseMultiPgn } from "../../engine/parsePgn";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LessonStep = {
  correctMove:   string;
  from?:         string;
  hint?:         string;
  explanation?:  string;
  mode?:         "lecture" | "puzzle" | "free";
  incorrectResponses?: { move: string; response: string }[];
  opponentReply?: {
    from?:        string;
    to?:          string;
    move:         string;
    explanation?: string;
  } | null;
};

export type RawLesson = {
  id:               string;
  module:           string;
  title:            string;
  elo:              number;
  theme:            string[];
  objective:        string;
  intro:            string;
  startFen:         string;
  sideToMove:       "white" | "black";
  steps:            LessonStep[];
  mode?:            "lecture" | "puzzle" | "free";
  finalReflection?: string;
  mastersNote?:     string;
};

// ── Load PGN files ─────────────────────────────────────────────────────────
// FIX: use query + import instead of deprecated `as: 'raw'`
const pgnFiles = import.meta.glob("./*.pgn", {
  query:  "?raw",
  import: "default",
  eager:  true,
}) as Record<string, string>;

const lessons: RawLesson[] = Object.keys(pgnFiles)
  .sort()
  .reduce<RawLesson[]>((acc, path) => {
    const raw = pgnFiles[path];
    if (!raw) return acc;
    try {
      const multi = parseMultiPgn(raw);
      if (multi.length > 0) {
        acc.push(...multi);
      } else {
        acc.push(parsePgn(raw));
      }
    } catch (err) {
      console.warn(`[loader] Skipping ${path}:`, (err as Error).message);
    }
    return acc;
  }, []);

// ── Legacy JSON fallback ───────────────────────────────────────────────────
const jsonFiles = import.meta.glob("./*.json", { eager: true }) as Record<string, { default?: RawLesson } & RawLesson>;

const jsonLessons: RawLesson[] = Object.keys(jsonFiles)
  .sort()
  .map((k) => (jsonFiles[k].default ?? jsonFiles[k]) as RawLesson);

export const module1 = {
  id:          "module-1",
  title:       "Endgame Fundamentals",
  description: "Essential endgame patterns from 800 to 1200 ELO.",
  lessons:     lessons.length > 0 ? lessons : jsonLessons,
};
