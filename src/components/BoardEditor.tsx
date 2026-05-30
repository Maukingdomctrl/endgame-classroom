/**
 * BoardEditor.tsx  (was: boardeditor.tsx — renamed to fix case-sensitive import)
 *
 * Floating draggable editor window for teachers.
 * - Left:  interactive board + FEN input + piece palette
 * - Right: lesson text fields + per-step hint/explanation editor
 * - Save:  serialises to PGN and calls api/save-pgn
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Chessboard }  from "react-chessboard";
import { Chess }       from "chess.js";
import type { RawLesson, LessonStep } from "../modules/module1/loader";

// FIX Issue 2: Import loadAllModules and getModuleData
import { loadAllModules, getModuleData } from "../modules/moduleLoader";
import { lessonToPgn } from "../engine/lessonToPgn";

// ── Piece palette ─────────────────────────────────────────────────────────────
const PIECES = [
  { label: "♔", code: "wK" }, { label: "♕", code: "wQ" },
  { label: "♖", code: "wR" }, { label: "♗", code: "wB" },
  { label: "♘", code: "wN" }, { label: "♙", code: "wP" },
  { label: "♚", code: "bK" }, { label: "♛", code: "bQ" },
  { label: "♜", code: "bR" }, { label: "♝", code: "bB" },
  { label: "♞", code: "bN" }, { label: "♟", code: "bP" },
];

interface Props {
  lesson:   RawLesson;
  onClose:  () => void;
  onSaved:  (updated: RawLesson) => void;
  moduleId: string;
  filename: string;
}

function safeFen(fen: string): string {
  try { new Chess(fen); return fen; }
  catch { return "4k3/8/8/8/8/8/8/4K3 w - - 0 1"; }
}

function fenIsValid(fen: string): boolean {
  try { new Chess(fen); return true; } catch { return false; }
}

export default function BoardEditor({ lesson, onClose, onSaved, moduleId, filename }: Props) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const [pos, setPos] = useState({ x: 60, y: 40 });

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragOrigin.current) return;
      setPos({
        x: dragOrigin.current.px + e.clientX - dragOrigin.current.mx,
        y: dragOrigin.current.py + e.clientY - dragOrigin.current.my,
      });
    }
    function onUp() { dragOrigin.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  const [draft, setDraft]         = useState<RawLesson>(() => JSON.parse(JSON.stringify(lesson)));
  const [stepIdx, setStepIdx]     = useState(0);
  const [fen, setFen]             = useState(() => safeFen(lesson.startFen));
  const [fenInput, setFenInput]   = useState(lesson.startFen);
  const [fenError, setFenError]   = useState("");
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");

  const currentStep: LessonStep | undefined = draft.steps[stepIdx];

  function applyFen(raw: string) {
    setFenInput(raw);
    if (fenIsValid(raw)) {
      setFen(raw);
      setDraft((d) => ({ ...d, startFen: raw }));
      setFenError("");
    } else {
      setFenError("Invalid FEN");
    }
  }

  function onPieceDrop(src: string, tgt: string): boolean {
    try {
      const g = new Chess(fen);
      const piece = g.get(src as any);
      if (!piece) return false;
      g.remove(src as any);
      g.remove(tgt as any);
      g.put(piece, tgt as any);
      const newFen = g.fen();
      setFen(newFen); setFenInput(newFen);
      setDraft((d) => ({ ...d, startFen: newFen }));
      return true;
    } catch { return false; }
  }

  function onSquareClick(square: string) {
    if (!selectedPiece) return;
    try {
      const g = new Chess(fen);
      const color = selectedPiece[0] as "w" | "b";
      const type  = selectedPiece[1].toLowerCase() as any;
      g.remove(square as any);
      g.put({ type, color }, square as any);
      const newFen = g.fen();
      setFen(newFen); setFenInput(newFen);
      setDraft((d) => ({ ...d, startFen: newFen }));
    } catch { /* ignore */ }
  }

  function onSquareRightClick(square: string) {
    try {
      const g = new Chess(fen);
      g.remove(square as any);
      const newFen = g.fen();
      setFen(newFen); setFenInput(newFen);
      setDraft((d) => ({ ...d, startFen: newFen }));
    } catch { /* ignore */ }
  }

  function updateLesson(field: keyof RawLesson, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function updateStep(field: keyof LessonStep, value: string) {
    setDraft((d) => {
      const steps = d.steps.map((s, i) => i === stepIdx ? { ...s, [field]: value } : s);
      return { ...d, steps };
    });
  }

  // FIX Issue 3: Safely merge the draft lesson back into the full module array to prevent wiping siblings
  function updateAndExportModulePgn(updatedLesson: RawLesson, modId: string): string {
    const fullModule = getModuleData(modId);
    if (!fullModule || !fullModule.lessons) {
      // Fallback: If we can't find the module, just serialize the single lesson
      return lessonToPgn(updatedLesson);
    }

    // Map through the existing lessons, replacing the old version of THIS lesson with the draft
    const updatedLessonsList = fullModule.lessons.map((l: RawLesson) => 
      l.id === updatedLesson.id ? updatedLesson : l
    );

    // Serialize ALL lessons in the module, appending them with double newlines
    return updatedLessonsList.map((l: RawLesson) => lessonToPgn(l)).join("\n\n");
  }

  async function save() {
    setSaving(true); setSaveMsg("");
    try {
      // Generate the unified PGN text containing all lessons for this module
      const combinedPgnText = updateAndExportModulePgn(draft, moduleId);
      
      // Override the auto-generated filename to target the primary module file
      // Note: If you eventually implement multi-file modules, this logic will need to track origin files
      const moduleTargetFilename = "0001-endgame-lessons";

      // FIX Issue 1: Using relative /api path
      const res = await fetch("/api/save-pgn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, filename: moduleTargetFilename, pgnText: combinedPgnText }),
      });
      
      const data = await res.json();
      
      if (data.ok) { 
        setSaveMsg("✓ Saved"); 
        
        // FIX Issue 2: Refresh the global cache so the UI updates immediately
        await loadAllModules();
        
        onSaved(draft); 
      }
      else { 
        setSaveMsg("✗ Save failed"); 
      }
    } catch {
      setSaveMsg("✗ Sync server not running");
    } finally {
      setSaving(false);
    }
  }

  const BOARD_SIZE = 320;

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 100, width: 780,
        background: "#1a1510", border: "1px solid #4a3f31",
        boxShadow: "0 24px 64px rgba(0,0,0,0.95)", fontFamily: "Georgia, serif", userSelect: "none" }}
    >
      {/* Title bar */}
      <div onMouseDown={onMouseDown}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", background: "#120f0c", borderBottom: "1px solid #2e261f", cursor: "grab" }}
      >
        <span style={{ color: "#c4b293", fontSize: 13, letterSpacing: "1px", textTransform: "uppercase" }}>
          ✒ Lesson Editor
        </span>
        <div style={{ display: "flex", gap: 8 }} data-no-drag="1">
          <span style={{ fontSize: 11, color: saveMsg.startsWith("✓") ? "#7cb37c" : "#cc8a8a" }}>{saveMsg}</span>
          <button onClick={save} disabled={saving} style={S.saveBtn}>{saving ? "Saving…" : "💾 Save PGN"}</button>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 0 }}>
        {/* Left: board + FEN + palette */}
        <div style={{ padding: "14px 12px 14px 14px", display: "flex", flexDirection: "column", gap: 10, borderRight: "1px solid #2e261f" }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", width: BOARD_SIZE }}>
            {PIECES.map((p) => (
              <button key={p.code} data-no-drag="1"
                onClick={() => setSelectedPiece(selectedPiece === p.code ? null : p.code)}
                title={p.code}
                style={{ ...S.pieceBtn,
                  background: selectedPiece === p.code ? "#3a2f1f" : "#1c1712",
                  border:     selectedPiece === p.code ? "1px solid #a69272" : "1px solid #362f25",
                  color:      p.code[0] === "w" ? "#e8dcc8" : "#8a7a6a" }}
              >{p.label}</button>
            ))}
            {selectedPiece && (
              <button data-no-drag="1" onClick={() => setSelectedPiece(null)}
                style={{ ...S.pieceBtn, color: "#cc8a8a", border: "1px solid #824b4b" }}>✕</button>
            )}
          </div>

          <div data-no-drag="1"
            style={{ width: BOARD_SIZE, height: BOARD_SIZE, border: "8px solid #26211a",
              boxSizing: "border-box", cursor: selectedPiece ? "crosshair" : "default" }}
          >
            <Chessboard position={fen} onPieceDrop={onPieceDrop}
              onSquareClick={onSquareClick} onSquareRightClick={onSquareRightClick}
              boardWidth={BOARD_SIZE - 16} animationDuration={150}
              customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
              customDarkSquareStyle={{ backgroundColor: "#403425" }} />
          </div>

          <div data-no-drag="1" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={S.label}>Position FEN</label>
            <textarea value={fenInput} onChange={(e) => applyFen(e.target.value)} rows={2}
              style={{ ...S.textarea, fontFamily: "monospace", fontSize: 11,
                color: fenError ? "#cc8a8a" : "#c4b293" }} />
            {fenError && <span style={{ color: "#cc8a8a", fontSize: 11 }}>{fenError}</span>}
            <span style={{ fontSize: 10, color: "#6a5a3a" }}>
              Click palette piece → click square to place. Right-click to remove.
            </span>
          </div>
        </div>

        {/* Right: text fields */}
        <div data-no-drag="1" style={{ flex: 1, padding: "14px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: 520 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={S.label}>Title</label>
            <input value={draft.title} onChange={(e) => updateLesson("title", e.target.value)} style={S.input} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={S.label}>Intro</label>
            <textarea value={draft.intro} onChange={(e) => updateLesson("intro", e.target.value)} rows={3} style={S.textarea} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={S.label}>Objective</label>
            <textarea value={draft.objective} onChange={(e) => updateLesson("objective", e.target.value)} rows={2} style={S.textarea} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={S.label}>Final Reflection</label>
            <textarea value={draft.finalReflection ?? ""} onChange={(e) => updateLesson("finalReflection", e.target.value)} rows={2} style={S.textarea} />
          </div>

          {/* Step editor */}
          <div style={{ borderTop: "1px solid #2e261f", paddingTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ ...S.label, margin: 0 }}>
                Step {stepIdx + 1} of {draft.steps.length} — <span style={{ color: "#c4b293" }}>{currentStep?.correctMove}</span>
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0} style={S.navBtn}>←</button>
                <button onClick={() => setStepIdx((i) => Math.min(draft.steps.length - 1, i + 1))} disabled={stepIdx === draft.steps.length - 1} style={S.navBtn}>→</button>
              </div>
            </div>

            {currentStep && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
                  <label style={S.label}>Hint (shown to student)</label>
                  <textarea value={currentStep.hint ?? ""} onChange={(e) => updateStep("hint", e.target.value)} rows={2} style={S.textarea} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={S.label}>Explanation (shown after correct move)</label>
                  <textarea value={currentStep.explanation ?? ""} onChange={(e) => updateStep("explanation", e.target.value)} rows={2} style={S.textarea} />
                </div>
                {currentStep.opponentReply && (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "#120f0c", border: "1px solid #2e261f" }}>
                    <span style={{ ...S.label, display: "block", marginBottom: 4 }}>
                      Opponent reply: <span style={{ color: "#c4b293" }}>{currentStep.opponentReply.move}</span>
                    </span>
                    <textarea
                      value={currentStep.opponentReply.explanation ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraft((d) => {
                          const steps = d.steps.map((s, i) =>
                            i === stepIdx ? { ...s, opponentReply: { ...s.opponentReply!, explanation: val } } : s
                          );
                          return { ...d, steps };
                        });
                      }}
                      placeholder="Opponent reply annotation (optional)"
                      rows={2} style={S.textarea} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step dots */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingTop: 4 }}>
            {draft.steps.map((_, i) => (
              <div key={i} onClick={() => setStepIdx(i)}
                style={{ width: 8, height: 8, cursor: "pointer", border: "1px solid #4a3f31",
                  background: i === stepIdx ? "#a69272" : i < stepIdx ? "#4a5743" : "#2e261f" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  label:    { fontSize: 10, fontWeight: "bold", color: "#6a5a3a", letterSpacing: "1px", textTransform: "uppercase" },
  input:    { background: "#120f0c", border: "1px solid #2e261f", color: "#c4b293", fontSize: 13, padding: "5px 8px", fontFamily: "Georgia, serif", width: "100%", boxSizing: "border-box", outline: "none" },
  textarea: { background: "#120f0c", border: "1px solid #2e261f", color: "#c4b293", fontSize: 13, padding: "5px 8px", fontFamily: "Georgia, serif", width: "100%", boxSizing: "border-box", resize: "vertical", outline: "none", lineHeight: "1.5" },
  pieceBtn: { width: 30, height: 30, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: 0 },
  navBtn:   { background: "#1c1712", border: "1px solid #362f25", color: "#a69272", fontSize: 12, padding: "3px 10px", fontFamily: "Georgia, serif", cursor: "pointer" },
  saveBtn:  { background: "#2d3b28", border: "1px solid #41543b", color: "#cadbc3", fontSize: 11, padding: "4px 12px", fontFamily: "Georgia, serif", cursor: "pointer", letterSpacing: "0.5px" },
  closeBtn: { background: "#2a1a1a", border: "1px solid #4a2a2a", color: "#cc8a8a", fontSize: 11, padding: "4px 10px", fontFamily: "Georgia, serif", cursor: "pointer" },
};