/**
 * App.tsx — Endgame Classroom
 *
 * FIXES in this revision:
 * 1. sfPlayFenRef — useRef mirrors sfPlayFen state so onSfPieceDrop
 * always reads the live position (eliminates stale closure bug).
 * 2. onSfPieceDrop — reads ref, not state. Calls analyze() once after
 * playMove resolves with the final position (no double-search).
 * 3. startSfPlay — keeps ref in sync on mode entry. Use lesson.startFen, not fen.
 * 4. Default engine skill level raised to 20; slider range min clamped to 10.
 */
import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { Session } from "../engine/session";
import { module1 } from "../modules/module1/loader";
import { useStockfish } from "../engine/useStockfish";
import EvalBar, { EVAL_W, EVAL_GAP } from "../components/EvalBar";
import BoardEditor from "../components/BoardEditor";

const BOARD_BORDER = 12;
const FALLBACK_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

// ── Board ─────────────────────────────────────────────────────────────────────
function Board({ fen, boardSize, onPieceDrop, hintSquares = [] }: {
  fen: string; boardSize: number;
  onPieceDrop: (s: string, t: string) => boolean;
  hintSquares?: string[];
}) {
  const innerSize = boardSize - BOARD_BORDER * 2;
  const squareStyles: Record<string, CSSProperties> = {};
  hintSquares.forEach((sq, i) => {
    squareStyles[sq] = {
      backgroundColor: i === 0 ? "rgba(255,200,80,0.6)" : "rgba(100,210,130,0.6)",
      transition: "background-color 0.3s ease",
    };
  });
  return (
    <div style={{ width: boardSize, height: boardSize, border: `${BOARD_BORDER}px solid #26211a`, boxSizing: "border-box", flexShrink: 0, overflow: "hidden", outline: "1px solid #ebdcb9", boxShadow: "0 16px 36px rgba(0,0,0,0.9)" }}>
      <Chessboard position={fen} onPieceDrop={onPieceDrop} boardWidth={innerSize}
        customBoardStyle={{ borderRadius: 0 }}
        customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
        customDarkSquareStyle={{ backgroundColor: "#403425" }}
        customSquareStyles={squareStyles} animationDuration={300} />
    </div>
  );
}

