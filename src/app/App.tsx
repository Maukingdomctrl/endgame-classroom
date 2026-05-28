/**
 * App.tsx — Endgame Classroom
 *
 * KEY FIXES vs original:
 * 1. useStockfish receives `enabled` flag — only activates during SF play mode
 * 2. Session.scheduleReply() replaces raw setTimeout for opponent moves
 * — fixes the FEN/stepIndex desync
 * 3. Hint button shows PGN comment (hint field from parsePgn)
 * 4. After completing a lesson, "Play vs Stockfish" button appears
 * 5. Board editor Save properly calls sync server
 * 6. analyze(fen) moved to a useEffect gated by the engine's ready state
 */

import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { Session } from "../engine/session";
import { module1 } from "../modules/module1/loader";
import { useStockfish } from "../engine/useStockfish";
import BoardEditor from "../components/BoardEditor";

const BOARD_BORDER = 12;
const EVAL_W       = 16;
const EVAL_GAP     = 12;
const FALLBACK_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

// ── EvalBar ───────────────────────────────────────────────────────────────────
function EvalBar({ bar, cp, mate, size }: { bar: number; cp: number | null; mate: number | null; size: number }) {
  const pct = Math.round(((bar + 5) / 10) * 100);
  let label: string;
  if (mate !== null)     label = mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  else if (cp !== null)  label = (cp / 100) > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1);
  else                   label = "0.0";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: EVAL_W, height: size, flexShrink: 0, marginRight: EVAL_GAP }}>
      <div style={{ width: "100%", flex: 1, border: "1px solid #2b261f", borderRadius: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "#1c1813" }}>
        <div style={{ width: "100%", background: "#2b251f", height: `${100 - pct}%`, transition: "height 0.25s ease" }} />
        <div style={{ width: "100%", background: "#d9cb9e", height: `${pct}%`,       transition: "height 0.25s ease" }} />
      </div>
      <span style={{ fontSize: 11, color: "#8c7e6b", marginTop: 4, whiteSpace: "nowrap", fontFamily: "Georgia, serif", fontStyle: "italic" }}>{label}</span>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────
