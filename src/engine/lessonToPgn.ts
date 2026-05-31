/**
 * lessonToPgn.ts
 *
 * Converts a RawLesson object back to a formatted PGN string.
 * Used by the editor to save changes back to .pgn files.
 */

import type { RawLesson } from "../modules/moduleLoader";

function escapeTag(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tag(key: string, value: string | number | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  return `[${key} "${escapeTag(String(value))}"]`;
}

export function lessonToPgn(lesson: RawLesson): string {
  const lines: string[] = [];

  // ── Headers ────────────────────────────────────────────────────────────────
  lines.push(tag("Event",           "Endgame Classroom"));
  lines.push(tag("Module",          lesson.module));
  lines.push(tag("LessonId",        lesson.id));
  lines.push(tag("Title",           lesson.title));
  lines.push(tag("Elo",             lesson.elo));
  lines.push(tag("Theme",           lesson.theme?.join(", ")));
  lines.push(tag("Objective",       lesson.objective));
  lines.push(tag("Intro",           lesson.intro));
  if (lesson.finalReflection) lines.push(tag("FinalReflection", lesson.finalReflection));
  if (lesson.mastersNote)     lines.push(tag("MastersNote",     lesson.mastersNote));
  lines.push(tag("Site",            "?"));
  lines.push(tag("Date",            "????.??.??"));
  lines.push(tag("White",           "Student"));
  lines.push(tag("Black",           "Opponent"));
  lines.push(tag("Result",          "*"));
  lines.push(tag("FEN",             lesson.startFen));
  lines.push(tag("SetUp",           "1"));
  lines.push(tag("SideToMove",      lesson.sideToMove));
  lines.push(""); // blank line before moves

  // ── Moves ──────────────────────────────────────────────────────────────────
  const moveParts: string[] = [];

  lesson.steps.forEach((step, idx) => {
    const moveNum = idx + 1;
    let moveLine = `${moveNum}. ${step.correctMove}`;

    // Build comment: {hint|explanation}
    const hint        = step.hint?.trim()        ?? "";
    const explanation = step.explanation?.trim() ?? "";

    if (hint || explanation) {
      if (hint === explanation || !explanation) {
        moveLine += ` {${hint}}`;
      } else if (!hint) {
        moveLine += ` {${explanation}}`;
      } else {
        moveLine += ` {${hint}|${explanation}}`;
      }
    }

    // Opponent reply
    if (step.opponentReply) {
      const reply      = step.opponentReply;
      const replyMove  = reply.move;
      let replyLine    = ` ${replyMove}`;
      if (reply.explanation) replyLine += ` {${reply.explanation}}`;
      moveLine += replyLine;
    }

    moveParts.push(moveLine);
  });

  lines.push(moveParts.join("\n"));
  lines.push("*");

  return lines.filter((l) => l !== "").join("\n");
}