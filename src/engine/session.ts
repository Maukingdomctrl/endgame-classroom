/**
 * session.ts
 *
 * FIXES vs original:
 * 1. Opponent reply: stepIndex advances INSIDE the setTimeout, so React state
 *    reads the correct index after the delay. Previously stepIndex was set
 *    synchronously but the FEN update happened async — causing a one-step offset.
 * 2. tryMove returns the opponent-reply FEN in the result so App can update
 *    the board without a race condition.
 * 3. Cleaner mode typing.
 */

import { Chess } from "chess.js";
import type { RawLesson, LessonStep } from "../modules/module1/loader";

function normalizeFen(fen: string, overrideTurn?: "w" | "b"): string {
  const parts    = fen.trim().split(/\s+/);
  const board    = parts[0] ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const turn     = overrideTurn ?? parts[1] ?? "w";
  const castling = parts[2] ?? "-";
  const ep       = parts[3] ?? "-";
  const halfmove = parts[4] ?? "0";
  const fullmove = parts[5] ?? "1";
  return `${board} ${turn} ${castling} ${ep} ${halfmove} ${fullmove}`;
}

export interface MoveResult {
  ok:            boolean;
  feedback?:     string;
  finished?:     boolean;
  autoAdvance?:  boolean;
  correctMove?:  string;
  // opponent reply info — set when there is a reply queued
  hasReply?:     boolean;
  replyDelay?:   number;     // ms before reply fires
}

// Callback App uses to receive the opponent reply FEN + step
export type ReplyCallback = (fen: string, stepIndex: number) => void;

export class Session {
  lesson:                RawLesson;
  stepIndex:             number  = 0;
  game:                  Chess;
  awaitingOpponentReply: boolean = false;
  private replyTimer:    ReturnType<typeof setTimeout> | null = null;