function Board({ fen, boardSize, onPieceDrop }: { fen: string; boardSize: number; onPieceDrop: (s: string, t: string) => boolean }) {
  const innerSize = boardSize - BOARD_BORDER * 2;
  return (
    <div style={{ width: boardSize, height: boardSize, border: `${BOARD_BORDER}px solid #26211a`, boxSizing: "border-box", flexShrink: 0, overflow: "hidden", outline: "1px solid #ebdcb9", boxShadow: "0 16px 36px rgba(0,0,0,0.9)" }}>
      <Chessboard position={fen} onPieceDrop={onPieceDrop} boardWidth={innerSize}
        customBoardStyle={{ borderRadius: 0 }}
        customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
        customDarkSquareStyle={{ backgroundColor: "#403425" }}
        animationDuration={300} />
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

  // Stockfish play mode — engine is ONLY active here
  const [sfPlayMode, setSfPlayMode]     = useState(false);
  const [sfSkillLevel, setSfSkillLevel] = useState(10);
  const [sfPlayFen, setSfPlayFen]       = useState(FALLBACK_FEN);
  const [sfWaiting, setSfWaiting]       = useState(false);

  const lesson = useMemo(() => {
    return module1?.lessons?.[lessonIndex] || {
      id: "m1-0001", module: "module-1", title: "Untitled Lesson",
      elo: 800, theme: [], intro: "No lessons loaded. Add .pgn files to src/modules/module1/", objective: "", steps: [], mode: "puzzle" as const,
    };
  }, [lessonIndex]);

  const lessonMode = (lesson as { mode?: string }).mode ?? "puzzle";
  const mastersNote = (lesson as { mastersNote?: string }).mastersNote;

  const [fen, setFen]                           = useState(() => lesson?.startFen || FALLBACK_FEN);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [coachSays, setCoachSays]               = useState("Study the position. Make your move.");
  const [feedback, setFeedback]                 = useState<{ text: string; ok: boolean } | null>(null);
  const [finished, setFinished]                 = useState(false);
  const [showHint, setShowHint]                 = useState(false);
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

  // ── Stockfish: ONLY enabled when sfPlayMode is true ──────────────────────
  const activeFen = sfPlayMode ? sfPlayFen : fen;
  const { ready, analyze, playMove, bar, cp, mate } = useStockfish(
    activeFen,
    sfPlayMode,   // enabled flag — no engine when studying lessons
    16
  );

  useEffect(() => {
    if (!ready) return;

    if (sfPlayMode && analyze) {
      analyze(activeFen, 14);
    }
  }, [activeFen, ready, sfPlayMode, analyze]);

  // ── Reset on lesson change ────────────────────────────────────────────────
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

    const intro = lessonMode === "lecture"
      ? "Follow the demonstration. Play each move on the board."
      : "Study the position. Make your move.";
    setCoachSays(intro);
  }, [lessonIndex, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Responsive sizing ─────────────────────────────────────────────────────
  useEffect(() => {
    function resize() {
      const stack = window.innerWidth < 1320;
      setIsStacked(stack);
      const pagePaddingX   = 40;
      const leftBlockExtra = EVAL_W + EVAL_GAP;
      const middleGap      = 48;
      const reservedHeight = stack ? 200 : 220;
      const maxByH         = window.innerHeight - reservedHeight;
      let fitByW = 700;
      while (fitByW > 440) {
        const rightW  = stack ? 0 : Math.min(Math.round(fitByW * 0.74), 480);
        const neededW = leftBlockExtra + fitByW + (stack ? 0 : middleGap + rightW) + pagePaddingX;
        if (neededW <= window.innerWidth) break;
        fitByW -= 2;
      }
      setBoardSize(Math.max(Math.min(700, fitByW, maxByH), 440));
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

  // ── Lesson move handler ───────────────────────────────────────────────────
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

    if (res.finished) {
      setFinished(true);
      return true;
    }

    // Schedule opponent reply via session (fixes FEN/step desync)
    if (res.hasReply) {
      activeSession.scheduleReply(res.replyDelay ?? 700, (replyFen, replyStep) => {
        setFen(replyFen);
        setCurrentStepIndex(replyStep);
        setHistory((p) => [...p, { fen: replyFen, step: replyStep }]);
        if (res.autoAdvance) {
          setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration.");
        }
      });
    } else if (res.autoAdvance) {
      setTimeout(() => {
        setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration.");
      }, 1200);
    }

    return true;
  }

  // ── Stockfish play mode ───────────────────────────────────────────────────
  function startSfPlay() {
    setSfPlayMode(true);
    setSfPlayFen(fen);
    setCoachSays(`Playing vs Stockfish — Skill Level ${sfSkillLevel}`);
  }

  async function onSfPieceDrop(src: string, tgt: string): Promise<boolean> {
    if (sfWaiting) return false;
    try {
      const g = new Chess(sfPlayFen);
      const move = g.move({ from: src, to: tgt, promotion: "q" });
      if (!move) return false;

      const afterPlayer = g.fen();
      setSfPlayFen(afterPlayer);

      if (g.isGameOver()) {
        setCoachSays(g.isCheckmate() ? "Checkmate! Well played." : "Game over.");
        return true;
      }

      setSfWaiting(true);
      setCoachSays("Stockfish is thinking…");

      const bestMove = await playMove(afterPlayer, sfSkillLevel);
      if (bestMove && bestMove.length >= 4) {
        const from  = bestMove.slice(0, 2);
        const to    = bestMove.slice(2, 4);
        const promo = bestMove[4] ?? "q";
        g.move({ from, to, promotion: promo });
        setSfPlayFen(g.fen());
        setCoachSays(g.isGameOver()
          ? (g.isCheckmate() ? "Stockfish delivers checkmate." : "Game over.")
          : "Your turn.");
      }
      setSfWaiting(false);
      return true;
    } catch {
      setSfWaiting(false);
      return false;
    }
  }

  function clearCanvas() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  const safeThemes      = Array.isArray(lesson?.theme) ? lesson.theme : [];
  const safeSteps       = Array.isArray(lesson?.steps) ? lesson.steps : [];
  const totalLeftBlockW = boardSize + EVAL_W + EVAL_GAP;
  const wbW             = isStacked ? Math.min(boardSize, 680) : Math.min(Math.round(boardSize * 0.74), 480);

  const currentStep     = activeSession.currentStep;
  const liveHint        = currentStep?.hint ?? (lessonMode === "lecture" ? "Play the next move." : "Find the best move.");
  const liveExplanation = currentStep?.explanation ?? "";
  const editorFilename  = `${String(lessonIndex + 1).padStart(4, "0")}-${lesson.id}`;

  const activeDropHandler = sfPlayMode
    ? (src: string, tgt: string) => { onSfPieceDrop(src, tgt); return true; }
    : onPieceDrop;

  return (
    <div style={S.page}>

      {/* Hamburger */}
      <button style={S.hamburger} onClick={() => setMenuOpen((m) => !m)}>
        {menuOpen ? "✕ Close" : "☰ Index"}
      </button>

      {/* Sidebar */}
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
              <button key={les.id || idx} onClick={() => { loadLesson(idx); setMenuOpen(false); }}
                style={{ ...S.lessonBtn, backgroundColor: active ? "#2b231a" : "transparent", color: active ? "#c4b293" : "#6b5e4c", fontWeight: active ? "bold" : "normal", borderLeft: active ? "2px solid #a69272" : "2px solid transparent" }}>
                <span style={{ opacity: 0.6, marginRight: 6 }}>{String(idx + 1).padStart(2, "0")}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{les.title}</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>{les.elo ?? 800}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <div style={S.mainContainer}>

        {/* Vintage header */}
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

        {/* Header row */}
        <div style={{ ...S.headerRow, flexDirection: isStacked ? "column" : "row", alignItems: "center", gap: isStacked ? 10 : 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <span style={S.badge}>{lesson?.elo ?? 800} ELO</span>
            <span style={{ ...S.badge, color: lessonMode === "lecture" ? "#a3b39c" : "#c4b293" }}>
              {lessonMode === "lecture" ? "📖 Lecture" : lessonMode === "free" ? "♟ Free" : "🎯 Puzzle"}
            </span>
            {safeThemes.slice(0, 2).map((t: string) => (
              <span key={t} style={S.themeBadge}>{t}</span>
            ))}
          </div>

          {/* Live hint bar */}
          {!finished && !sfPlayMode && currentStep && (
            <div style={S.integratedTaskArea}>
              <span style={S.taskPrefixLabel}>
                {lessonMode === "lecture" ? "DEMONSTRATION" : "ASSIGNMENT"} • STEP {currentStepIndex + 1}:
              </span>
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
              onClick={() => { setEditorOpen((o) => !o); if (drawingMode) setDrawingMode(false); }}>
              ✒ Edit
            </button>
            <button style={{ ...S.toolBtn, ...(drawingMode ? S.toolActive : {}) }}
              onClick={() => { setDrawingMode((d) => !d); if (editorOpen) setEditorOpen(false); }}>
              ✒ Draw
            </button>
            {drawingMode && (
              <>
                <button style={{ ...S.toolBtn, ...(tool === "eraser" ? S.toolActive : {}) }} onClick={() => setTool("eraser")}>◻</button>
                <button style={{ ...S.toolBtn, ...(tool === "pen"    ? S.toolActive : {}) }} onClick={() => setTool("pen")}>✏</button>
                <button style={S.toolBtn} onClick={clearCanvas}>✕</button>
              </>
            )}
            {!sfPlayMode && (
              <button style={{ ...S.toolBtn, ...(showHint ? S.toolActive : {}) }}
                onClick={() => setShowHint((h) => !h)}>
                💡 Hint
              </button>
            )}
          </div>
        </div>

        {/* Columns */}
        <div style={{ ...S.cols, flexDirection: isStacked ? "column" : "row", alignItems: isStacked ? "center" : "stretch", gap: isStacked ? 20 : 48 }}>

          <div style={{ ...S.leftCol, position: "relative" }}>

            {/* Hint popup — appears above board */}
            {showHint && !sfPlayMode && currentStep && (
              <HintPopup hint={liveHint} explanation={liveExplanation} onClose={() => setShowHint(false)} />
            )}

            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
              {sfPlayMode && (
                <EvalBar bar={bar} cp={cp} mate={mate} size={boardSize} />
              )}
              {!sfPlayMode && (
                /* Placeholder spacer so board doesn't shift when eval bar appears */
                <div style={{ width: EVAL_W, marginRight: EVAL_GAP, flexShrink: 0 }} />
              )}
              <Board fen={activeFen} boardSize={boardSize} onPieceDrop={activeDropHandler} />
            </div>

            {/* Coach says */}
            <div style={{ width: totalLeftBlockW, padding: "6px 12px", boxSizing: "border-box", background: "#1c1712", border: "1px solid #362f25", borderLeft: `3px solid ${feedback?.ok ? "#56664d" : feedback ? "#824b4b" : "#736451"}`, textAlign: "center" }}>
              <span style={{ color: feedback?.ok ? "#a3b899" : feedback ? "#cc9999" : "#bdae99", fontSize: 13, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
                {coachSays}
              </span>
            </div>

            {/* Controls */}
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
                  <input type="range" min={1} max={20} value={sfSkillLevel}
                    onChange={(e) => setSfSkillLevel(Number(e.target.value))}
                    style={{ width: 80, accentColor: "#a69272" }} />
                  <span style={{ fontSize: 11, color: "#c4b293", minWidth: 20, fontFamily: "Georgia, serif" }}>{sfSkillLevel}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right col: paper */}
          <div style={{ ...S.rightCol, width: wbW }}>
            <div style={{ ...S.paper, width: wbW, height: "100%" }}>
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(transparent,transparent 27px,#d1c2a5 27px,#d1c2a5 28px)", backgroundPositionY: "44px", opacity: 0.25, zIndex: 0 }} />

              <div style={{ position: "relative", padding: "20px 24px 24px 24px", display: "flex", flexDirection: "column", gap: 12, zIndex: 1, boxSizing: "border-box" }}>
                <div style={{ fontSize: 22, fontWeight: "bold", color: "#211a12", fontFamily: "Georgia, serif", borderBottom: "1px solid #c4b293", paddingBottom: 2 }}>
                  {lesson.title}
                </div>
                <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 11, margin: "-4px 0" }}>❖ ❖ ❖</div>

                {mastersNote && (
                  <div style={{ fontSize: 11, color: "#7a6e5d", fontStyle: "italic", fontFamily: "Georgia, serif" }}>— {mastersNote}</div>
                )}

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

                {/* Step progress dots */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingTop: 2 }}>
                  {safeSteps.map((_, i: number) => (
                    <div key={i} style={{ width: 6, height: 6, background: i < currentStepIndex ? "#4a5743" : i === currentStepIndex ? "#8c795c" : "#d1c4b0", outline: "1px solid #7a6b54" }} />
                  ))}
                </div>

                {/* Finished state */}
                {finished && !sfPlayMode && (
                  <>
                    <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 11 }}>❖</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={S.wbLabel}>Reflection</span>
                      <p style={{ fontSize: 14, color: "#2b2118", margin: 0, lineHeight: "20px", fontFamily: "Georgia, serif" }}>
                        {(lesson as { finalReflection?: string }).finalReflection || "Lesson completed successfully."}
                      </p>
                    </div>

                    {/* ♟ Play vs Stockfish — only appears after lesson completion */}
                    <button style={S.sfBtn} onClick={startSfPlay}>
                      ♟ Play vs Stockfish from this position
                    </button>

                    {module1?.lessons && lessonIndex < module1.lessons.length - 1 && (
                      <button style={S.nextBtn} onClick={() => loadLesson(lessonIndex + 1)}>
                        Accept & Continue →
                      </button>
                    )}
                  </>
                )}

                {/* Mid-lesson SF play for lecture mode */}
                {!finished && lessonMode === "lecture" && !sfPlayMode && (
                  <button style={{ ...S.sfBtn, marginTop: 4 }} onClick={startSfPlay}>
                    ♟ Play from this position
                  </button>
                )}
              </div>

              <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 2, width: "100%", height: "100%", touchAction: "none", cursor: drawingMode ? "crosshair" : "default", opacity: drawingMode ? 0.8 : 0.4, pointerEvents: drawingMode ? "auto" : "none" }} />
            </div>
          </div>
        </div>

        {/* Board Editor overlay */}
        {editorOpen && (
          <BoardEditor
            lesson={lesson}
            moduleId={lesson.module || "module-1"}
            filename={editorFilename}
            onClose={() => setEditorOpen(false)}
            onSaved={(updated) => {
              if (sessionRef.current) sessionRef.current.lesson = updated;
              setTick((t) => t + 1);
              setEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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