// ── HintPopup ─────────────────────────────────────────────────────────────────
function HintPopup({ hint, explanation, onClose }: { hint: string; explanation: string; onClose: () => void }) {
  return (
    <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 20, background: "#1a1510", border: "1px solid #a69272", boxShadow: "0 8px 32px rgba(0,0,0,0.95)", padding: "14px 18px", maxWidth: 380, width: "90vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: "bold", color: "#8c7e6b", letterSpacing: "1px", textTransform: "uppercase", fontFamily: "Georgia, serif" }}>💡 Coach Hint</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#6b5e4c", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
      </div>
      <p style={{ margin: 0, color: "#d9cb9e", fontSize: 14, fontFamily: "Georgia, serif", lineHeight: "1.5" }}>{hint || "Study the position carefully."}</p>
      {explanation && explanation !== hint && (
        <p style={{ margin: "8px 0 0", color: "#a3b39c", fontSize: 13, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: "1.4" }}>{explanation}</p>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [boardSize, setBoardSize]     = useState(560);
  const [isStacked, setIsStacked]     = useState(false);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [tick, setTick]               = useState(0);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [editorOpen, setEditorOpen]   = useState(false);

  const [sfPlayMode, setSfPlayMode]     = useState(false);
  const [sfSkillLevel, setSfSkillLevel] = useState(20); // ← Raised default level to 20
  const [sfPlayFen, setSfPlayFen]       = useState(FALLBACK_FEN);
  const [sfWaiting, setSfWaiting]       = useState(false);

  // ── FIX 1: ref mirrors sfPlayFen so onSfPieceDrop never reads stale state
  const sfPlayFenRef = useRef(FALLBACK_FEN);

  const lesson = useMemo(() => {
    return module1?.lessons?.[lessonIndex] || {
      id: "m1-0001", module: "module-1", title: "Untitled Lesson",
      elo: 800, theme: [], intro: "No lessons loaded.", objective: "", steps: [], mode: "puzzle" as const,
    };
  }, [lessonIndex]);

  const lessonMode  = (lesson as { mode?: string }).mode ?? "puzzle";
  const mastersNote = (lesson as { mastersNote?: string }).mastersNote;

  const [fen, setFen]                           = useState(() => lesson?.startFen || FALLBACK_FEN);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [coachSays, setCoachSays]               = useState("Study the position. Make your move.");
  const [feedback, setFeedback]                 = useState<{ text: string; ok: boolean } | null>(null);
  const [finished, setFinished]                 = useState(false);
  const [showHint, setShowHint]                 = useState(false);
  const [hintLoading, setHintLoading]           = useState(false);
  const [drawingMode, setDrawingMode]           = useState(false);
  const [tool, setTool]                         = useState<"pen" | "eraser">("pen");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [history, setHistory] = useState<Array<{ fen: string; step: number }>>([
    { fen: lesson?.startFen || FALLBACK_FEN, step: 0 }
  ]);

  const sessionRef = useRef<Session | null>(null);
  if (!sessionRef.current || sessionRef.current.lesson.id !== lesson.id) {
    sessionRef.current = new Session(lesson);
  }
  const activeSession = sessionRef.current;

  const { ready, analyze, playMove, getHint, bar, cp, mate, hintSquares } = useStockfish(
    sfPlayFen, true, 16
  );

  useEffect(() => {
    if (!lesson) return;
    sessionRef.current = new Session(lesson);
    activeSession.reset?.();
    const startFen = lesson.startFen || FALLBACK_FEN;
    setFen(startFen);
    setCurrentStepIndex(0);
    setHistory([{ fen: startFen, step: 0 }]);
    setFeedback(null);
    setFinished(false);
    setShowHint(false);
    setSfPlayMode(false);
    setCoachSays(lessonMode === "lecture"
      ? "Follow the demonstration. Play each move on the board."
      : "Study the position. Make your move.");
  }, [lessonIndex, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function resize() {
      const windowW = window.innerWidth;
      const windowH = window.innerHeight;
      const stack   = windowW < 1120;
      setIsStacked(stack);
      const maxByH = windowH - 190;
      let target   = 560;
      if (stack) {
        target = Math.min(windowW - 60, maxByH, 620);
      } else {
        const maxByW = Math.floor((windowW - EVAL_W - EVAL_GAP - 88) * 0.58);
        target = Math.min(maxByH, maxByW, 640);
      }
      setBoardSize(Math.max(target, 460));
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function loadLesson(i: number) {
    if (!module1?.lessons || i < 0 || i >= module1.lessons.length) return;
    setLessonIndex(i);
    setTick((t) => t + 1);
  }

  function stepBack() {
    if (history.length <= 1 || activeSession.awaitingOpponentReply) return;
    const next = [...history];
    next.pop();
    const t = next[next.length - 1];
    if (!t) return;
    activeSession.game.load(t.fen);
    activeSession.stepIndex = t.step;
    setHistory(next);
    setFen(t.fen);
    setCurrentStepIndex(t.step);
    setFeedback(null);
    setFinished(false);
    setShowHint(false);
  }

  function onPieceDrop(src: string, tgt: string): boolean {
    if (finished || activeSession.awaitingOpponentReply) return false;
    const res = activeSession.tryMove(src, tgt);
    if (!res.ok) {
      const txt = res.feedback ?? "Try again.";
      setFeedback({ text: txt, ok: false });
      setCoachSays(txt);
      return false;
    }
    const wFen   = activeSession.game.fen();
    const midIdx = activeSession.stepIndex;
    setFen(wFen);
    setCurrentStepIndex(midIdx);
    setFeedback({ text: res.feedback!, ok: true });
    setCoachSays(res.feedback!);
    setShowHint(false);
    setHistory((p) => [...p, { fen: wFen, step: midIdx }]);
    if (res.finished) { setFinished(true); return true; }
    if (res.hasReply) {
      activeSession.scheduleReply(res.replyDelay ?? 700, (replyFen, replyStep) => {
        setFen(replyFen);
        setCurrentStepIndex(replyStep);
        setHistory((p) => [...p, { fen: replyFen, step: replyStep }]);
        if (res.autoAdvance) setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration.");
      });
    } else if (res.autoAdvance) {
      setTimeout(() => setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration."), 1200);
    }
    return true;
  }

  // ── FIX 1: startSfPlay uses lesson.startFen ─────────────────────────────────
  function startSfPlay() {
    const startingFen = lesson.startFen || FALLBACK_FEN; // ← Uses lesson.startFen instead of mid-lesson fen state
    setSfPlayFen(startingFen);
    sfPlayFenRef.current = startingFen;         // ← sync ref
    setSfPlayMode(true);
    setCoachSays(`Playing vs Stockfish — Skill Level ${sfSkillLevel}`);
    if (ready) analyze(startingFen, 16);
  }

  // ── FIX 3: onSfPieceDrop reads ref, single analyze after move resolves ───
  async function onSfPieceDrop(src: string, tgt: string): Promise<boolean> {
    if (sfWaiting) return false;
    try {
      // Read the live FEN from the ref — never stale even mid-render-cycle
      const g    = new Chess(sfPlayFenRef.current);
      const move = g.move({ from: src, to: tgt, promotion: "q" });
      if (!move) return false;

      const afterPlayer = g.fen();
      setSfPlayFen(afterPlayer);
      sfPlayFenRef.current = afterPlayer;       // ← sync ref

      if (g.isGameOver()) {
        setCoachSays(g.isCheckmate() ? "Checkmate! Well played." : "Game over.");
        analyze(afterPlayer, 16);
        return true;
      }

      setSfWaiting(true);
      setCoachSays("Stockfish is thinking…");

      // playMove: engine searches 1500ms and resolves with the best move.
      // We do NOT call analyze() before this — no double-search.
      const bestMove = await playMove(afterPlayer, sfSkillLevel);

      if (bestMove && bestMove.length >= 4) {
        g.move({
          from:      bestMove.slice(0, 2),
          to:        bestMove.slice(2, 4),
          promotion: bestMove[4] ?? "q",
        });
        const afterEngine = g.fen();

        setSfPlayFen(afterEngine);
        sfPlayFenRef.current = afterEngine;     // ← sync ref
        setSfWaiting(false);

        if (g.isGameOver()) {
          setCoachSays(g.isCheckmate() ? "Stockfish delivers checkmate." : "Game over.");
        } else {
          setCoachSays("Your turn.");
        }

        // Single clean analyze of the position the player now faces.
        // Engine is idle (playMove just resolved from bestmove), so this
        // executes immediately. The bar updates exactly once with the result.
        analyze(afterEngine, 16);
      } else {
        setSfWaiting(false);
      }

      return true;
    } catch {
      setSfWaiting(false);
      return false;
    }
  }

  async function handleHintClick() {
    if (showHint) { setShowHint(false); return; }
    setShowHint(true);
    if (ready && lessonMode === "puzzle" && !finished) {
      setHintLoading(true);
      try { await getHint(fen); }
      finally { setHintLoading(false); }
    }
  }

  function clearCanvas() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  const safeThemes      = Array.isArray(lesson?.theme) ? lesson.theme : [];
  const safeSteps       = Array.isArray(lesson?.steps) ? lesson.steps : [];
  const totalLeftBlockW = boardSize + EVAL_W + EVAL_GAP;
  const wbW             = isStacked ? boardSize : Math.min(Math.round(boardSize * 0.76), 440);
  const wbH             = boardSize + 56;
  const currentStep     = activeSession.currentStep;
  const liveHint        = currentStep?.hint ?? (lessonMode === "lecture" ? "Play the next move." : "Find the best move.");
  const liveExplanation = currentStep?.explanation ?? "";
  const editorFilename  = `${String(lessonIndex + 1).padStart(4, "0")}-${lesson.id}`;
  const activeDropHandler = sfPlayMode
    ? (src: string, tgt: string) => { onSfPieceDrop(src, tgt); return true; }
    : onPieceDrop;

  return (
    <div style={S.page}>
      <button style={S.hamburger} onClick={() => setMenuOpen((m) => !m)}>
        {menuOpen ? "✕ Close" : "☰ Index"}
      </button>

      <div style={{ ...S.sidebar, transform: menuOpen ? "translateX(0)" : "translateX(-100%)" }}>
        <div style={S.sidebarHead}>
          <h3 style={S.sidebarTitle}>Curriculum Hub</h3>
          <p style={S.sidebarSub}>All Modules & Lessons</p>
        </div>
        <div style={S.sidebarBody}>
          <div style={{ fontSize: 11, fontWeight: "bold", color: "#595043", textTransform: "uppercase", letterSpacing: "1.5px", padding: "6px 8px", fontFamily: "Georgia, serif" }}>
            📁 {module1?.title || "Module 1"}
          </div>
          {module1?.lessons?.map((les: { id?: string; title: string; elo?: number }, idx: number) => {
            const active = idx === lessonIndex;
            return (
              <button key={`${les.id || "lesson"}-${idx}`} onClick={() => { loadLesson(idx); setMenuOpen(false); }}
                style={{ ...S.lessonBtn, backgroundColor: active ? "#2b231a" : "transparent", color: active ? "#c4b293" : "#6b5e4c", fontWeight: active ? "bold" : "normal", borderLeft: active ? "2px solid #a69272" : "2px solid transparent" }}>
                <span style={{ opacity: 0.6, marginRight: 6 }}>{String(idx + 1).padStart(2, "0")}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{les.title}</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>{les.elo ?? 800}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={S.mainContainer}>
        <div style={S.vintageHeaderBlock}>
          <div style={S.headerTopBorder} />
          <h1 style={S.centeredTitle}>Endgame Classroom</h1>
          <div style={S.headerSubtitleRow}>
            <span style={S.headerEst}>LONDON • NEW YORK • VIENNA</span>
            <span style={S.headerOrnament}>❖</span>
            <span style={S.headerEst}>ESTABLISHED 1886</span>
          </div>
          <div style={S.headerBottomBorder} />
        </div>

        <div style={{ ...S.headerRow, flexDirection: isStacked ? "column" : "row", alignItems: "center", gap: isStacked ? 10 : 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <span style={S.badge}>{lesson?.elo ?? 800} ELO</span>
            <span style={{ ...S.badge, color: lessonMode === "lecture" ? "#a3b39c" : "#c4b293" }}>
              {lessonMode === "lecture" ? "📖 Lecture" : lessonMode === "free" ? "♟ Free" : "🎯 Puzzle"}
            </span>
            {safeThemes.slice(0, 2).map((t: string) => <span key={t} style={S.themeBadge}>{t}</span>)}
          </div>

          {!finished && !sfPlayMode && currentStep && (
            <div style={S.integratedTaskArea}>
              <span style={S.taskPrefixLabel}>{lessonMode === "lecture" ? "DEMONSTRATION" : "ASSIGNMENT"} • STEP {currentStepIndex + 1}:</span>
              <span style={S.taskInlineContent}>{liveHint}</span>
            </div>
          )}
          {sfPlayMode && (
            <div style={S.integratedTaskArea}>
              <span style={S.taskPrefixLabel}>VS STOCKFISH — SKILL {sfSkillLevel}:</span>
              <span style={S.taskInlineContent}>{sfWaiting ? "Engine thinking…" : "Your move"}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <button style={{ ...S.toolBtn, ...(editorOpen ? S.toolActive : S.editInactive) }}
              onClick={() => { setEditorOpen((o) => !o); if (drawingMode) setDrawingMode(false); }}>✒ Edit</button>
            <button style={{ ...S.toolBtn, ...(drawingMode ? S.toolActive : {}) }}
              onClick={() => { setDrawingMode((d) => !d); if (editorOpen) setEditorOpen(false); }}>✒ Draw</button>
            {drawingMode && (
              <>
                <button style={{ ...S.toolBtn, ...(tool === "eraser" ? S.toolActive : {}) }} onClick={() => setTool("eraser")}>◻</button>
                <button style={{ ...S.toolBtn, ...(tool === "pen" ? S.toolActive : {}) }} onClick={() => setTool("pen")}>✏</button>
                <button style={S.toolBtn} onClick={clearCanvas}>✕</button>
              </>
            )}
            {!sfPlayMode && (
              <button style={{ ...S.toolBtn, ...(showHint ? S.toolActive : {}), opacity: hintLoading ? 0.6 : 1 }}
                onClick={handleHintClick} disabled={hintLoading}>
                {hintLoading ? "⏳" : "💡"} Hint
              </button>
            )}
          </div>
        </div>

        <div style={{ ...S.cols, flexDirection: isStacked ? "column" : "row", alignItems: isStacked ? "center" : "stretch", gap: isStacked ? 20 : 48 }}>
          <div style={{ ...S.leftCol, position: "relative" }}>
            {showHint && !sfPlayMode && currentStep && (
              <HintPopup hint={liveHint} explanation={liveExplanation} onClose={() => setShowHint(false)} />
            )}

            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
              {sfPlayMode
                ? <EvalBar bar={bar} cp={cp} mate={mate} size={boardSize} />
                : <div style={{ width: EVAL_W, marginRight: EVAL_GAP, flexShrink: 0 }} />
              }
              <Board
                fen={sfPlayMode ? sfPlayFen : fen}
                boardSize={boardSize}
                onPieceDrop={activeDropHandler}
                hintSquares={hintSquares}
              />
            </div>

            <div style={{ width: totalLeftBlockW, padding: "8px 12px", boxSizing: "border-box", background: "#1c1712", border: "1px solid #362f25", borderLeft: `3px solid ${feedback?.ok ? "#56664d" : feedback ? "#824b4b" : "#736451"}`, textAlign: "center" }}>
              <span style={{ color: feedback?.ok ? "#a3b899" : feedback ? "#cc9999" : "#bdae99", fontSize: 13, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
                {coachSays}
              </span>
            </div>

            {!sfPlayMode ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, width: totalLeftBlockW }}>
                  <button style={S.btn} onClick={stepBack} disabled={history.length <= 1 || activeSession.awaitingOpponentReply}>⌥ Back</button>
                  <span style={{ fontSize: 11, color: "#7a6e5d", textAlign: "center", minWidth: 80, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
                    Step {currentStepIndex + 1} of {safeSteps.length || 1}
                  </span>
                  <button style={S.btn} onClick={() => loadLesson(lessonIndex)}>⟳ Reset</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, width: totalLeftBlockW }}>
                  <button style={S.navBtn} onClick={() => loadLesson(lessonIndex - 1)} disabled={lessonIndex === 0}>← Prev</button>
                  <span style={{ fontSize: 11, color: "#8c7e6b", fontFamily: "Georgia, serif" }}>{lessonIndex + 1} / {module1?.lessons?.length || 1}</span>
                  <button style={S.navBtn} onClick={() => loadLesson(lessonIndex + 1)} disabled={!module1?.lessons || lessonIndex === module1.lessons.length - 1}>Next →</button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: totalLeftBlockW }}>
                <button style={S.btn} onClick={() => { setSfPlayMode(false); setCoachSays("Study the position. Make your move."); }}>← Back to Lesson</button>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#8c7e6b", fontFamily: "Georgia, serif" }}>Skill:</span>
                  <input type="range" min={10} max={20} value={sfSkillLevel} // ← Adjusted min={10} on the skill level slider
                    onChange={(e) => setSfSkillLevel(Number(e.target.value))}
                    style={{ width: 80, accentColor: "#a69272" }} />
                  <span style={{ fontSize: 11, color: "#c4b293", minWidth: 20, fontFamily: "Georgia, serif" }}>{sfSkillLevel}</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ ...S.rightCol, width: wbW }}>
            <div style={{ ...S.paper, width: wbW, height: isStacked ? "auto" : wbH }}>
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(transparent,transparent 27px,#d1c2a5 27px,#d1c2a5 28px)", backgroundPositionY: "44px", opacity: 0.25, zIndex: 0 }} />
              <div style={{ position: "relative", padding: "20px 24px 24px 24px", display: "flex", flexDirection: "column", gap: 12, zIndex: 1, boxSizing: "border-box" }}>
                <div style={{ fontSize: 22, fontWeight: "bold", color: "#211a12", fontFamily: "Georgia, serif", borderBottom: "1px solid #c4b293", paddingBottom: 2 }}>{lesson.title}</div>
                <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 11, margin: "-4px 0" }}>❖ ❖ ❖</div>
                {mastersNote && <div style={{ fontSize: 11, color: "#7a6e5d", fontStyle: "italic", fontFamily: "Georgia, serif" }}>— {mastersNote}</div>}
                {lesson.intro && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={S.wbLabel}>Introduction</span>
                    <p style={{ fontSize: 14, color: "#2b2118", margin: 0, lineHeight: "20px", fontFamily: "Georgia, serif" }}>{lesson.intro}</p>
                  </div>
                )}
                {lesson.objective && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={S.wbLabel}>Objective</span>
                    <p style={{ fontSize: 14, color: "#2b2118", margin: 0, lineHeight: "20px", fontFamily: "Georgia, serif" }}>{lesson.objective}</p>
                  </div>
                )}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingTop: 2 }}>
                  {safeSteps.map((_, i: number) => (
                    <div key={i} style={{ width: 6, height: 6, background: i < currentStepIndex ? "#4a5743" : i === currentStepIndex ? "#8c795c" : "#d1c4b0", outline: "1px solid #7a6b54" }} />
                  ))}
                </div>
                {finished && !sfPlayMode && (
                  <>
                    <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 11 }}>❖</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={S.wbLabel}>Reflection</span>
                      <p style={{ fontSize: 14, color: "#2b2118", margin: 0, lineHeight: "20px", fontFamily: "Georgia, serif" }}>
                        {(lesson as { finalReflection?: string }).finalReflection || "Lesson completed successfully."}
                      </p>
                    </div>
                    <button style={S.sfBtn} onClick={startSfPlay}>♟ Play vs Stockfish from this position</button>
                    {module1?.lessons && lessonIndex < module1.lessons.length - 1 && (
                      <button style={S.nextBtn} onClick={() => loadLesson(lessonIndex + 1)}>Accept & Continue →</button>
                    )}
                  </>
                )}
                {!finished && lessonMode === "lecture" && !sfPlayMode && (
                  <button style={{ ...S.sfBtn, marginTop: 4 }} onClick={startSfPlay}>♟ Play from this position</button>
                )}
              </div>
              <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 2, width: "100%", height: "100%", touchAction: "none", cursor: drawingMode ? "crosshair" : "default", opacity: drawingMode ? 0.8 : 0.4, pointerEvents: drawingMode ? "auto" : "none" }} />
            </div>
          </div>
        </div>

        {editorOpen && (
          <BoardEditor lesson={lesson} moduleId={lesson.module || "module-1"} filename={editorFilename}
            onClose={() => setEditorOpen(false)}
            onSaved={(updated) => {
              if (sessionRef.current) sessionRef.current.lesson = updated;
              setTick((t) => t + 1);
              setEditorOpen(false);
            }} />
        )}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page:               { display: "flex", flexDirection: "row", gap: 24, justifyContent: "center", alignItems: "flex-start", height: "100dvh", background: "#14110e", padding: "20px 20px 32px 20px", boxSizing: "border-box", overflowY: "auto", overflowX: "hidden", fontFamily: "Georgia, serif" },
  mainContainer:      { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 12, width: "100%", maxWidth: 1160, minHeight: "max-content" },
  vintageHeaderBlock: { display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 1160, textAlign: "center", marginBottom: 0 },
  headerTopBorder:    { width: "100%", height: "3px", borderTop: "1px solid #594e3f", borderBottom: "1px solid #594e3f", marginBottom: 4 },
  centeredTitle:      { margin: 0, fontSize: 28, fontWeight: "400", color: "#d9cbb0", fontFamily: "Georgia, serif", letterSpacing: "3px", textTransform: "uppercase", lineHeight: 1.0 },
  headerSubtitleRow:  { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 2, marginBottom: 4 },
  headerEst:          { fontSize: 10, color: "#8c7e6b", letterSpacing: "2px", fontFamily: "Georgia, serif" },
  headerOrnament:     { color: "#594e3f", fontSize: 8 },
  headerBottomBorder: { width: "100%", height: "1px", background: "#362f25" },
  headerRow:          { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 1160, paddingBottom: 4 },
  integratedTaskArea: { flex: 1, textAlign: "center", padding: "0 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontFamily: "Georgia, serif" },
  taskPrefixLabel:    { fontSize: 11, fontWeight: "bold", color: "#8c7e6b", letterSpacing: "0.5px", marginRight: 6 },
  taskInlineContent:  { color: "#d9cb9e" },
  hamburger:          { position: "fixed", top: 12, left: 12, background: "#1c1712", border: "1px solid #4a3f31", borderRadius: 0, color: "#b0a28f", fontSize: 11, padding: "5px 10px", cursor: "pointer", zIndex: 10, fontFamily: "Georgia, serif", letterSpacing: "1px", textTransform: "uppercase" },
  sidebar:            { position: "fixed", top: 0, left: 0, width: 280, height: "100vh", background: "#120f0d", borderRight: "1px solid #2e261f", zIndex: 9, display: "flex", flexDirection: "column", transition: "transform 0.3s ease", boxShadow: "12px 0 32px rgba(0,0,0,0.9)" },
  sidebarHead:        { padding: "64px 18px 14px", borderBottom: "1px solid #211b16", background: "#0a0807" },
  sidebarTitle:       { margin: 0, fontSize: 18, color: "#d9cb9e", fontFamily: "Georgia, serif", fontWeight: "normal" },
  sidebarSub:         { margin: "2px 0 0", fontSize: 11, color: "#6e6252", fontStyle: "italic" },
  sidebarBody:        { flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 1 },
  lessonBtn:          { display: "flex", alignItems: "center", width: "100%", border: "none", padding: "8px 10px", textAlign: "left", fontSize: 13, cursor: "pointer", borderRadius: 0, gap: 0, fontFamily: "inherit" },
  cols:               { display: "flex", justifyContent: "center", gap: 48, width: "100%", maxWidth: 1160, minHeight: "max-content" },
  leftCol:            { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 },
  rightCol:           { display: "flex", flexDirection: "column", flexShrink: 0 },
  btn:                { flex: 1, background: "#1c1712", border: "1px solid #362f25", borderRadius: 0, color: "#bdae99", fontSize: 11, padding: "2px 8px", lineHeight: "12px", fontFamily: "Georgia, serif", cursor: "pointer" },
  navBtn:             { background: "#14110e", border: "1px solid #2e261f", borderRadius: 0, color: "#a69272", fontSize: 11, padding: "2px 10px", lineHeight: "12px", fontFamily: "Georgia, serif", cursor: "pointer" },
  badge:              { fontSize: 11, color: "#d9cb9e", background: "#1c1712", border: "1px solid #362f25", borderRadius: 0, padding: "3px 8px", fontFamily: "Georgia, serif" },
  themeBadge:         { fontSize: 11, color: "#8fa388", background: "#141712", border: "1px solid #262e22", borderRadius: 0, padding: "3px 8px", fontFamily: "Georgia, serif" },
  toolBtn:            { background: "#1c1712", border: "1px solid #362f25", borderRadius: 0, color: "#ad9e87", fontSize: 11, padding: "5px 10px", fontFamily: "Georgia, serif", cursor: "pointer" },
  toolActive:         { background: "#2e261f", color: "#f2e6cf", border: "1px solid #594e3f" },
  editInactive:       { background: "#182418", color: "#7cb37c", border: "1px solid #273d27" },
  paper:              { position: "relative", background: "#ebdcb9", borderRadius: 0, border: "12px solid #26211a", outline: "1px solid #ebdcb9", boxShadow: "0 16px 36px rgba(0,0,0,0.9)", overflow: "hidden" },
  wbLabel:            { fontSize: 10, fontWeight: "bold", color: "#4d3f31", letterSpacing: "1px", textTransform: "uppercase", fontFamily: "Georgia, serif" },
  nextBtn:            { background: "#2d3b28", border: "1px solid #41543b", borderRadius: 0, color: "#cadbc3", fontSize: 12, padding: "6px 12px", fontFamily: "Georgia, serif", cursor: "pointer", marginTop: 2 },
  sfBtn:              { background: "#1a1f2e", border: "1px solid #2e3f5e", borderRadius: 0, color: "#8aadcc", fontSize: 12, padding: "6px 12px", fontFamily: "Georgia, serif", cursor: "pointer", marginTop: 4 },
};