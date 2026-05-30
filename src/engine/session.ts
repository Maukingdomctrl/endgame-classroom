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
  hasReply?:     boolean;
  replyDelay?:   number;
}

export type ReplyCallback = (fen: string, stepIndex: number) => void;

export class Session {
  lesson:                RawLesson;
  stepIndex:             number  = 0;
  game:                  Chess;
  awaitingOpponentReply: boolean = false;
  private replyTimer:    ReturnType<typeof setTimeout> | null = null;
  
  private _pendingReply: {
    step:          LessonStep;
    nextIdx:       number;
    playerFen:     string;
  } | null = null;

  constructor(lesson: RawLesson) {
    this.lesson    = lesson;
    this.stepIndex = 0;
    this.game      = new Chess(normalizeFen(lesson.startFen ?? "4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
  }

  reset(): void {
    this.stepIndex             = 0;
    this.awaitingOpponentReply = false;
    this._pendingReply         = null;
    if (this.replyTimer) { clearTimeout(this.replyTimer); this.replyTimer = null; }
    this.game = new Chess(normalizeFen(this.lesson.startFen ?? "4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
  }

  get currentStep(): LessonStep | null {
    // FIX BUG-SS-3: Safely bound check against length so it doesn't throw or return bad data when finished
    if (!this.lesson?.steps || this.stepIndex >= this.lesson.steps.length) {
      return null;
    }
    return this.lesson.steps[this.stepIndex];
  }

  get mode(): "lecture" | "puzzle" | "free" {
    return (this.lesson as { mode?: "lecture" | "puzzle" | "free" }).mode ?? "puzzle";
  }

  isFinished(): boolean {
    return this.stepIndex >= (this.lesson?.steps?.length ?? 0);
  }

  tryMove(from: string, to: string): MoveResult {
    if (this.isFinished() || this.awaitingOpponentReply) {
      return { ok: false, feedback: "Not ready for a move." };
    }

    const step = this.currentStep;
    if (!step) {
      return { ok: false, feedback: "No active step available." };
    }

    let game: Chess;
    try {
      // FIX BUG-SS-1: Stop overriding the turn color, use the natural fen state
      game = new Chess(this.game.fen());
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

    if (!isCorrect && this.mode === "lecture") {
      let correctedGame: Chess;
      try {
        // FIX BUG-SS-1: No override turn
        correctedGame = new Chess(this.game.fen());
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

      const hasReply = this._prepareReply(step, nextIdx, correctedGame.fen(), isDone);

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

    if (!isCorrect) {
      return { ok: false, feedback: "Not quite right. Try again." };
    }

    this.game     = game;
    const nextIdx = this.stepIndex + 1;
    const isDone  = nextIdx >= this.lesson.steps.length;

    const hasReply = this._prepareReply(step, nextIdx, game.fen(), isDone);

    return {
      ok:          true,
      feedback:    step.explanation ?? step.hint ?? "Good move!",
      finished:    isDone,
      correctMove: step.correctMove,
      hasReply,
      replyDelay:  700,
    };
  }

  private _prepareReply(
    step:      LessonStep,
    nextIdx:   number,
    playerFen: string,
    isDone:    boolean,
  ): boolean {
    if (step.opponentReply && !isDone) {
      this.awaitingOpponentReply = true;
      // FIX BUG-SS-4: Do not queue an opponentColor override. Save the natural FEN.
      this._pendingReply = { step, nextIdx, playerFen };
      return true;
    }
    this.stepIndex = nextIdx;
    return false;
  }

  scheduleReply(delayMs: number, onReply: ReplyCallback): void {
    // FIX BUG-SS-2: Early exit unlocks awaitingOpponentReply so game isn't permanently frozen
    if (!this._pendingReply) {
      this.awaitingOpponentReply = false;
      return;
    }
    
    const { step, nextIdx, playerFen } = this._pendingReply;
    this._pendingReply = null;

    this.replyTimer = setTimeout(() => {
      try {
        const opp = step.opponentReply!;
        
        // FIX BUG-SS-4: playerFen naturally contains the opponent's turn to move
        const oppGame = new Chess(playerFen);
        
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