  constructor(lesson: RawLesson) {
    this.lesson    = lesson;
    this.stepIndex = 0;
    this.game      = new Chess(normalizeFen(lesson.startFen ?? "4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
  }

  reset(): void {
    this.stepIndex             = 0;
    this.awaitingOpponentReply = false;
    if (this.replyTimer) { clearTimeout(this.replyTimer); this.replyTimer = null; }
    this.game = new Chess(normalizeFen(this.lesson.startFen ?? "4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
  }

  get currentStep(): LessonStep | null {
    return this.lesson?.steps?.[this.stepIndex] ?? null;
  }

  get mode(): "lecture" | "puzzle" | "free" {
    return (this.lesson as { mode?: "lecture" | "puzzle" | "free" }).mode ?? "puzzle";
  }

  isFinished(): boolean {
    return this.stepIndex >= (this.lesson?.steps?.length ?? 0);
  }

  /**
   * Try a move. Returns a MoveResult.
   * If hasReply is true, caller should call scheduleReply() with a callback.
   */
  tryMove(from: string, to: string): MoveResult {
    if (this.isFinished() || this.awaitingOpponentReply) {
      return { ok: false, feedback: "Not ready for a move." };
    }

    const step         = this.lesson.steps[this.stepIndex];
    const playerColor: "w" | "b"   = this.lesson.sideToMove === "black" ? "b" : "w";
    const opponentColor: "w" | "b" = playerColor === "w" ? "b" : "w";

    let game: Chess;
    try {
      game = new Chess(normalizeFen(this.game.fen(), playerColor));
    } catch {
      return { ok: false, feedback: "Corrupted board position." };
    }

    let move = null;
    try {
      move = game.move({ from, to, promotion: "q" });
    } catch { /* illegal */ }

    if (!move) {
      return { ok: false, feedback: "Illegal move." };
    }

    // ── Validate against expected ─────────────────────────────────────────────
    const rawExpected  = step.correctMove
      .replace(/[+#x=?!\s]/g, "")
      .replace(/[QRBNqrbn]$/, "");
    const expectedTo   = rawExpected.slice(-2).toLowerCase();
    const expectedFrom = (step as { from?: string }).from
      ? String((step as { from?: string }).from).toLowerCase()
      : null;
    const toMatches    = move.to.toLowerCase() === expectedTo;
    const fromMatches  = expectedFrom === null || move.from.toLowerCase() === expectedFrom;
    const isCorrect    = toMatches && fromMatches;

    // ── LECTURE MODE auto-correct ─────────────────────────────────────────────
    if (!isCorrect && this.mode === "lecture") {
      let correctedGame: Chess;
      try {
        correctedGame = new Chess(normalizeFen(this.game.fen(), playerColor));
        correctedGame.move(step.correctMove);
      } catch {
        return { ok: false, feedback: "Could not apply correction." };
      }

      this.game     = correctedGame;
      const nextIdx = this.stepIndex + 1;
      const isDone  = nextIdx >= this.lesson.steps.length;

      const coachMsg = step.hint
        ? `The correct move is ${step.correctMove}. ${step.hint}`
        : `The correct move is ${step.correctMove}.`;

      const hasReply = this._prepareReply(step, nextIdx, opponentColor, correctedGame.fen(), isDone);

      return {
        ok:          true,
        feedback:    coachMsg,
        finished:    isDone,
        autoAdvance: true,
        correctMove: step.correctMove,
        hasReply,
        replyDelay:  700,
      };
    }

    // ── PUZZLE MODE wrong move rejected ───────────────────────────────────────
    if (!isCorrect) {
      return { ok: false, feedback: "Not quite right. Try again." };
    }

    // ── Correct move ──────────────────────────────────────────────────────────
    this.game     = game;
    const nextIdx = this.stepIndex + 1;
    const isDone  = nextIdx >= this.lesson.steps.length;

    const hasReply = this._prepareReply(step, nextIdx, opponentColor, game.fen(), isDone);

    return {
      ok:          true,
      feedback:    step.explanation ?? step.hint ?? "Good move!",
      finished:    isDone,
      correctMove: step.correctMove,
      hasReply,
      replyDelay:  700,
    };
  }

  /**
   * Prepares (but does NOT schedule) the opponent reply.
   * Returns true if there is a reply to schedule.
   * App calls scheduleReply() with a callback to get the FEN update.
   */
  private _prepareReply(
    step:          LessonStep,
    nextIdx:       number,
    opponentColor: "w" | "b",
    playerFen:     string,
    isDone:        boolean,
  ): boolean {
    if (step.opponentReply && !isDone) {
      this.awaitingOpponentReply = true;
      // Store the reply context for scheduleReply()
      this._pendingReply = { step, nextIdx, opponentColor, playerFen };
      return true;
    }
    // No reply — advance immediately
    this.stepIndex = nextIdx;
    return false;
  }

  private _pendingReply: {
    step:          LessonStep;
    nextIdx:       number;
    opponentColor: "w" | "b";
    playerFen:     string;
  } | null = null;

  /**
   * Call this after tryMove if hasReply is true.
   * Schedules the opponent reply and calls back with the resulting FEN and stepIndex.
   */
  scheduleReply(delayMs: number, onReply: ReplyCallback): void {
    if (!this._pendingReply) return;
    const { step, nextIdx, opponentColor, playerFen } = this._pendingReply;
    this._pendingReply = null;

    this.replyTimer = setTimeout(() => {
      try {
        const opp     = step.opponentReply!;
        const oppGame = new Chess(normalizeFen(playerFen, opponentColor));
        if (opp.from && opp.to) {
          oppGame.move({ from: opp.from, to: opp.to, promotion: "q" });
        } else if (opp.move) {
          oppGame.move(opp.move);
        }
        this.game = oppGame;
      } catch (e) {
        console.warn(`[Session] Opponent reply failed:`, e);
      }
      this.stepIndex             = nextIdx;
      this.awaitingOpponentReply = false;
      onReply(this.game.fen(), this.stepIndex);
    }, delayMs);
  }
}
