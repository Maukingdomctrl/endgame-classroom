/**
 * BoardEditor.tsx — Final stable rewrite
 * Two modes:
 * SETUP MODE  — arrange pieces freely, set starting position
 * RECORD MODE — play moves to build lines
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import type { RawLesson, LessonStep } from "../modules/moduleLoader";
import { loadAllModules } from "../modules/moduleLoader";
import { lessonToPgn } from "../engine/lessonToPgn";
import LineSavedOverlay from "./LineSavedOverlay";
import MoveTreeDisplay from "./MoveTreeDisplay";
import SaveDialog from "./SaveDialog";
import { fetchPositionData, formatGames, type ExplorerMove } from "../engine/openingExplorer";

const PIECES = [
  { label: "♔", code: "wK" }, { label: "♕", code: "wQ" },
  { label: "♖", code: "wR" }, { label: "♗", code: "wB" },
  { label: "♘", code: "wN" }, { label: "♙", code: "wP" },
  { label: "♚", code: "bK" }, { label: "♛", code: "bQ" },
  { label: "♜", code: "bR" }, { label: "♝", code: "bB" },
  { label: "♞", code: "bN" }, { label: "♟", code: "bP" },
];

// Scaled precisely to 83% for the requested zoomed-out view
const MAX_BOARD_SIZE = 488; 

interface Props {
  lesson: RawLesson;
  onClose: () => void;
  onSaved: (updated: RawLesson) => void;
  moduleId: string;
  filename?: string;
  allLessons?: RawLesson[];
  onLessonsChange?: (lessons: RawLesson[]) => void;
}

type BuilderStep = {
  w: { san: string; fen: string; comment: string };
  bOptions: Array<{ san: string; fen: string; pct: string; comment: string }>;
  bActive: number;
};

type EditorMode = "setup" | "record";

function safeFen(fen: string): string {
  try { new Chess(fen); return fen; }
  catch { return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; }
}

function fenIsValid(fen: string): boolean {
  try { new Chess(fen); return true; } catch { return false; }
}

// Bypasses chess.js validation — directly edits FEN string for piece placement
function placePieceInFen(fen: string, sq: string, pieceCode: string | null): string {
  const files = "abcdefgh";
  const fileIdx = files.indexOf(sq[0]);
  const rankIdx = parseInt(sq[1]) - 1;
  const parts = fen.split(" ");
  const rows = parts[0].split("/");
  const expanded: (string | null)[] = [];

  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch); i++) expanded.push(null);
      } else {
        expanded.push(ch);
      }
    }
  }

  const idx = (7 - rankIdx) * 8 + fileIdx;

  if (pieceCode) {
    const color = pieceCode[0];
    const type = pieceCode[1];
    expanded[idx] = color === "w" ? type.toUpperCase() : type.toLowerCase();
  } else {
    expanded[idx] = null;
  }

  let newBoard = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = expanded[r * 8 + f];
      if (piece === null) { empty++; }
      else { if (empty > 0) { newBoard += empty; empty = 0; } newBoard += piece; }
    }
    if (empty > 0) newBoard += empty;
    if (r < 7) newBoard += "/";
  }

  return `${newBoard} ${parts[1] ?? "w"} - - 0 1`;
}

export default function BoardEditor(props: Props) {
  const { lesson, onClose, onSaved, moduleId, onLessonsChange } = props;

  const allLessonsRef = useRef<RawLesson[]>(props.allLessons || [lesson]);
  useEffect(() => {
    allLessonsRef.current = props.allLessons || [lesson];
  }, [props.allLessons, lesson]);

  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState(MAX_BOARD_SIZE);
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? MAX_BOARD_SIZE);
      if (w > 0) setBoardPx(w);
    });
    ro.observe(el);
    setBoardPx(Math.floor(el.getBoundingClientRect().width) || MAX_BOARD_SIZE);
    return () => ro.disconnect();
  }, []);

  const [mode, setMode] = useState<EditorMode>("setup");
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [sideToMove, setSideToMove] = useState<"white" | "black">("white");

  const [setupFen, setSetupFen] = useState(() => safeFen(lesson.startFen));
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [fenInput, setFenInput] = useState(() => safeFen(lesson.startFen));
  const [fenError, setFenError] = useState("");

  const [startFen, setStartFen] = useState(() => safeFen(lesson.startFen));
  const [builderSteps, setBuilderSteps] = useState<BuilderStep[]>([]);
  const [selectedPly, setSelectedPly] = useState(-1);
  const [activeComment, setActiveComment] = useState("");
  const [currentLineIdx, setCurrentLineIdx] = useState(() =>
    Math.max(0, (props.allLessons || [lesson]).findIndex((l) => l.id === lesson.id))
  );

  const selectedPlyRef = useRef(selectedPly);
  const sideToMoveRef = useRef(sideToMove);
  useEffect(() => { selectedPlyRef.current = selectedPly; }, [selectedPly]);
  useEffect(() => { sideToMoveRef.current = sideToMove; }, [sideToMove]);

  const [saving, setSaving] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [showLineSaved, setShowLineSaved] = useState(false);
  const [savedLineCount, setSavedLineCount] = useState(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [explorerMoves, setExplorerMoves] = useState<ExplorerMove[]>([]);

  const recordFen = useMemo(() => {
    if (selectedPly === -1) return startFen;
    const stepIdx = Math.floor(selectedPly / 2);
    const step = builderSteps[stepIdx];
    if (!step) return startFen;
    if (selectedPly % 2 === 0) return step.w.fen;
    return step.bOptions[step.bActive]?.fen ?? step.w.fen;
  }, [selectedPly, builderSteps, startFen]);

  const recordFenRef = useRef(recordFen);
  useEffect(() => { recordFenRef.current = recordFen; }, [recordFen]);

  useEffect(() => {
    if (mode !== "record") return;
    fetchPositionData(recordFen).then(data => {
      setExplorerMoves(data?.topMoves ?? []);
    });
  }, [recordFen, mode]);

  const loadLesson = useCallback((target: RawLesson) => {
    const base = safeFen(target.startFen);
    setStartFen(base);
    setSetupFen(base);
    setFenInput(base);
    setSideToMove(target.sideToMove === "black" ? "black" : "white");
    setBoardOrientation(target.sideToMove === "black" ? "black" : "white");

    const g = new Chess(base);
    const steps: BuilderStep[] = [];

    for (const s of target.steps) {
      let wMove;
      try { wMove = g.move(s.correctMove); } catch { break; }
      if (!wMove) break;
      const wFen = g.fen();
      const bOptions: BuilderStep["bOptions"] = [];
      let bActive = -1;

      if (s.opponentReply) {
        try {
          const bMove = g.move(s.opponentReply.move);
          if (bMove) {
            bOptions.push({ san: bMove.san, fen: g.fen(), pct: "", comment: s.opponentReply.explanation || "" });
            bActive = 0;
          } else { g.undo(); break; }
        } catch { g.undo(); break; }
      }

      steps.push({ w: { san: wMove.san, fen: wFen, comment: s.explanation || s.hint || "" }, bOptions, bActive });
    }

    setBuilderSteps(steps);
    if (steps.length > 0) {
      const last = steps[steps.length - 1];
      setSelectedPly(last.bActive !== -1 ? steps.length * 2 - 1 : steps.length * 2 - 2);
    } else {
      setSelectedPly(-1);
    }
  }, []);

  useEffect(() => {
    const target = allLessonsRef.current[currentLineIdx];
    if (target) loadLesson(target);
    else {
      setBuilderSteps([]);
      setSelectedPly(-1);
    }
  }, [currentLineIdx, loadLesson]);

  useEffect(() => {
    if (selectedPly === -1) { setActiveComment(""); return; }
    const step = builderSteps[Math.floor(selectedPly / 2)];
    if (!step) return;
    setActiveComment(selectedPly % 2 === 0 ? step.w.comment : (step.bOptions[step.bActive]?.comment ?? ""));
  }, [selectedPly, builderSteps]);

  const commitComment = useCallback(() => {
    const ply = selectedPlyRef.current;
    if (ply === -1) return;
    const stepIdx = Math.floor(ply / 2);
    setBuilderSteps(prev => {
      const next = prev.map((s, i) => i !== stepIdx ? s : {
        ...s,
        w: ply % 2 === 0 ? { ...s.w, comment: activeComment } : s.w,
        bOptions: ply % 2 === 1
          ? s.bOptions.map((o, oi) => oi === s.bActive ? { ...o, comment: activeComment } : o)
          : s.bOptions,
      });
      return next;
    });
  }, [activeComment]);

  const handleSetupSquareClick = useCallback((sq: string) => {
    if (!selectedPiece) return;
    const newFen = placePieceInFen(setupFen, sq, selectedPiece);
    setSetupFen(newFen);
    setFenInput(newFen);
    setSelectedPiece(null);
  }, [selectedPiece, setupFen]);

  const handleSetupRightClick = useCallback((sq: string) => {
    const newFen = placePieceInFen(setupFen, sq, null);
    setSetupFen(newFen);
    setFenInput(newFen);
  }, [setupFen]);

  const handleSetupDrop = useCallback((src: string, tgt: string): boolean => {
    const newFen = placePieceInFen(
      placePieceInFen(setupFen, tgt, null),
      tgt,
      (() => {
        const files = "abcdefgh";
        const fIdx = files.indexOf(src[0]);
        const rIdx = parseInt(src[1]) - 1;
        const parts = setupFen.split(" ")[0].split("/");
        const expanded: (string | null)[] = [];
        for (const row of parts) {
          for (const ch of row) {
            if (/\d/.test(ch)) { for (let i = 0; i < parseInt(ch); i++) expanded.push(null); }
            else expanded.push(ch);
          }
        }
        const piece = expanded[(7 - rIdx) * 8 + fIdx];
        return piece ? (piece === piece.toUpperCase() ? `w${piece}` : `b${piece.toUpperCase()}`) : null;
      })()
    );
    const cleared = placePieceInFen(newFen, src, null);
    setSetupFen(cleared);
    setFenInput(cleared);
    return true;
  }, [setupFen]);

  const applyFenInput = (raw: string) => {
    setFenInput(raw);
    if (fenIsValid(raw)) { setSetupFen(raw); setFenError(""); }
    else setFenError("Invalid FEN");
  };

  const handleSetStartingPosition = () => {
    const turn = sideToMove === "black" ? "b" : "w";
    const parts = setupFen.split(" ");
    parts[1] = turn;
    const fen = parts.join(" ");
    setStartFen(fen);
    setSetupFen(fen);
    setFenInput(fen);
    setBuilderSteps([]);
    setSelectedPly(-1);
    setMode("record");
  };

  const [clickFrom, setClickFrom] = useState<string | null>(null);

  const handleRecordMove = useCallback((src: string, tgt: string): boolean => {
    const fen = recordFenRef.current;
    try {
      const g = new Chess(fen);
      const move = g.move({ from: src as Square, to: tgt as Square, promotion: "q" });
      if (!move) return false;
      const san = move.san;
      const newFen = g.fen();
      const ply = selectedPlyRef.current;
      const isStudentMove = ply === -1 || ply % 2 === 1;

      if (isStudentMove) {
        const newStepIdx = ply === -1 ? 0 : Math.floor(ply / 2) + 1;
        setBuilderSteps(prev => [
          ...prev.slice(0, newStepIdx),
          { w: { san, fen: newFen, comment: "" }, bOptions: [], bActive: -1 },
        ]);
        setSelectedPly(newStepIdx * 2);
      } else {
        const stepIdx = Math.floor(ply / 2);
        setBuilderSteps(prev => {
          const next = [...prev];
          const step = { ...next[stepIdx], bOptions: [...next[stepIdx].bOptions] };
          let optIdx = step.bOptions.findIndex(o => o.san === san);
          if (optIdx === -1) {
            step.bOptions = [...step.bOptions, { san, fen: newFen, pct: "", comment: "" }];
            optIdx = step.bOptions.length - 1;
          }
          step.bActive = optIdx;
          next[stepIdx] = step;
          return next.slice(0, stepIdx + 1);
        });
        setSelectedPly(stepIdx * 2 + 1);
      }
      return true;
    } catch { return false; }
  }, []);

  const handleRecordSquareClick = useCallback((sq: string) => {
    if (!clickFrom) { setClickFrom(sq); return; }
    const moved = handleRecordMove(clickFrom, sq);
    setClickFrom(null);
    if (!moved) setClickFrom(sq); 
  }, [clickFrom, handleRecordMove]);

  const clickStyles: Record<string, React.CSSProperties> = clickFrom
    ? { [clickFrom]: { backgroundColor: "rgba(90,130,200,0.55)" } }
    : {};
  const turnIndicatorStyles: Record<string, React.CSSProperties> = {};

  const selectBlackOption = (stepIdx: number, optIdx: number) => {
    setBuilderSteps(prev => {
      const next = [...prev];
      next[stepIdx] = { ...next[stepIdx], bActive: optIdx };
      return next.slice(0, stepIdx + 1);
    });
    setSelectedPly(stepIdx * 2 + 1);
  };

  const updateBlackField = (stepIdx: number, optIdx: number, field: "pct" | "comment", val: string) => {
    setBuilderSteps(prev => {
      const next = [...prev];
      const step = { ...next[stepIdx], bOptions: [...next[stepIdx].bOptions] };
      step.bOptions[optIdx] = { ...step.bOptions[optIdx], [field]: val };
      next[stepIdx] = step;
      return next;
    });
  };

  // 1. IN-MEMORY SAVE LOOP
  const handleSaveLine = async (
    targetModuleId: string,
    filename: string,
    _isNew: boolean // _isNew=true creates a new file, false appends — server handles both
  ) => {
    const steps: LessonStep[] = builderSteps.map(st => ({
      correctMove: st.w.san,
      hint: st.w.comment || undefined,
      explanation: st.w.comment || undefined,
      ...(st.bActive !== -1 ? {
        opponentReply: {
          move: st.bOptions[st.bActive].san,
          explanation: st.bOptions[st.bActive].comment || undefined,
        },
      } : {}),
    }));
    const lessons = allLessonsRef.current;
    const existing = lessons[currentLineIdx];
    const saved: RawLesson = {
      ...(existing || {}),
      id: existing?.id || `line-${Date.now()}`,
      module: targetModuleId,
      title: existing?.title || "New Variation",
      lineName: builderSteps.map(s => s.w.san).join(" ") || "New Line",
      elo: existing?.elo || 800,
      theme: existing?.theme || [],
      objective: existing?.objective || "",
      intro: existing?.intro || "",
      startFen,
      sideToMove,
      mode: "lecture",
      steps,
    };
    const updated = [...lessons];
    if (existing) updated[currentLineIdx] = saved;
    else updated.push(saved);
    
    // Persist to server
    setSaving(true);
    try {
      const validLessons = updated.filter(l => l.steps.length > 0);
      const pgn = validLessons.map(l => lessonToPgn(l)).join("\n\n");
      const res = await fetch("/api/save-pgn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId: targetModuleId,
          filename,
          pgnText: pgn,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setPublishMsg("✗ Save Failed"); return; }
    } catch {
      setPublishMsg("✗ Save Failed");
      return;
    } finally {
      setSaving(false);
    }
    allLessonsRef.current = updated;
    onLessonsChange?.(updated);
    onSaved(saved);
    
    // Trigger overlay
    setSavedLineCount(c => c + 1);
    setShowLineSaved(true);
  };

  // 2. BATCH PUBLISH TO SERVER
  const publishToServer = async () => {
    setSaving(true);
    setPublishMsg("");
    try {
      // Filter out blank lines before publishing
      const validLessons = allLessonsRef.current.filter(l => l.steps.length > 0);
      const pgn = validLessons.map(l => lessonToPgn(l)).join("\n\n");
      
      const res = await fetch("/api/save-pgn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId,
          filename: moduleId === "module1" ? "0001-endgame-lessons" : "lessons",
          pgnText: pgn,
        }),
      });
      
      const data = await res.json();
      if (data.ok) {
        setPublishMsg("✓ Published to Server");
        await loadAllModules();
      } else {
        setPublishMsg("✗ Publish Failed");
      }
    } catch { 
      setPublishMsg("✗ Publish Failed"); 
    } finally { 
      setSaving(false); 
      setTimeout(() => setPublishMsg(""), 3000);
    }
  };

  const handleNextLine = () => {
    const lessons = allLessonsRef.current;
    if (currentLineIdx < lessons.length - 1) { setCurrentLineIdx(i => i + 1); return; }
    const blank: RawLesson = {
      id: `line-${Date.now()}`, module: moduleId, title: "New Variation", lineName: "",
      elo: 800, theme: [], objective: "", intro: "", startFen, sideToMove, mode: "lecture", steps: [],
    };
    const withBlank = [...lessons, blank];
    allLessonsRef.current = withBlank;
    onLessonsChange?.(withBlank);
    setCurrentLineIdx(withBlank.length - 1);
  };

  const currentStepPanel = selectedPly >= 0 ? builderSteps[Math.floor(selectedPly / 2)] : null;
  const allCount = allLessonsRef.current.length;
  // Count how many lines actually have valid steps recorded
  const savedLinesCount = allLessonsRef.current.filter(l => l.steps.length > 0).length;

  const whoseTurn = (() => {
    if (mode !== "record") return null;
    try {
      const g = new Chess(recordFen);
      return g.turn() === "w" ? "white" : "black";
    } catch { return null; }
  })();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#1a1510", fontFamily: "Georgia, serif", overflow: "hidden" }}>

      {/* Title bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "#120f0c", borderBottom: "1px solid #2e261f", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#c4b293", fontSize: 13, letterSpacing: "1.5px", textTransform: "uppercase" }}>✒ PGN Line Editor</span>
          <button onClick={() => setMode("setup")} style={{ ...S.modeBtn, background: mode === "setup" ? "#2b231a" : "#1c1712", borderColor: mode === "setup" ? "#a69272" : "#362f25", color: mode === "setup" ? "#d9cb9e" : "#6a5a3a" }}>⚙ Setup</button>
          <button onClick={() => setMode("record")} style={{ ...S.modeBtn, background: mode === "record" ? "#2b231a" : "#1c1712", borderColor: mode === "record" ? "#56a364" : "#362f25", color: mode === "record" ? "#a3e8b0" : "#6a5a3a" }}>▶ Record</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {publishMsg && <span style={{ fontSize: 11, color: publishMsg.startsWith("✓") ? "#7cb37c" : "#cc8a8a", marginRight: 8, fontWeight: "bold" }}>{publishMsg}</span>}
          <button onClick={publishToServer} disabled={saving} style={S.publishBtn}>🚀 Publish All</button>
          <button onClick={onClose} style={S.closeBtn}>✕ Close</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* LEFT: Board Area */}
        <div style={{ width: "50%", flexShrink: 0, height: "100%", overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: "14px", borderRight: "1px solid #2e261f", boxSizing: "border-box" }}>
          
          <div style={{ display: "flex", flexDirection: "row", gap: 16, width: "100%", justifyContent: "center" }}>
            
            {/* Setup Mode: Left-side Piece Palette */}
            {mode === "setup" && (
              <div style={{ display: "grid", gridTemplateRows: "repeat(6, 38px)", gridAutoFlow: "column", gap: 6, paddingTop: 30 }}>
                {PIECES.map(p => (
                  <button key={p.code} onClick={() => setSelectedPiece(selectedPiece === p.code ? null : p.code)} title={p.code}
                    style={{ width: 38, height: 38, fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: 3, background: selectedPiece === p.code ? "#3a2f1f" : "#1c1712", border: selectedPiece === p.code ? "2px solid #a69272" : "1px solid #362f25", color: p.code[0] === "w" ? "#f0e8d0" : "#9a8a7a", transition: "all 0.12s", boxShadow: selectedPiece === p.code ? "0 0 8px rgba(166,146,114,0.4)" : "none" }}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Main Column: Board + Perfectly Aligned Controls */}
            <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: MAX_BOARD_SIZE, gap: 10 }}>
              
              {/* Top Controls */}
              {mode === "setup" ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <span style={{ fontSize: 11, color: "#6a5a3a" }}>
                    {selectedPiece ? `Placing: ${selectedPiece}` : "Click piece then square to place. Right-click to remove."}
                  </span>
                  <button onClick={() => setBoardOrientation(o => o === "white" ? "black" : "white")} style={S.navBtn}>
                    ⟲ Flip Board
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                  {/* Turn indicator banner */}
                  <div style={{ padding: "7px 12px", background: whoseTurn === "black" ? "#1a1a2e" : "#1e1a12", border: `1px solid ${whoseTurn === "black" ? "#4a4a7a" : "#4a3f25"}`, borderLeft: `3px solid ${whoseTurn === "black" ? "#7a7acc" : "#a69272"}`, display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box", width: "100%" }}>
                    <span style={{ fontSize: 20 }}>{whoseTurn === "black" ? "♟" : "♙"}</span>
                    <span style={{ fontSize: 12, color: whoseTurn === "black" ? "#aaaaee" : "#c4b293" }}>
                      {whoseTurn === "black" ? "Black to move" : "White to move"}
                      {selectedPly === -1 && sideToMove === "black" && " · You are recording black's moves"}
                    </span>
                  </div>
                  {/* Play as white/black toggle */}
                  <div style={{ display: "flex", gap: 6, width: "100%" }}>
                    <button onClick={() => { setSideToMove("white"); setBoardOrientation("white"); }} style={{ ...S.sideBtn, background: sideToMove === "white" ? "#2b231a" : "#1c1712", borderColor: sideToMove === "white" ? "#a69272" : "#362f25", color: sideToMove === "white" ? "#d9cb9e" : "#6a5a3a" }}>♔ Play as White</button>
                    <button onClick={() => { setSideToMove("black"); setBoardOrientation("black"); }} style={{ ...S.sideBtn, background: sideToMove === "black" ? "#1a1a2e" : "#1c1712", borderColor: sideToMove === "black" ? "#7a7acc" : "#362f25", color: sideToMove === "black" ? "#aaaaee" : "#6a5a3a" }}>♚ Play as Black</button>
                  </div>
                </div>
              )}

              {/* The Chessboard */}
              <div ref={boardWrapRef} style={{ width: "100%" }}>
                <div style={{ width: "100%", aspectRatio: "1", border: "8px solid #26211a", boxSizing: "border-box", outline: "1px solid #ebdcb9", boxShadow: "0 8px 24px rgba(0,0,0,0.8)", cursor: (mode === "setup" && selectedPiece) ? "crosshair" : "default" }}>
                  {boardPx > 0 && (
                    mode === "setup" ? (
                      <Chessboard
                        key="setup-board"
                        position={setupFen}
                        boardWidth={boardPx - 16}
                        boardOrientation={boardOrientation}
                        onPieceDrop={handleSetupDrop}
                        onSquareClick={handleSetupSquareClick}
                        onSquareRightClick={handleSetupRightClick}
                        arePiecesDraggable={true}
                        animationDuration={100}
                        customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
                        customDarkSquareStyle={{ backgroundColor: "#403425" }}
                      />
                    ) : (
                      <Chessboard
                        key="record-board"
                        position={recordFen}
                        boardWidth={boardPx - 16}
                        boardOrientation={boardOrientation}
                        onPieceDrop={(src, tgt) => handleRecordMove(src, tgt)}
                        onSquareClick={handleRecordSquareClick}
                        arePiecesDraggable={true}
                        animationDuration={150}
                        customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
                        customDarkSquareStyle={{ backgroundColor: "#403425" }}
                        customSquareStyles={{ ...clickStyles, ...turnIndicatorStyles }}
                      />
                    )
                  )}
                </div>
              </div>

              {/* Bottom Controls */}
              {mode === "setup" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                  <div style={{ display: "flex", gap: 6, width: "100%" }}>
                    <button onClick={() => { setSideToMove("white"); setBoardOrientation("white"); }} style={{ ...S.sideBtn, flex: 1, background: sideToMove === "white" ? "#2b231a" : "#1c1712", borderColor: sideToMove === "white" ? "#a69272" : "#362f25", color: sideToMove === "white" ? "#d9cb9e" : "#6a5a3a" }}>♔ White to move</button>
                    <button onClick={() => { setSideToMove("black"); setBoardOrientation("black"); }} style={{ ...S.sideBtn, flex: 1, background: sideToMove === "black" ? "#1a1a2e" : "#1c1712", borderColor: sideToMove === "black" ? "#7a7acc" : "#362f25", color: sideToMove === "black" ? "#aaaaee" : "#6a5a3a" }}>♚ Black to move</button>
                  </div>
                  <label style={S.label}>FEN</label>
                  <textarea value={fenInput} onChange={e => applyFenInput(e.target.value)} rows={2} style={{ ...S.textarea, fontFamily: "monospace", fontSize: 14, color: fenError ? "#cc8a8a" : "#c4b293" }} />
                  {fenError && <span style={{ color: "#cc8a8a", fontSize: 11 }}>{fenError}</span>}
                  <button onClick={handleSetStartingPosition} style={{ ...S.setStartBtn, marginTop: 4 }}>
                    ✓ Set as Starting Position &amp; Switch to Record Mode
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                  <label style={S.label}>Current FEN</label>
                  <textarea value={recordFen} readOnly rows={2} style={{ ...S.textarea, fontFamily: "monospace", fontSize: 14, opacity: 0.6 }} />
                  <button onClick={() => setMode("setup")} style={S.setStartBtn}>← Back to Setup Mode</button>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* RIGHT: Line builder panel */}
        <div style={{ flex: 1, height: "100%", overflowY: "auto", position: "relative", display: "flex", flexDirection: "column", background: "#15110d", padding: "16px 20px", boxSizing: "border-box", gap: 14 }}>

          <LineSavedOverlay
            active={showLineSaved}
            lineCount={savedLineCount}
            onDone={() => {
              setShowLineSaved(false);
              setBuilderSteps([]);
              setSelectedPly(-1);
              const blank: RawLesson = {
                id: `line-${Date.now() + 1}`,
                module: moduleId,
                title: "New Variation",
                lineName: "",
                elo: 800,
                theme: [],
                objective: "",
                intro: "",
                startFen,
                sideToMove,
                mode: "lecture",
                steps: [],
              };
              const withBlank = [...allLessonsRef.current, blank];
              allLessonsRef.current = withBlank;
              onLessonsChange?.(withBlank);
              setCurrentLineIdx(withBlank.length - 1);
            }}
          />

          {allLessonsRef.current.filter(l => l.steps.length > 0).length > 0 && (
            <MoveTreeDisplay
              lessons={allLessonsRef.current.filter(l => l.steps.length > 0)}
              activeLessonId={allLessonsRef.current[currentLineIdx]?.id ?? ""}
              onSelectLesson={(lesson) => {
                const idx = allLessonsRef.current.findIndex(l => l.id === lesson.id);
                if (idx !== -1) setCurrentLineIdx(idx);
              }}
            />
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ color: "#a69272", fontSize: 13, fontWeight: "bold" }}>{allCount} line{allCount !== 1 ? "s" : ""} in module</span>
            <button onClick={() => setSelectedPly(-1)} style={S.navBtn}>▶ Preview from Start</button>
          </div>

          {/* Move tokens Wrapper */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
               <label style={S.label}>Move Sequence</label>
               {savedLinesCount > 0 && (
                 <span style={{ background: "#2d3b28", color: "#a3e8b0", fontSize: 10, fontWeight: "bold", padding: "3px 8px", borderRadius: 10, letterSpacing: "0.5px" }}>
                   {savedLinesCount} LINE{savedLinesCount !== 1 ? "S" : ""} SAVED
                 </span>
               )}
             </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "#0e0b09", padding: "12px", border: "1px solid #2e261f", minHeight: 52, borderRadius: 2, alignItems: "center", flexShrink: 0 }}>
              {builderSteps.length === 0 ? (
                <span style={{ fontSize: 12, color: "#6a5a3a", fontStyle: "italic" }}>
                  {mode === "setup" ? "Set starting position first, then switch to Record mode" : "Play a move on the board to start building this line..."}
                </span>
              ) : builderSteps.map((step, i) => (
                <span key={i} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <span style={{ color: "#7a6e5d", fontSize: 11, marginRight: 2 }}>
                    {sideToMove === "black" && i === 0 ? `${i + 1}...` : `${i + 1}.`}
                  </span>
                  <button onClick={() => setSelectedPly(i * 2)} style={{ ...S.tokenBtn, ...(selectedPly === i * 2 ? S.tokenActive : S.tokenWhite) }}>
                    {step.w.san}{step.w.comment && <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 9 }}>💬</span>}
                  </button>
                  {step.bActive !== -1 && (
                    <button onClick={() => setSelectedPly(i * 2 + 1)} style={{ ...S.tokenBtn, ...(selectedPly === i * 2 + 1 ? S.tokenActive : S.tokenBlack) }}>
                      {step.bOptions[step.bActive].san}{step.bOptions[step.bActive].comment && <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 9 }}>💬</span>}
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Coach comment */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
            <label style={S.label}>Coach Comment (Selected Move)</label>
            <textarea value={activeComment} onChange={e => setActiveComment(e.target.value)} onBlur={commitComment} rows={4}
              placeholder={selectedPly === -1 ? "Select a move token above..." : "Add coach explanation for this move..."}
              style={{ ...S.textarea, fontSize: 13, background: "#1a1612" }} />
          </div>

          {/* Player confirmation + opponent replies */}
          {selectedPly !== -1 && selectedPly % 2 === 0 && currentStepPanel && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
              <div style={{ background: "#2d3d28", borderLeft: "4px solid #56a364", padding: "8px 14px", color: "#c8e8c0", fontSize: 13, fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
                <span>✓ Player move: {currentStepPanel.w.san}</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{allCount} line(s)</span>
              </div>
              <label style={S.label}>Opponent Reply Options</label>
              <div style={{ border: "1px solid #2e261f", background: "#0e0b09", borderRadius: 2 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#1c1712", borderBottom: "1px solid #2e261f" }}>
                      <th style={S.th}>Move</th>
                      <th style={{ ...S.th, width: 60 }}>%</th>
                      <th style={{ ...S.th, width: 60 }}>Games</th>
                      <th style={S.th}>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentStepPanel.bOptions.map((opt, idx) => {
                      const stepIdx = Math.floor(selectedPly / 2);
                      const isActive = idx === currentStepPanel.bActive;
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid #211b16", background: isActive ? "#1a2018" : "transparent" }}>
                          <td style={{ padding: "6px 8px", cursor: "pointer", fontSize: 13 }} onClick={() => selectBlackOption(stepIdx, idx)}>
                            <span style={{ marginRight: 6 }}>{isActive ? "🟢" : "⚪"}</span>
                            <span style={{ color: isActive ? "#7cb37c" : "#c4b293", fontWeight: isActive ? "bold" : "normal" }}>{opt.san}</span>
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input value={opt.pct} onChange={e => updateBlackField(stepIdx, idx, "pct", e.target.value)} style={S.tableInput} placeholder="%" />
                          </td>
                          <td style={{ padding: "4px 8px", fontSize: 11, color: "#8c7e6b", fontFamily: "monospace" }}>
                            {explorerMoves.find(m => m.san === opt.san)
                              ? formatGames(explorerMoves.find(m => m.san === opt.san)!.games)
                              : "—"}
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input value={opt.comment} onChange={e => updateBlackField(stepIdx, idx, "comment", e.target.value)} style={S.tableInput} placeholder="Comment..." />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#6a5a3a", fontStyle: "italic" }}>＋ Play a move on the board to add an opponent reply</span>
                  {explorerMoves
                    .filter(m => !currentStepPanel?.bOptions.some(o => o.san === m.san))
                    .slice(0, 3)
                    .map(m => (
                      <button
                        key={m.san}
                        onClick={() => {
                          const g = new Chess(recordFen);
                          try {
                            const moves = g.moves({ verbose: true });
                            const match = moves.find(mv => mv.san === m.san);
                            if (match) handleRecordMove(match.from, match.to);
                          } catch {}
                        }}
                        style={{ ...S.navBtn, fontSize: 11, textAlign: "left", display: "flex", gap: 8 }}
                      >
                        <span style={{ color: "#c4b293", fontWeight: "bold" }}>{m.san}</span>
                        <span style={{ color: "#6a5a3a" }}>{m.popularityPct}% · {formatGames(m.games)} games</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 16 }} />

          {/* Footer */}
          <div style={{ borderTop: "1px solid #2e261f", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setSaveDialogOpen(true)}
                disabled={saving || builderSteps.length === 0}
                style={S.saveBtn}>
                💾 Save Line
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button style={S.navBtn} disabled={currentLineIdx === 0} onClick={() => setCurrentLineIdx(i => i - 1)}>‹</button>
              <span style={{ fontSize: 12, color: "#c4b293", minWidth: 40, textAlign: "center" }}>{currentLineIdx + 1} / {allCount}</span>
              <button style={S.navBtn} onClick={handleNextLine}>›</button>
            </div>
          </div>
        </div>
      </div>
      <SaveDialog
        active={saveDialogOpen}
        currentModuleId={moduleId}
        onCancel={() => setSaveDialogOpen(false)}
        onConfirm={async ({ moduleId: targetModule, filename, isNew }) => {
          setSaveDialogOpen(false);
          await handleSaveLine(targetModule, filename, isNew);
        }}
      />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  label: { fontSize: 10, fontWeight: "bold", color: "#6a5a3a", letterSpacing: "1px", textTransform: "uppercase" },
  textarea: { background: "#120f0c", border: "1px solid #2e261f", color: "#c4b293", fontSize: 13, padding: "8px", fontFamily: "Georgia, serif", width: "100%", boxSizing: "border-box", resize: "vertical", outline: "none", lineHeight: "1.5" },
  navBtn: { background: "#1c1712", border: "1px solid #362f25", color: "#a69272", fontSize: 13, padding: "4px 12px", fontFamily: "Georgia, serif", cursor: "pointer" },
  modeBtn: { fontSize: 11, padding: "3px 10px", fontFamily: "Georgia, serif", cursor: "pointer", border: "1px solid", letterSpacing: "0.5px" },
  sideBtn: { flex: 1, fontSize: 12, padding: "5px 8px", fontFamily: "Georgia, serif", cursor: "pointer", border: "1px solid", textAlign: "center" as const },
  saveBtn: { background: "#2d3b28", border: "1px solid #41543b", color: "#cadbc3", fontSize: 12, padding: "7px 16px", fontFamily: "Georgia, serif", cursor: "pointer" },
  publishBtn: { background: "#3d4a36", border: "1px solid #4d5e46", color: "#cadbc3", fontSize: 11, padding: "5px 12px", fontFamily: "Georgia, serif", cursor: "pointer", fontWeight: "bold" },
  closeBtn: { background: "#2a1a1a", border: "1px solid #4a2a2a", color: "#cc8a8a", fontSize: 11, padding: "5px 10px", fontFamily: "Georgia, serif", cursor: "pointer" },
  setStartBtn: { background: "#1a2030", border: "1px solid #2e3f5e", color: "#8aadcc", fontSize: 11, padding: "6px 10px", fontFamily: "Georgia, serif", cursor: "pointer", width: "100%" },
  tokenBtn: { padding: "4px 9px", fontSize: 13, cursor: "pointer", border: "1px solid transparent", borderRadius: 2, fontFamily: "monospace", fontWeight: "bold", display: "flex", alignItems: "center" },
  tokenWhite: { background: "#e8dcc8", color: "#2b2118", border: "1px solid #c4b293" },
  tokenBlack: { background: "#2b2118", color: "#e8dcc8", border: "1px solid #4a3f31" },
  tokenActive: { outline: "2px solid #56a364", outlineOffset: "2px" },
  th: { padding: "6px 8px", fontSize: 10, color: "#a69272", fontWeight: "normal", textAlign: "left" as const, letterSpacing: "1px", textTransform: "uppercase" as const },
  tableInput: { background: "transparent", border: "none", color: "#c4b293", fontSize: 12, width: "100%", outline: "none", fontFamily: "Georgia, serif" },
};