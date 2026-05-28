export interface LessonStep {
  correctMove: string;
  hint?: string;
  explanation?: string;
  from?: string;
  to?: string;
  opponentReply?: {
    from?: string;
    to?: string;
    move: string;
    explanation?: string;
  } | null;
}

export interface ChessLesson {
  id: string;
  module: string;
  title: string;
  elo: number;
  theme: string[];
  objective: string;
  intro: string;
  startFen: string;
  sideToMove: "white" | "black";
  steps: LessonStep[];
  finalReflection?: string;
  mastersNote?: string;
}

export class HintEngine {
  static getCurrentStepData(
    lesson: ChessLesson | null,
    stepIndex: number
  ): { hint: string; explanation: string } {
    const fallback = {
      hint: "Study the board closely and find the best move.",
      explanation: "No annotation available for this step.",
    };

    if (!lesson?.steps?.[stepIndex]) return fallback;

    const step = lesson.steps[stepIndex];
    return {
      hint:        step.hint        || fallback.hint,
      explanation: step.explanation || fallback.explanation,
    };
  }
}
