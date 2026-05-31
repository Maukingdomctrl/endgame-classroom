/**
 * parsePgn.ts
 *
 * Converts a PGN string (single or multi-game) → RawLesson[]
 *
 * Supports:
 * - Single and multi-game PGN files
 * - Lecture mode (full game line) and puzzle mode (step-by-step hints)
 * - Variations stored per-step (shown as coach hints, not fully playable yet)
 * - Missing optional headers gracefully ignored
 * - Missing FEN falls back to standard starting position
 * - Comments used as coach narration in lecture mode
 */

import { parse as parsePgnLib } from "@mliebelt/pgn-parser";
// FIX: Updated import path to central moduleLoader to resolve TS2307
import type { RawLesson, LessonStep } from "../modules/moduleLoader";

const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ── Minimal types from @mliebelt/pgn-parser ──────────────────────────────────
interface PgnMove {
  turn:           "w" | "b";
  notation:       { notation: string };
  commentAfter?:  string | null;
  commentBefore?: string | null;
  variations?:    PgnMove[][];
  moveNumber?:    number | null;
}

interface PgnGame {
  tags:  Record<string, unknown>;
  moves: PgnMove[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function tag(game: PgnGame, key: string, fallback = ""): string {
  const v = game.tags[key];
  return typeof v === "string" ? v.trim() : fallback;
}

function toNumber(s: string, fallback: number): number {
  const n = Number(s);
  return isNaN(n) ? fallback : n;
}

function parseThemes(raw: string): string[] {
  return raw ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

function splitComment(comment: string | null | undefined): { hint: string; explanation: string } {
  if (!comment) return { hint: "", explanation: "" };
  const idx = comment.indexOf("|");
  if (idx === -1) return { hint: comment.trim(), explanation: comment.trim() };
  return { hint: comment.slice(0, idx).trim(), explanation: comment.slice(idx + 1).trim() };
}

// Extract variation moves as a readable string for coach display
function variationSummary(variations: PgnMove[][]): string {
  if (!variations?.length) return "";
  return variations.map((line) => {
    const moves = line.map((m) => m.notation?.notation).filter(Boolean).join(" ");
    const note  = line[0]?.commentAfter || line[0]?.commentBefore || "";
    return note ? `${moves} — ${note}` : moves;
  }).join("; ");
}

// ── Single game → RawLesson ───────────────────────────────────────────────────
function gameToLesson(game: PgnGame, fallbackIndex: number): RawLesson {
  const startFen        = tag(game, "FEN") || STANDARD_FEN;
  const id              = tag(game, "LessonId") || tag(game, "Event") || `lesson-${fallbackIndex + 1}`;
  const moduleId        = tag(game, "Module")   || "module-1";
  const title           = tag(game, "Title")    || tag(game, "Event") || `Lesson ${fallbackIndex + 1}`;
  const elo             = toNumber(tag(game, "Elo"), 800);
  const themes          = parseThemes(tag(game, "Theme"));
  const objective       = tag(game, "Objective");
  const intro           = tag(game, "Intro") || tag(game, "Description") || tag(game, "White") || "";
  const finalReflection = tag(game, "FinalReflection");
  const mastersNote     = tag(game, "MastersNote") || tag(game, "White");
  const mode            = (tag(game, "Mode") || "lecture").toLowerCase() as "lecture" | "puzzle" | "free";

  const rawSide  = tag(game, "SideToMove") || "white";
  const sideToMove: "white" | "black" = rawSide.toLowerCase() === "black" ? "black" : "white";
  
  // BUG-PP-2 Fix: Determine the student's color based on SideToMove
  const studentColor = sideToMove === "black" ? "b" : "w";

  const moves    = game.moves ?? [];
  const steps: LessonStep[] = [];

  let i = 0;
  while (i < moves.length) {
    const studentMove = moves[i];
    
    // BUG-PP-2 Fix: Compare against the actual student's color, not strictly "w"
    if (studentMove.turn !== studentColor) { 
      i++; 
      continue; 
    }

    const { hint, explanation } = splitComment(studentMove.commentAfter || studentMove.commentBefore);
    const varSummary = variationSummary(studentMove.variations ?? []);

    // BUG-PP-3 Fix: Use a newline '\n' instead of the pipe '|' to prevent splitComment collisions later
    const fullHint = [hint, varSummary ? `Variation: ${varSummary}` : ""].filter(Boolean).join("\n");

    const opponentMove = moves[i + 1];
    let opponentReply: LessonStep["opponentReply"] = null;

    if (opponentMove && opponentMove.turn !== studentColor) {
      const { explanation: replyNote } = splitComment(opponentMove.commentAfter || opponentMove.commentBefore);
      const replyVars = variationSummary(opponentMove.variations ?? []);
      opponentReply = {
        move:        opponentMove.notation.notation,
        explanation: [replyNote, replyVars ? `Variation: ${replyVars}` : ""].filter(Boolean).join(" ") || undefined,
      };
      i += 2;
    } else {
      i += 1;
    }

    steps.push({
      correctMove:  studentMove.notation.notation,
      hint:         fullHint   || undefined,
      explanation:  explanation || undefined,
      opponentReply,
    } as LessonStep);
  }

  if (steps.length === 0) {
    throw new Error(`No playable moves found in "${title}"`);
  }

  return {
    id,
    module:   moduleId,
    title,
    elo,
    theme:    themes,
    objective,
    intro,
    startFen,
    sideToMove,
    steps,
    mode,
    ...(finalReflection ? { finalReflection } : {}),
    ...(mastersNote     ? { mastersNote }     : {}),
  } as RawLesson;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse a single-game PGN string → one RawLesson */
export function parsePgn(pgnText: string): RawLesson {
  const game = parsePgnLib(pgnText.trim(), { startRule: "game" }) as PgnGame;
  return gameToLesson(game, 0);
}

/** Parse a multi-game PGN string → array of RawLesson (skips bad games) */
export function parseMultiPgn(pgnText: string): RawLesson[] {
  let games: PgnGame[];
  try {
    games = parsePgnLib(pgnText.trim(), { startRule: "games" }) as PgnGame[];
  } catch (err) {
    console.warn("[parsePgn] Failed to parse multi-game PGN:", (err as Error).message);
    return [];
  }

  return games.reduce<RawLesson[]>((acc, game, idx) => {
    try {
      acc.push(gameToLesson(game, idx));
    } catch (err) {
      console.warn(`[parsePgn] Skipping game ${idx + 1}:`, (err as Error).message);
    }
    return acc;
  }, []);
}