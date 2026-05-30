/**
 * App.tsx — Endgame Classroom
 * Full rewrite featuring upgraded Knight Navigator mechanics & Native Hinting:
 * - Native Tap-to-Move / Click-to-Move support for trackpads and mobile
 * - Local fallback highlights for hints in Guided Mode (no Stockfish needed)
 * - Explicit feedback when toggling between Learn and Play modes
 * - Strict 10-second timer per complete Knight puzzle 
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { Session } from "../engine/session";
import { getModuleData, onModulesReloaded } from "../modules/moduleLoader";
import { useStockfish } from "../engine/useStockfish";
import EvalBar, { EVAL_W, EVAL_GAP } from "../components/EvalBar";
import BoardEditor from "../components/BoardEditor";


const BOARD_BORDER = 10;
const FALLBACK_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

interface KnightPuzzle {
  startSq: string;
  targetSq: string;
  par: number;
  userPath: string[];
  correctPath: string[];
  status: "pending" | "correct" | "failed";
}

// ── Utility: Move to Instruction ──────────────────────────────────────────────
function moveToInstruction(san: string, fen: string): string {
  if (!san) return "";
  try {
    const game = new Chess(fen);
    const m = game.move(san);
    game.undo(); // Revert so the instance isn't permanently mutated

    if (!m) return `Play ${san}`;

    if (m.flags.includes("k")) return "Castle kingside.";
    if (m.flags.includes("q")) return "Castle queenside.";

    const pieces: Record<string, string> = {
      p: "Pawn",
      n: "Knight",
      b: "Bishop",
      r: "Rook",
      q: "Queen",
      k: "King",
    };

    const pieceName = pieces[m.piece] || "Piece";
    const target = m.to;
    const isCapture = m.flags.includes("c") || m.flags.includes("e");
    const isPromotion = m.flags.includes("p") || m.promotion;

    let instruction = isCapture
      ? `${pieceName} captures on ${target}`
      : `Move ${pieceName} to ${target}`;

    if (isPromotion && m.promotion) {
      const promoPiece = pieces[m.promotion.toLowerCase()] || "Queen";
      instruction += ` and promote to ${promoPiece}`;
    }

    if (m.san.includes("#")) {
      instruction += ", delivering checkmate!";
    } else if (m.san.includes("+")) {
      instruction += ", giving check.";
    } else {
      instruction += ".";
    }

    return instruction;
  } catch (e) {
    return `Play ${san}`;
  }
}

// ── Board ─────────────────────────────────────────────────────────────────────
function Board({
  fen,
  boardSize,
  onPieceDrop,
  onSquareClick,
  hintSquares = [],
  clickFromSquare = null,
  boardOrientation = "white",
}: {
  fen: string;
  boardSize: number;
  onPieceDrop: (s: string, t: string) => boolean;
  onSquareClick?: (sq: string) => void;
  hintSquares?: string[];
  clickFromSquare?: string | null;
  boardOrientation?: "white" | "black";
}) {
  const innerSize = boardSize - BOARD_BORDER * 2;

  const squareStyles: Record<string, CSSProperties> = {};
  hintSquares.forEach((sq, i) => {
    squareStyles[sq] = {
      backgroundColor:
        i === 0 ? "rgba(255,200,80,0.6)" : "rgba(100,210,130,0.6)",
      transition: "background-color 0.3s ease",
    };
  });

  if (clickFromSquare) {
    squareStyles[clickFromSquare] = {
      ...squareStyles[clickFromSquare],
      backgroundColor: "rgba(90, 130, 200, 0.6)",
    };
  }

  return (
    <div
      style={{
        width: boardSize,
        height: boardSize,
        border: `${BOARD_BORDER}px solid #26211a`,
        boxSizing: "border-box",
        flexShrink: 0,
        overflow: "hidden",
        outline: "1px solid #ebdcb9",
        boxShadow: "0 16px 36px rgba(0,0,0,0.9)",
      }}
    >
      <Chessboard
        key={`classroom-board-${boardOrientation}`}
        position={fen}
        onPieceDrop={onPieceDrop}
        onSquareClick={onSquareClick}
        arePiecesDraggable={true}
        boardWidth={innerSize}
        boardOrientation={boardOrientation}
        customBoardStyle={{ borderRadius: 0 }}
        customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
        customDarkSquareStyle={{ backgroundColor: "#403425" }}
        customSquareStyles={squareStyles}
        animationDuration={300}
      />
    </div>
  );
}

// ── HintPopup ─────────────────────────────────────────────────────────────────
function HintPopup({
  hint,
  explanation,
  onClose,
}: {
  hint: string;
  explanation: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        background: "#1a1510",
        border: "1px solid #a69272",
        boxSizing: "border-box",
        boxShadow: "0 8px 32px rgba(0,0,0,0.95)",
        padding: "12px 16px",
        maxWidth: 340,
        width: "90vw",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: "bold",
            color: "#8c7e6b",
            letterSpacing: "1px",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
          }}
        >
          💡 Coach Hint
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#6b5e4c",
            cursor: "pointer",
            fontSize: 13,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>
      <p
        style={{
          margin: 0,
          color: "#d9cb9e",
          fontSize: 13,
          fontFamily: "Georgia, serif",
          lineHeight: "1.5",
        }}
      >
        {hint || "Study the position carefully."}
      </p>
      {explanation && explanation !== hint && (
        <p
          style={{
            margin: "8px 0 0",
            color: "#a3b39c",
            fontSize: 12,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            lineHeight: "1.4",
          }}
        >
          {explanation}
        </p>
      )}
    </div>
  );
}

// ── HOME PAGE VIEW ────────────────────────────────────────────────────────────
function HomeView({ onOpenModule }: { onOpenModule: (mod: string) => void }) {
  const modules = [
    {
      id: "module1",
      title: "Capablanca Fundamentals",
      num: "I",
      locked: false,
      desc: "Master the essential principles, opposition, and basic checkmates.",
    },
    {
      id: "module2",
      title: "The Rook's Domain",
      num: "II",
      locked: false,
      desc: "Philidor, Lucena, and complex rook vs pawn endgames.",
    },
    {
      id: "module3",
      title: "Minor Piece Mastery",
      num: "III",
      locked: true,
      desc: "Knights, Bishops, and the subtleties of minor piece domination.",
    },
    {
      id: "module4",
      title: "Queen Endgames",
      num: "IV",
      locked: true,
      desc: "Navigating perpetual checks, centralization, and pawn races.",
    },
    {
      id: "module5",
      title: "Pawn Architecture",
      num: "V",
      locked: true,
      desc: "Breakthroughs, distant opposition, and triangulation.",
    },
    {
      id: "vision-game",
      title: "Board- Vision Trainer",
      num: "Bonus",
      locked: false,
      desc: "Empty board. 30 seconds. Click the target square as fast as possible.",
    },
    {
      id: "knight-game",
      title: "Knight Navigator",
      num: "Bonus",
      locked: false,
      desc: "Find the absolute fastest route to the target location before time expires.",
    },
  ];

  return (
    <div style={S.page}>
      <style>
        {`
          .module-card { transition: all 0.2s ease; cursor: pointer; }
          .module-card:hover { transform: translateY(-4px); border-color: #a69272 !important; background-color: #261f17 !important; }
          .locked-card { opacity: 0.5; cursor: not-allowed; }
        `}
      </style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: 800,
          paddingTop: "32px",
        }}
      >
        <div style={S.vintageHeaderBlock}>
          <div style={S.headerTopBorder} />
          <h1 style={S.centeredTitle}>Endgame Classroom</h1>
          <div style={S.headerSubtitleRow}>
            <span style={S.headerEst}>ACADEMY CURRICULUM</span>
            <span style={S.headerOrnament}>❖</span>
            <span style={S.headerEst}>ESTABLISHED 1886</span>
          </div>
          <div style={S.headerBottomBorder} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
            width: "100%",
            marginTop: 32,
          }}
        >
          {modules.map((mod) => (
            <div
              key={mod.id}
              className={mod.locked ? "locked-card" : "module-card"}
              onClick={() => !mod.locked && onOpenModule(mod.id)}
              style={{
                background: "#1c1712",
                border: "1px solid #362f25",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                position: "relative",
              }}
            >
              <div
                style={{
                  color: "#7a6e5d",
                  fontSize: 13,
                  fontWeight: "bold",
                  fontFamily: "Georgia, serif",
                }}
              >
                {mod.num === "Bonus" ? "⭐ BONUS" : `MODULE ${mod.num}`}
              </div>
              <h2
                style={{
                  color: "#d9cb9e",
                  fontSize: 18,
                  margin: 0,
                  fontFamily: "Georgia, serif",
                }}
              >
                {mod.title}
              </h2>
              <div style={{ height: "1px", background: "#362f25", width: "100%" }} />
              <p
                style={{
                  color: "#a69272",
                  fontSize: 12,
                  margin: 0,
                  lineHeight: 1.5,
                  fontFamily: "Georgia, serif",
                }}
              >
                {mod.desc}
              </p>
              {mod.locked && (
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    fontSize: 11,
                    color: "#824b4b",
                    fontWeight: "bold",
                    border: "1px solid #824b4b",
                    padding: "2px 6px",
                    borderRadius: 2,
                  }}
                >
                  LOCKED
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BOARD VISION CHALLENGE VIEW ───────────────────────────────────────────────
function VisionGameView({ onBack }: { onBack: () => void }) {
  const [boardSize, setBoardSize] = useState(500);
  const [gameState, setGameState] = useState<"idle" | "playing" | "gameover">(
    "idle"
  );
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [targetSquare, setTargetSquare] = useState<string>("");
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">(
    "white"
  );
  const [feedbackSquare, setFeedbackSquare] = useState<{
    square: string;
    correct: boolean;
  } | null>(null);

  useEffect(() => {
    function resize() {
      const windowH = window.innerHeight;
      setBoardSize(Math.min(window.innerWidth - 50, windowH - 250, 500));
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getRandomSquare = () => {
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];
    const randomFile = files[Math.floor(Math.random() * 8)];
    const randomRank = ranks[Math.floor(Math.random() * 8)];
    return `${randomFile}${randomRank}`;
  };

  const startGame = () => {
    setScore(0);
    setTimeLeft(30);
    setTargetSquare(getRandomSquare());
    setFeedbackSquare(null);
    setGameState("playing");
  };

  useEffect(() => {
    if (gameState === "playing" && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (timeLeft === 0 && gameState === "playing") {
      setGameState("gameover");
      setFeedbackSquare(null);
    }
  }, [timeLeft, gameState]);

  const handleSquareClick = (square: string) => {
    if (gameState !== "playing") return;
    const isCorrect = square === targetSquare;
    setFeedbackSquare({ square, correct: isCorrect });
    if (isCorrect) setScore((s) => s + 1);
    setTargetSquare(getRandomSquare());
  };

  const customSquareStyles: Record<string, CSSProperties> = {};
  if (feedbackSquare) {
    customSquareStyles[feedbackSquare.square] = {
      backgroundColor: feedbackSquare.correct
        ? "rgba(86, 163, 100, 0.85)"
        : "rgba(204, 82, 82, 0.85)",
      transition: "background-color 0.1s ease",
    };
  }

  const innerSize = boardSize - BOARD_BORDER * 2;

  return (
    <div
      style={{
        ...S.page,
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 16,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "#1c1712",
          border: "1px solid #4a3f31",
          color: "#d9cb9e",
          padding: "6px 12px",
          fontSize: 12,
          fontFamily: "Georgia, serif",
          cursor: "pointer",
          zIndex: 10,
        }}
      >
        ↤ Return to Academy
      </button>

      <div style={{ width: "100%", maxWidth: boardSize, textAlign: "center", marginTop: 4 }}>
        <h1 style={{ ...S.centeredTitle, fontSize: 22, marginBottom: 10 }}>
          Board- Vision Trainer
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 16,
              color: "#d9cb9e",
              fontFamily: "monospace",
              background: "#1c1712",
              padding: "5px 10px",
              border: "1px solid #362f25",
            }}
          >
            SCORE: {score}
          </div>

          <button
            type="button"
            style={S.toolBtn}
            onClick={() =>
              setBoardOrientation((prev) => (prev === "white" ? "black" : "white"))
            }
          >
            ⟲ Flip Board
          </button>

          <div
            style={{
              fontSize: 16,
              color: timeLeft <= 5 ? "#cc9999" : "#d9cb9e",
              fontFamily: "monospace",
              background: "#1c1712",
              padding: "5px 10px",
              border: "1px solid #362f25",
            }}
          >
            00:{timeLeft.toString().padStart(2, "0")}
          </div>
        </div>

        <div
          style={{
            position: "relative",
            width: boardSize,
            height: boardSize,
            border: `${BOARD_BORDER}px solid #26211a`,
            boxSizing: "border-box",
            flexShrink: 0,
            outline: "1px solid #ebdcb9",
            boxShadow: "0 16px 36px rgba(0,0,0,0.9)",
          }}
        >
          <Chessboard
            key={`vision-board-${boardOrientation}`}
            position={EMPTY_FEN}
            boardWidth={innerSize}
            boardOrientation={boardOrientation}
            arePiecesDraggable={false}
            onSquareClick={handleSquareClick}
            customBoardStyle={{ borderRadius: 0 }}
            customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
            customDarkSquareStyle={{ backgroundColor: "#403425" }}
            customSquareStyles={customSquareStyles}
          />
        </div>

        <div
          style={{
            marginTop: 16,
            minHeight: 110,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {gameState === "idle" && (
            <button
              type="button"
              onClick={startGame}
              style={{
                ...S.sfBtn,
                fontSize: 16,
                padding: "14px 28px",
                background: "#2b231a",
                borderColor: "#a69272",
                color: "#d9cb9e",
                cursor: "pointer",
              }}
            >
              ▶ Start Challenge (30s)
            </button>
          )}

          {gameState === "playing" && (
            <div
              style={{
                background: "#1c1712",
                border: "2px solid #362f25",
                padding: "10px 40px",
                borderRadius: 4,
                display: "inline-block",
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: "#a69272",
                  fontFamily: "Georgia, serif",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                FIND SQUARE:
              </span>
              <span
                style={{
                  fontSize: 42,
                  fontWeight: "bold",
                  color: "#d9cb9e",
                  fontFamily: "monospace",
                  lineHeight: 1,
                }}
              >
                {targetSquare.toUpperCase()}
              </span>
            </div>
          )}

          {gameState === "gameover" && (
            <div
              style={{
                background: "#1c1712",
                border: "1px solid #362f25",
                padding: "16px 32px",
                width: "100%",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <h2
                style={{
                  color: "#d9cb9e",
                  fontSize: 26,
                  margin: "0 0 6px 0",
                  fontFamily: "Georgia, serif",
                }}
              >
                Time&apos;s Up!
              </h2>
              <p
                style={{
                  color: "#a69272",
                  fontSize: 16,
                  margin: "0 0 14px 0",
                  fontFamily: "monospace",
                }}
              >
                Final Score: {score}
              </p>
              <button
                type="button"
                onClick={startGame}
                style={{
                  ...S.sfBtn,
                  fontSize: 14,
                  padding: "10px 20px",
                  background: "#2b231a",
                  borderColor: "#a69272",
                  color: "#d9cb9e",
                  cursor: "pointer",
                }}
              >
                ⟲ Play Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── KNIGHT NAVIGATOR VIEW ─────────────────────────────────────────────────────
function KnightNavigatorView({ onBack }: { onBack: () => void }) {
  const [boardSize, setBoardSize] = useState(500);
  const [globalTimeLeft, setGlobalTimeLeft] = useState(120); // 2 Minutes
  const [turnTimeLeft, setTurnTimeLeft] = useState(10); // 10s per position
  const [gameState, setGameState] = useState<"intro" | "playing" | "analysis" | "mistakeReview">("intro");
  
  const [score, setScore] = useState(0);
  const [gameHistory, setGameHistory] = useState<KnightPuzzle[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(0);
  
  const [startSq, setStartSq] = useState("a1");
  const [targetSq, setTargetSq] = useState("h8");
  const [currentSq, setCurrentSq] = useState("a1");
  const [path, setPath] = useState<string[]>(["a1"]);
  const [wrongSquare, setWrongSquare] = useState<string | null>(null);
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [knightColor, setKnightColor] = useState<"w" | "b">("w");

  const [newPuzzleTrigger, setNewPuzzleTrigger] = useState(0);
  const [mistakeReviewTrigger, setMistakeReviewTrigger] = useState(0);

  const stateRef = useRef({ currentSq, startSq, targetSq, path, gameHistory, currentHistoryIndex, wrongSquare, gameState });
  
  useEffect(() => {
    stateRef.current = { currentSq, startSq, targetSq, path, gameHistory, currentHistoryIndex, wrongSquare, gameState };
  }, [currentSq, startSq, targetSq, path, gameHistory, currentHistoryIndex, wrongSquare, gameState]);

  useEffect(() => {
    function resize() {
      const windowH = window.innerHeight;
      setBoardSize(Math.min(window.innerWidth - 50, windowH - 280, 500));
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const st = stateRef.current;
      
      if (st.gameState !== "playing" && st.gameState !== "mistakeReview") return;
      
      if (st.gameState === "playing") {
        setGlobalTimeLeft((prev) => {
          if (prev <= 1) {
            setGameState("analysis");
            return 0;
          }
          return prev - 1;
        });
      }

      setTurnTimeLeft((prev) => {
        if (st.currentSq === st.targetSq || st.wrongSquare) return prev; 
        
        if (prev <= 1) {
          const shortestPath = calculateShortestPathArray(st.currentSq, st.targetSq);
          const fullCorrect = [...st.path.slice(0, -1), ...shortestPath];

          const finalizedPuzzle: KnightPuzzle = {
            startSq: st.startSq,
            targetSq: st.targetSq,
            par: calculateShortestPathLength(st.startSq, st.targetSq),
            userPath: [...st.path],
            correctPath: fullCorrect,
            status: "failed",
          };

          setGameHistory((gh) => [...gh, finalizedPuzzle]);

          if (st.gameState === "mistakeReview") {
            setMistakeReviewTrigger((t) => t + 1);
          } else {
            setNewPuzzleTrigger((t) => t + 1);
          }
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (newPuzzleTrigger > 0) generateNewPuzzle();
  }, [newPuzzleTrigger]);

  useEffect(() => {
    if (mistakeReviewTrigger > 0) advanceMistakeReview();
  }, [mistakeReviewTrigger]);

  const calculateShortestPathLength = (start: string, end: string) => {
    return calculateShortestPathArray(start, end).length - 1;
  };

  const calculateShortestPathArray = (start: string, end: string): string[] => {
    const queue: [string, string[]][] = [[start, [start]]];
    const visited = new Set([start]);
    const moves = [
      [1, 2], [1, -2], [-1, 2], [-1, -2],
      [2, 1], [2, -1], [-2, 1], [-2, -1],
    ];

    while (queue.length > 0) {
      const [curr, currentPath] = queue.shift()!;
      if (curr === end) return currentPath;

      const file = curr.charCodeAt(0) - 97;
      const rank = Number(curr[1]) - 1;

      for (const [df, dr] of moves) {
        const nf = file + df;
        const nr = rank + dr;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const next = String.fromCharCode(97 + nf) + (nr + 1);
          if (!visited.has(next)) {
            visited.add(next);
            queue.push([next, [...currentPath, next]]);
          }
        }
      }
    }
    return [start];
  };

  const getKnightFen = (sq: string, color: "w" | "b" = "w") => {
    if (!sq || sq.length !== 2) return EMPTY_FEN;
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1]) - 1;
    let fen = "";
    const piece = color === "w" ? "N" : "n";
    
    for (let r = 7; r >= 0; r--) {
      if (r === rank) {
        const emptyBefore = file;
        const emptyAfter = 7 - file;
        fen += (emptyBefore > 0 ? emptyBefore : "") + piece + (emptyAfter > 0 ? emptyAfter : "");
      } else {
        fen += "8";
      }
      if (r > 0) fen += "/";
    }
    return fen + " w - - 0 1";
  };

  const randomSquare = () => {
    const files = "abcdefgh";
    return files[Math.floor(Math.random() * 8)] + (Math.floor(Math.random() * 8) + 1);
  };

  const startMainGame = () => {
    setScore(0);
    setGlobalTimeLeft(120);
    setGameHistory([]);
    setGameState("playing");
    setupNewPuzzleData();
  };

  const setupNewPuzzleData = (chosenStart?: string, chosenTarget?: string) => {
    let s = chosenStart || randomSquare();
    let t = chosenTarget || randomSquare();
    while (t === s) t = randomSquare();

    setStartSq(s);
    setTargetSq(t);
    setCurrentSq(s);
    setPath([s]);
    setWrongSquare(null);
    setTurnTimeLeft(10);
  };

  const generateNewPuzzle = () => {
    setupNewPuzzleData();
  };

  const isKnightMove = (from: string, to: string) => {
    const fD = Math.abs(to.charCodeAt(0) - from.charCodeAt(0));
    const rD = Math.abs(Number(to[1]) - Number(from[1]));
    return (fD === 1 && rD === 2) || (fD === 2 && rD === 1);
  };

  const handleSquareClick = (sq: string) => {
    if (gameState !== "playing" && gameState !== "mistakeReview") return;
    if (wrongSquare || currentSq === targetSq) return;

    if (!isKnightMove(currentSq, sq)) {
      triggerWrongMove(sq);
      return;
    }

    const expectedDist = calculateShortestPathLength(currentSq, targetSq);
    const newDist = calculateShortestPathLength(sq, targetSq);

    if (newDist >= expectedDist) {
      triggerWrongMove(sq);
      return;
    }

    const nextPath = [...path, sq];
    setPath(nextPath);
    setCurrentSq(sq);

    if (sq === targetSq) {
      const finalPuzzleRecord: KnightPuzzle = {
        startSq,
        targetSq,
        par: calculateShortestPathLength(startSq, targetSq),
        userPath: nextPath,
        correctPath: nextPath,
        status: "correct",
      };

      setGameHistory((prev) => [...prev, finalPuzzleRecord]);
      if (gameState !== "mistakeReview") setScore((s) => s + 1);

      setTimeout(() => {
        if (stateRef.current.gameState === "mistakeReview") {
          setMistakeReviewTrigger(t => t + 1);
        } else {
          setNewPuzzleTrigger(t => t + 1);
        }
      }, 600);
    }
  };

  const triggerWrongMove = (sq: string) => {
    setWrongSquare(sq);
    const shortestRem = calculateShortestPathArray(currentSq, targetSq);
    const finalizedCorrectPath = [...path.slice(0, -1), ...shortestRem];

    const finalPuzzleRecord: KnightPuzzle = {
      startSq,
      targetSq,
      par: calculateShortestPathLength(startSq, targetSq),
      userPath: [...path, sq],
      correctPath: finalizedCorrectPath,
      status: "failed",
    };

    setGameHistory((prev) => [...prev, finalPuzzleRecord]);

    setTimeout(() => {
      if (stateRef.current.gameState === "mistakeReview") {
        setMistakeReviewTrigger(t => t + 1);
      } else {
        setNewPuzzleTrigger(t => t + 1);
      }
    }, 1200);
  };

  const startMistakeReviewLoop = () => {
    const failedIndices = gameHistory.map((p, i) => (p.status === "failed" ? i : -1)).filter((i) => i !== -1);
    if (failedIndices.length === 0) return;

    setGameState("mistakeReview");
    setCurrentHistoryIndex(failedIndices[0]);
    const targetPuzzle = gameHistory[failedIndices[0]];
    setupNewPuzzleData(targetPuzzle.startSq, targetPuzzle.targetSq);
  };

  const advanceMistakeReview = () => {
    const historyRef = stateRef.current.gameHistory;
    const failedIndices = historyRef.map((p, i) => (p.status === "failed" ? i : -1)).filter((i) => i !== -1);
    const currentSubIndex = failedIndices.indexOf(currentHistoryIndex);

    if (currentSubIndex !== -1 && currentSubIndex + 1 < failedIndices.length) {
      const nextIdx = failedIndices[currentSubIndex + 1];
      setCurrentHistoryIndex(nextIdx);
      const targetPuzzle = historyRef[nextIdx];
      setupNewPuzzleData(targetPuzzle.startSq, targetPuzzle.targetSq);
    } else {
      setGameState("analysis");
      setCurrentHistoryIndex(0);
    }
  };

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};

    if (gameState === "playing" || gameState === "mistakeReview") {
      styles[startSq] = { backgroundColor: "rgba(90, 130, 200, 0.4)" };
      styles[currentSq] = { backgroundColor: "rgba(86, 163, 100, 0.4)" };
      
      styles[targetSq] = { 
        backgroundColor: "rgba(217, 180, 100, 0.8)",
        border: "3px solid #e0c98b",
        boxShadow: "inset 0 0 15px rgba(255,215,0,0.5)",
        animation: "pulseHouseGlow 1.5s infinite alternate ease-in-out",
        boxSizing: "border-box"
      };

      path.forEach((sq) => {
        styles[sq] = { backgroundColor: "rgba(86, 163, 100, 0.55)", border: "1px solid #56a364" };
      });

      if (wrongSquare) {
        styles[wrongSquare] = { backgroundColor: "rgba(204, 82, 82, 0.85)", border: "2px solid #cc5252" };
      }
    } else if (gameState === "analysis" && gameHistory.length > 0) {
      const currentActiveRecord = gameHistory[currentHistoryIndex];
      if (currentActiveRecord) {
        styles[currentActiveRecord.startSq] = { backgroundColor: "rgba(90, 130, 200, 0.5)" };
        styles[currentActiveRecord.targetSq] = { backgroundColor: "rgba(217, 203, 158, 0.6)", border: "2px solid #ebdcb9" };
      }
    }

    return styles;
  }, [gameState, currentSq, startSq, targetSq, path, wrongSquare, gameHistory, currentHistoryIndex]);

  const analysisCustomArrows = useMemo(() => {
    if (gameState !== "analysis" || gameHistory.length === 0) return [];
    const currentActiveRecord = gameHistory[currentHistoryIndex];
    if (!currentActiveRecord) return [];

    const arrows: Array<[string, string, string]> = [];
    const pathArr = currentActiveRecord.correctPath;
    for (let i = 0; i < pathArr.length - 1; i++) {
      arrows.push([pathArr[i], pathArr[i + 1], "#64d282"]);
    }
    return arrows;
  }, [gameState, gameHistory, currentHistoryIndex]);

  const innerSize = boardSize - BOARD_BORDER * 2;
  const failedPuzzlesCount = gameHistory.filter((p) => p.status === "failed").length;
  
  const activeFen = gameState === "analysis" ? EMPTY_FEN : getKnightFen(currentSq, knightColor);

  return (
    <div style={{ ...S.page, flexDirection: "column", alignItems: "center", paddingTop: 16 }}>
      <style>
        {`
          @keyframes pulseHouseGlow {
            0% { box-shadow: inset 0 0 0 2px #ebdcb9, inset 0 0 8px rgba(235, 220, 185, 0.3); background-color: rgba(217, 180, 100, 0.5); }
            50% { box-shadow: inset 0 0 0 4px #ebdcb9, inset 0 0 16px rgba(235, 220, 185, 0.8); background-color: rgba(217, 180, 100, 0.9); }
            100% { box-shadow: inset 0 0 0 2px #ebdcb9, inset 0 0 8px rgba(235, 220, 185, 0.3); background-color: rgba(217, 180, 100, 0.5); }
          }
        `}
      </style>

      <button
        type="button"
        onClick={onBack}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "#1c1712",
          border: "1px solid #4a3f31",
          color: "#d9cb9e",
          padding: "6px 12px",
          fontSize: 12,
          fontFamily: "Georgia, serif",
          cursor: "pointer",
          zIndex: 10,
        }}
      >
        ↤ Return to Academy
      </button>

      <div style={{ width: "100%", maxWidth: boardSize, textAlign: "center", marginTop: 4 }}>
        <h1 style={{ ...S.centeredTitle, fontSize: 22, marginBottom: 10 }}>
          Knight Navigator
        </h1>

        {/* ── INTRO VIEW SCREEN ── */}
        {gameState === "intro" && (
          <div style={{ background: "#1c1712", border: "1px solid #362f25", padding: "24px", textAlign: "center" }}>
            <p style={{ color: "#d9cb9e", fontSize: 15, lineHeight: "1.6", marginBottom: 20 }}>
              <strong>How to Play:</strong> Click the squares to navigate your knight from Start to Target along the absolute fastest path. You have exactly 10 seconds per puzzle and 2 minutes total!
            </p>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 24, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...S.toolBtn, padding: "8px 16px", fontSize: 12 }}
                onClick={() => setKnightColor((p) => (p === "w" ? "b" : "w"))}
              >
                Piece: {knightColor === "w" ? "♘ White" : "♞ Black"}
              </button>
              <button
                type="button"
                style={{ ...S.toolBtn, padding: "8px 16px", fontSize: 12 }}
                onClick={() => setBoardOrientation((p) => (p === "white" ? "black" : "white"))}
              >
                Board: {boardOrientation === "white" ? "White at Bottom" : "Black at Bottom"}
              </button>
            </div>

            <button type="button" onClick={startMainGame} style={{ ...S.sfBtn, fontSize: 14, padding: "10px 20px" }}>
              ▶ Start Mission
            </button>
          </div>
        )}

        {/* ── LIVE INTERACTIVE GAME VIEW ── */}
        {(gameState === "playing" || gameState === "mistakeReview") && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={S.badge}>
                {gameState === "mistakeReview" ? "MISTAKE REVIEW" : `GLOBAL TIME: ${Math.floor(globalTimeLeft / 60)}:${(globalTimeLeft % 60).toString().padStart(2, "0")}`}
              </div>
              
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  style={S.toolBtn}
                  onClick={() => setKnightColor((p) => (p === "w" ? "b" : "w"))}
                  title="Switch Knight Color"
                >
                  {knightColor === "w" ? "♘" : "♞"}
                </button>
                <button
                  type="button"
                  style={S.toolBtn}
                  onClick={() => setBoardOrientation((p) => (p === "white" ? "black" : "white"))}
                >
                  ⟲ Flip
                </button>
              </div>

              <div style={S.badge}>SCORE: {score}</div>
            </div>

            <div style={{ width: "100%", height: 6, background: "#26211a", marginBottom: 14, overflow: "hidden" }}>
              <div 
                style={{ 
                  width: `${(turnTimeLeft / 10) * 100}%`, 
                  height: "100%", 
                  background: turnTimeLeft <= 3 ? "#cc5252" : "#ad9e87",
                  transition: "width 1s linear"
                }} 
              />
            </div>

            <div
              style={{
                position: "relative",
                width: boardSize,
                height: boardSize,
                border: `${BOARD_BORDER}px solid #26211a`,
                boxSizing: "border-box",
                flexShrink: 0,
                outline: "1px solid #ebdcb9",
                boxShadow: "0 16px 36px rgba(0,0,0,0.9)",
              }}
            >
              <Chessboard
                key={`knight-navigator-board-${boardOrientation}`}
                position={activeFen}
                boardWidth={innerSize}
                boardOrientation={boardOrientation}
                arePiecesDraggable={false}
                onSquareClick={handleSquareClick}
                customBoardStyle={{ borderRadius: 0 }}
                customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
                customDarkSquareStyle={{ backgroundColor: "#403425" }}
                customSquareStyles={customSquareStyles}
              />
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 12, justifyContent: "center" }}>
              <span style={S.badge}>Current Position: {currentSq.toUpperCase()}</span>
              <span style={S.badge}>Target Castle: {targetSq.toUpperCase()}</span>
            </div>
          </>
        )}

        {/* ── ANALYSIS & POST GAME WRAP UP VIEW ── */}
        {gameState === "analysis" && gameHistory.length > 0 && (
          <div style={{ background: "#1c1712", border: "1px solid #362f25", padding: "16px", boxSizing: "border-box" }}>
            <h2 style={{ color: "#d9cb9e", fontSize: 20, margin: "0 0 12px 0" }}>Mission Report Card</h2>
            
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <span style={S.badge}>Total Puzzles: {gameHistory.length}</span>
              <span style={{ ...S.badge, color: "#a3b39c" }}>Success Ratio: {score} Correct</span>
              <span style={{ ...S.badge, color: "#cc9999" }}>Missed: {failedPuzzlesCount} Positions</span>
            </div>

            <div
              style={{
                position: "relative",
                width: boardSize,
                height: boardSize,
                border: `${BOARD_BORDER}px solid #26211a`,
                boxSizing: "border-box",
                margin: "0 auto 16px auto",
                outline: "1px solid #ebdcb9",
              }}
            >
              <Chessboard
                key={`analysis-board-${currentHistoryIndex}`}
                position={EMPTY_FEN}
                boardWidth={innerSize}
                boardOrientation={boardOrientation}
                arePiecesDraggable={false}
                customBoardStyle={{ borderRadius: 0 }}
                customLightSquareStyle={{ backgroundColor: "#d9cb9e" }}
                customDarkSquareStyle={{ backgroundColor: "#403425" }}
                customSquareStyles={customSquareStyles}
                customArrows={analysisCustomArrows}
              />
            </div>

            <p style={{ color: "#a69272", fontSize: 13, margin: "0 0 12px 0" }}>
              Reviewing Puzzle {currentHistoryIndex + 1} of {gameHistory.length} ({gameHistory[currentHistoryIndex]?.status.toUpperCase()})
            </p>

            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                style={S.navBtn}
                disabled={currentHistoryIndex === 0}
                onClick={() => setCurrentHistoryIndex((i) => i - 1)}
              >
                ← Back
              </button>
              
              <button
                type="button"
                style={S.sfBtn}
                onClick={startMainGame}
              >
                ⟲ Try Again
              </button>

              {failedPuzzlesCount > 0 && (
                <button
                  type="button"
                  style={{ ...S.nextBtn, marginTop: 4 }}
                  onClick={startMistakeReviewLoop}
                >
                  🚀 Review Mistakes ({failedPuzzlesCount})
                </button>
              )}

              <button
                type="button"
                style={S.navBtn}
                disabled={currentHistoryIndex === gameHistory.length - 1}
                onClick={() => setCurrentHistoryIndex((i) => i + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {gameState === "analysis" && gameHistory.length === 0 && (
          <div style={{ background: "#1c1712", border: "1px solid #362f25", padding: "20px" }}>
            <p style={{ color: "#d9cb9e", marginBottom: 12 }}>Time ran out before any modules were finalized.</p>
            <button type="button" onClick={startMainGame} style={S.sfBtn}>⟲ Start Over</button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── DYNAMIC CLASSROOM VIEW ────────────────────────────────────────────────────
function ClassroomView({ moduleId, onBack }: { moduleId: string; onBack: () => void }) {
  const [boardSize, setBoardSize] = useState(500);
  const [isStacked, setIsStacked] = useState(false);
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const currentModuleData = useMemo(() => getModuleData(moduleId), [moduleId]);

  const [lessonIndex, setLessonIndex] = useState(() => {
    return Number(localStorage.getItem(`endgame_lessonIndex_${moduleId}`)) || 0;
  });

  useEffect(() => {
    localStorage.setItem(`endgame_lessonIndex_${moduleId}`, lessonIndex.toString());
  }, [lessonIndex, moduleId]);

  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");

  const [sfPlayMode, setSfPlayMode] = useState(false);
  const [sfSkillLevel, setSfSkillLevel] = useState(20);
  const [sfPlayFen, setSfPlayFen] = useState(FALLBACK_FEN);
  const [sfWaiting, setSfWaiting] = useState(false);

  const sfPlayFenRef = useRef(FALLBACK_FEN);

  const lesson = useMemo(() => {
    return currentModuleData?.lessons?.[lessonIndex] || {
      id: "m-error",
      module: moduleId,
      title: "Module Data Not Found",
      elo: 0,
      theme: [],
      intro: `Please ensure ${moduleId}/loader.ts exists and is exported correctly.`,
      objective: "",
      steps: [],
      mode: "puzzle" as const,
    };
  }, [lessonIndex, currentModuleData, moduleId]);

  const lessonMode = (lesson as { mode?: string }).mode ?? "puzzle";
  const mastersNote = (lesson as { mastersNote?: string }).mastersNote;
  const studentSide = (lesson as { black?: string }).black;

  const [fen, setFen] = useState(() => lesson?.startFen || FALLBACK_FEN);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [coachSays, setCoachSays] = useState("Study the position. Make your move.");
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [finished, setFinished] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [history, setHistory] = useState<Array<{ fen: string; step: number }>>([
    { fen: lesson?.startFen || FALLBACK_FEN, step: 0 },
  ]);

  const sessionRef = useRef<Session | null>(null);
  if (!sessionRef.current || sessionRef.current.lesson.id !== lesson.id) {
    sessionRef.current = new Session(lesson);
  }
  const activeSession = sessionRef.current;

  const { ready, analyze, playMove, getHint, bar, cp, mate, hintSquares } = useStockfish(
    sfPlayFen,
    true,
    16
  );

  const activeHintSquares = useMemo(() => {
    if (!showHint && lessonMode !== "lecture") return [];
    if (sfPlayMode) return hintSquares;

    const step = lesson?.steps?.[currentStepIndex];
    if (step && step.correctMove) {
      if (step.from && step.to) {
        return [step.from, step.to];
      }
      try {
        const g = new Chess(fen);
        const m = g.move(step.correctMove);
        if (m) return [m.from, m.to];
      } catch (e) {
        // Ignore fallback errors
      }
    }
    return [];
  }, [showHint, sfPlayMode, hintSquares, lesson, currentStepIndex, fen, lessonMode]);

  useEffect(() => {
    if (!lesson || !currentModuleData) return;

    sessionRef.current = new Session(lesson);
    sessionRef.current.reset?.();

    const startFen = lesson.startFen || FALLBACK_FEN;
    setFen(startFen);
    setCurrentStepIndex(0);
    setHistory([{ fen: startFen, step: 0 }]);
    setFeedback(null);
    setFinished(false);
    setShowHint(false);
    setSfPlayMode(false);

    if (lessonMode === "lecture") {
      const firstStep = sessionRef.current?.currentStep;
      if (firstStep && firstStep.correctMove) {
        setCoachSays(moveToInstruction(firstStep.correctMove, startFen));
      } else {
        setCoachSays("Follow the demonstration. Play each move on the board.");
      }
    } else {
      setCoachSays("Study the position. Make your move.");
    }

    const isPlayingBlack = studentSide === "Student";
    setBoardOrientation(isPlayingBlack ? "black" : "white");
  }, [lessonIndex, tick, currentModuleData, lesson, lessonMode, studentSide]);

  useEffect(() => {
    function resize() {
      const windowW = window.innerWidth;
      const windowH = window.innerHeight;
      const stack = windowW < 1000;
      setIsStacked(stack);

      const maxByH = windowH - 170;
      let target = 500;

      if (stack) {
        target = Math.min(windowW - 50, maxByH, 560);
      } else {
        const maxByW = Math.floor((windowW - EVAL_W - EVAL_GAP - 80) * 0.58);
        target = Math.min(maxByH, maxByW, 580);
      }
      setBoardSize(Math.max(target, 400));
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function loadLesson(i: number) {
    if (!currentModuleData?.lessons || i < 0 || i >= currentModuleData.lessons.length) return;
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
      const txt = res.feedback ?? "Incorrect move. Try again or use Hint.";
      setFeedback({ text: txt, ok: false });
      setCoachSays(txt);
      return false;
    }

    const wFen = activeSession.game.fen();
    const midIdx = activeSession.stepIndex;

    setFen(wFen);
    setCurrentStepIndex(midIdx);
    setFeedback({ text: res.feedback!, ok: true });
    setCoachSays(res.feedback!);
    
    if (lessonMode === "lecture" && !res.finished) {
      setTimeout(() => {
        const step = activeSession.currentStep;
        if (step && step.correctMove) {
          setCoachSays(moveToInstruction(step.correctMove, activeSession.game.fen()));
        }
      }, 1200);
    }

    setShowHint(false);
    setHistory((p) => [...p, { fen: wFen, step: midIdx }]);

    if (res.finished) {
      setFinished(true);
      return true;
    }

    if (res.hasReply) {
      activeSession.scheduleReply(res.replyDelay ?? 700, (replyFen, replyStep) => {
        setFen(replyFen);
        setCurrentStepIndex(replyStep);
        setHistory((p) => [...p, { fen: replyFen, step: replyStep }]);
        
        if (lessonMode === "lecture") {
          const nextStep = activeSession.currentStep;
          if (nextStep && nextStep.correctMove) {
            setCoachSays(moveToInstruction(nextStep.correctMove, replyFen));
          }
        } else if (res.autoAdvance) {
          setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration.");
        }
      });
    } else if (res.autoAdvance) {
      setTimeout(() => {
        if (lessonMode === "lecture" && activeSession.currentStep?.correctMove) {
          setCoachSays(moveToInstruction(activeSession.currentStep.correctMove, activeSession.game.fen()));
        } else {
          setCoachSays(activeSession.currentStep?.hint ?? "Continue the demonstration.");
        }
      }, 1200);
    }

    return true;
  }

  const [clickFrom, setClickFrom] = useState<string | null>(null);

  function handleBoardSquareClick(square: string) {
    if (finished || (sfPlayMode ? sfWaiting : activeSession.awaitingOpponentReply)) {
      setClickFrom(null);
      return;
    }

    if (!clickFrom) {
      setClickFrom(square);
    } else {
      const origin = clickFrom;
      setClickFrom(null); 
      activeDropHandler(origin, square);
    }
  }

  async function makeEngineMove(currentFen: string) {
    setSfWaiting(true);
    setCoachSays("Stockfish is thinking…");

    try {
      const bestMove = await playMove(currentFen, sfSkillLevel);

      if (bestMove && bestMove.length >= 4) {
        const g = new Chess(sfPlayFenRef.current);
        g.move({
          from: bestMove.slice(0, 2),
          to: bestMove.slice(2, 4),
          promotion: bestMove[4] ?? "q",
        });

        const afterEngine = g.fen();
        setSfPlayFen(afterEngine);
        sfPlayFenRef.current = afterEngine;
        setSfWaiting(false);

        if (g.isGameOver()) {
          setCoachSays(g.isCheckmate() ? "Stockfish delivers checkmate." : "Game over.");
        } else {
          setCoachSays("Your turn.");
        }

        analyze(afterEngine, 16);
      } else {
        setSfWaiting(false);
      }
    } catch {
      setSfWaiting(false);
    }
  }

  function startSfPlay() {
    const startingFen = fen; 
    setSfPlayFen(startingFen);
    sfPlayFenRef.current = startingFen;
    setSfPlayMode(true);
    setShowHint(false);

    const g = new Chess(startingFen);
    const isPlayingBlack = studentSide === "Student";
    const isEngineTurn =
      (g.turn() === "w" && isPlayingBlack) || (g.turn() === "b" && !isPlayingBlack);

    if (isEngineTurn) {
      setCoachSays(`Playing vs Stockfish — Skill Level ${sfSkillLevel}`);
      void makeEngineMove(startingFen);
    } else {
      setCoachSays(`Playing vs Stockfish — Skill Level ${sfSkillLevel}. Your turn.`);
      if (ready) analyze(startingFen, 16);
    }
  }

  function onSfPieceDropSync(src: string, tgt: string): boolean {
    if (sfWaiting) return false;

    try {
      const g = new Chess(sfPlayFenRef.current);
      const move = g.move({ from: src, to: tgt, promotion: "q" });
      if (!move) return false;

      const afterPlayer = g.fen();
      setSfPlayFen(afterPlayer);
      sfPlayFenRef.current = afterPlayer;

      if (g.isGameOver()) {
        setCoachSays(g.isCheckmate() ? "Checkmate! Well played." : "Game over.");
        analyze(afterPlayer, 16);
        return true;
      }

      void makeEngineMove(afterPlayer);
      return true;
    } catch {
      return false;
    }
  }

  async function handleHintClick() {
    if (showHint) {
      setShowHint(false);
      return;
    }
    
    setShowHint(true);

    if (sfPlayMode && ready && !finished) {
      setHintLoading(true);
      try {
        await getHint(sfPlayFenRef.current);
      } finally {
        setHintLoading(false);
      }
    }
  }

  function clearCanvas() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }

  const safeThemes = Array.isArray(lesson?.theme) ? lesson.theme : [];
  const safeSteps = Array.isArray(lesson?.steps) ? lesson.steps : [];
  const totalLeftBlockW = boardSize + EVAL_W + EVAL_GAP;
  const wbW = isStacked ? boardSize : Math.min(Math.round(boardSize * 0.76), 400);
  const wbH = boardSize + 50;
  const currentStep = activeSession.currentStep;
  
  const liveHint =
    lessonMode === "lecture" && currentStep?.correctMove
      ? moveToInstruction(currentStep.correctMove, fen)
      : (currentStep?.hint ?? (lessonMode === "lecture" ? "Play the next move." : "Find the best move."));
      
  const liveExplanation = currentStep?.explanation ?? "";
  const editorFilename = `${String(lessonIndex + 1).padStart(4, "0")}-${lesson.id}`;

  const activeDropHandler = sfPlayMode ? onSfPieceDropSync : onPieceDrop;

  return (
    <div style={S.page}>
      <style>
        {`
          @keyframes borderPulse {
            0% { border-left-color: #a69272; box-shadow: inset 2px 0 4px rgba(166,146,114,0.1); }
            50% { border-left-color: #ebdcb9; box-shadow: inset 4px 0 12px rgba(235,220,185,0.4); }
            100% { border-left-color: #a69272; box-shadow: inset 2px 0 4px rgba(166,146,114,0.1); }
          }
        `}
      </style>

      <button style={S.hamburger} onClick={() => setMenuOpen((m) => !m)}>
        {menuOpen ? "✕ Close" : "☰ Index"}
      </button>

      <div style={{ ...S.sidebar, transform: menuOpen ? "translateX(0)" : "translateX(-100%)" }}>
        <div style={{ padding: "12px", borderBottom: "1px solid #211b16", background: "#0a0807" }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              width: "100%",
              background: "#1c1712",
              border: "1px solid #4a3f31",
              color: "#d9cb9e",
              padding: "6px",
              fontSize: 12,
              fontFamily: "Georgia, serif",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            ↤ Return to Academy
          </button>
        </div>

        <div style={S.sidebarHead}>
          <h3 style={S.sidebarTitle}>Curriculum Hub</h3>
          <p style={S.sidebarSub}>All Modules & Lessons</p>
        </div>

        <div style={S.sidebarBody}>
          <div
            style={{
              fontSize: 10,
              fontWeight: "bold",
              color: "#595043",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              padding: "5px 6px",
              fontFamily: "Georgia, serif",
            }}
          >
            📁 {currentModuleData?.title || `Module ${moduleId}`}
          </div>

          {currentModuleData?.lessons?.map(
            (les: { id?: string; title: string; elo?: number }, idx: number) => {
              const active = idx === lessonIndex;
              return (
                <button
                  key={`${les.id || "lesson"}-${idx}`}
                  onClick={() => {
                    loadLesson(idx);
                    setMenuOpen(false);
                  }}
                  style={{
                    ...S.lessonBtn,
                    backgroundColor: active ? "#2b231a" : "transparent",
                    color: active ? "#c4b293" : "#6b5e4c",
                    fontWeight: active ? "bold" : "normal",
                    borderLeft: active ? "2px solid #a69272" : "2px solid transparent",
                  }}
                >
                  <span style={{ opacity: 0.6, marginRight: 6 }}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: 6,
                    }}
                  >
                    {les.title}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>{les.elo ?? 800}</span>
                </button>
              );
            }
          )}
        </div>
      </div>

      <div style={S.mainContainer}>
        <div style={S.vintageHeaderBlock}>
          <div style={S.headerTopBorder} />
          <h1 style={{ ...S.centeredTitle, cursor: "pointer" }} onClick={onBack} title="Return to Academy">
            Endgame Classroom
          </h1>
          <div style={S.headerSubtitleRow}>
            <span style={S.headerEst}>LONDON • NEW YORK • VIENNA</span>
            <span style={S.headerOrnament}>❖</span>
            <span style={S.headerEst}>ESTABLISHED 1886</span>
          </div>
          <div style={S.headerBottomBorder} />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: isStacked ? "column" : "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            maxWidth: 1040,
            paddingBottom: 4,
            gap: isStacked ? 8 : 12,
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <span style={S.badge}>{lesson?.elo ?? 800} ELO</span>
            <span style={{ ...S.badge, color: lessonMode === "lecture" ? "#a3b39c" : "#c4b293" }}>
              {lessonMode === "lecture" ? "📖 Lecture" : lessonMode === "free" ? "♟ Free" : "🎯 Puzzle"}
            </span>
            {safeThemes.slice(0, 2).map((t: string) => (
              <span key={t} style={S.themeBadge}>
                {t}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <button
              type="button"
              style={S.toolBtn}
              onClick={() =>
                setBoardOrientation((prev) => (prev === "white" ? "black" : "white"))
              }
            >
              ⟲ Flip
            </button>

            <button
              style={{ ...S.toolBtn, ...(editorOpen ? S.toolActive : S.editInactive) }}
              onClick={() => {
                setEditorOpen((o) => !o);
                if (drawingMode) setDrawingMode(false);
              }}
            >
              ✒ Edit
            </button>

            <button
              style={{ ...S.toolBtn, ...(drawingMode ? S.toolActive : {}) }}
              onClick={() => {
                setDrawingMode((d) => !d);
                if (editorOpen) setEditorOpen(false);
              }}
            >
              ✒ Draw
            </button>

            {drawingMode && (
              <>
                <button
                  style={{ ...S.toolBtn, ...(tool === "eraser" ? S.toolActive : {}) }}
                  onClick={() => setTool("eraser")}
                >
                  ◻
                </button>
                <button
                  style={{ ...S.toolBtn, ...(tool === "pen" ? S.toolActive : {}) }}
                  onClick={() => setTool("pen")}
                >
                  ✏
                </button>
                <button style={S.toolBtn} onClick={clearCanvas}>
                  ✕
                </button>
              </>
            )}

            <button
              style={{ ...S.toolBtn, ...(showHint ? S.toolActive : {}), opacity: hintLoading ? 0.6 : 1 }}
              onClick={handleHintClick}
              disabled={hintLoading}
            >
              {hintLoading ? "⏳" : "💡"} Hint
            </button>
          </div>
        </div>

        {/* ── DEDICATED INSTRUCTION BANNER ── */}
        <div
          style={{
            width: "100%",
            maxWidth: 1040,
            background: finished ? "#f2f7f2" : "#ffffff",
            borderLeft: `4px solid ${finished ? "#4a6b44" : "#a69272"}`,
            padding: "10px 16px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 16,
            transition: "background 0.3s, border-color 0.3s",
            animation: finished ? "none" : "borderPulse 2.5s infinite alternate ease-in-out",
          }}
        >
          {!finished && !sfPlayMode && (
            <span
              style={{
                fontSize: 10,
                color: "#7a6e5d",
                letterSpacing: "1px",
                fontWeight: "bold",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
                flexShrink: 0,
              }}
            >
              STEP {currentStepIndex + 1} OF {safeSteps.length || 1}
            </span>
          )}
          <span
            style={{
              color: finished ? "#3a5233" : "#2b2118",
              fontSize: 15,
              fontWeight: "bold",
              fontFamily: "Georgia, serif",
              lineHeight: 1.2,
            }}
          >
            {finished
              ? "Lesson Complete"
              : sfPlayMode
              ? sfWaiting
                ? "Engine thinking…"
                : "Your move"
              : liveHint}
          </span>
        </div>

        <div
          style={{
            ...S.cols,
            flexDirection: isStacked ? "column" : "row",
            alignItems: isStacked ? "center" : "stretch",
            gap: isStacked ? 16 : 40,
          }}
        >
          <div style={{ ...S.leftCol, position: "relative" }}>
            {showHint && !sfPlayMode && currentStep && (
              <HintPopup hint={liveHint} explanation={liveExplanation} onClose={() => setShowHint(false)} />
            )}

            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
              {sfPlayMode ? (
                <EvalBar bar={bar} cp={cp} mate={mate} size={boardSize} />
              ) : (
                <div style={{ width: EVAL_W, marginRight: EVAL_GAP, flexShrink: 0 }} />
              )}

              <Board
                fen={sfPlayMode ? sfPlayFen : fen}
                boardSize={boardSize}
                onPieceDrop={activeDropHandler}
                onSquareClick={handleBoardSquareClick}
                clickFromSquare={clickFrom}
                hintSquares={activeHintSquares}
                boardOrientation={boardOrientation}
              />
            </div>

            <div
              style={{
                width: totalLeftBlockW,
                padding: "6px 10px",
                boxSizing: "border-box",
                background: "#1c1712",
                border: "1px solid #362f25",
                borderLeft: `3px solid ${
                  feedback?.ok ? "#56664d" : feedback ? "#824b4b" : "#736451"
                }`,
                textAlign: "center",
              }}
            >
              <span
                style={{
                  color: feedback?.ok ? "#a3b899" : feedback ? "#cc9999" : "#bdae99",
                  fontSize: 12,
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                }}
              >
                {coachSays}
              </span>
            </div>

            {!sfPlayMode ? (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 4,
                    width: totalLeftBlockW,
                  }}
                >
                  <button
                    style={S.btn}
                    onClick={stepBack}
                    disabled={history.length <= 1 || activeSession.awaitingOpponentReply}
                  >
                    ⌥ Back
                  </button>
                  <button style={S.btn} onClick={() => loadLesson(lessonIndex)}>
                    ⟳ Reset
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, width: totalLeftBlockW }}>
                  <button style={S.navBtn} onClick={() => loadLesson(lessonIndex - 1)} disabled={lessonIndex === 0}>
                    ← Prev
                  </button>
                  <span style={{ fontSize: 10, color: "#8c7e6b", fontFamily: "Georgia, serif" }}>
                    {lessonIndex + 1} / {currentModuleData?.lessons?.length || 1}
                  </span>
                  <button
                    style={S.navBtn}
                    onClick={() => loadLesson(lessonIndex + 1)}
                    disabled={!currentModuleData?.lessons || lessonIndex === currentModuleData.lessons.length - 1}
                  >
                    Next →
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: totalLeftBlockW }}>
                <button
                  style={S.btn}
                  onClick={() => {
                    setSfPlayMode(false);
                    setCoachSays("Study the position. Make your move.");
                  }}
                >
                  ← Back to Lesson
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#8c7e6b", fontFamily: "Georgia, serif" }}>
                    Skill:
                  </span>
                  <input
                    type="range"
                    min={10}
                    max={20}
                    value={sfSkillLevel}
                    onChange={(e) => setSfSkillLevel(Number(e.target.value))}
                    style={{ width: 70, accentColor: "#a69272" }}
                  />
                  <span style={{ fontSize: 10, color: "#c4b293", minWidth: 16, fontFamily: "Georgia, serif" }}>
                    {sfSkillLevel}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div style={{ ...S.rightCol, width: wbW }}>
            <div style={{ ...S.paper, width: wbW, height: isStacked ? "auto" : wbH }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backgroundImage:
                    "repeating-linear-gradient(transparent,transparent 27px,#d1c2a5 27px,#d1c2a5 28px)",
                  backgroundPositionY: "44px",
                  opacity: 0.25,
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: "relative",
                  padding: "16px 20px 20px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  zIndex: 1,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: "bold",
                    color: "#211a12",
                    fontFamily: "Georgia, serif",
                    borderBottom: "1px solid #c4b293",
                    paddingBottom: 2,
                  }}
                >
                  {lesson.title}
                </div>

                <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 10, margin: "-4px 0" }}>
                  ❖ ❖ ❖
                </div>

                {mastersNote && (
                  <div style={{ fontSize: 10, color: "#7a6e5d", fontStyle: "italic", fontFamily: "Georgia, serif" }}>
                    — {mastersNote}
                  </div>
                )}

                {lesson.intro && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={S.wbLabel}>Introduction</span>
                    <p
                      style={{
                        fontSize: 13,
                        color: "#2b2118",
                        margin: 0,
                        lineHeight: "18px",
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      {lesson.intro}
                    </p>
                  </div>
                )}

                {lesson.objective && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={S.wbLabel}>Objective</span>
                    <p
                      style={{
                        fontSize: 13,
                        color: "#2b2118",
                        margin: 0,
                        lineHeight: "18px",
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      {lesson.objective}
                    </p>
                  </div>
                )}

                {/* THE EXPLICIT TOGGLE OPTIONS */}
                {!finished && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 4 }}>
                    <button
                      style={{
                        ...S.sfBtn,
                        flex: 1,
                        marginTop: 0,
                        padding: "8px",
                        background: !sfPlayMode ? "#2b231a" : "#1a1f2e",
                        borderColor: !sfPlayMode ? "#a69272" : "#2e3f5e",
                        color: !sfPlayMode ? "#d9cb9e" : "#8aadcc",
                      }}
                      onClick={() => {
                        setSfPlayMode(false);
                        setShowHint(false);
                        setClickFrom(null);
                        setTick((t) => t + 1);
                      }}
                    >
                      📖 Learn
                    </button>
                    <button
                      style={{
                        ...S.sfBtn,
                        flex: 1,
                        marginTop: 0,
                        padding: "8px",
                        background: sfPlayMode ? "#2b231a" : "#1a1f2e",
                        borderColor: sfPlayMode ? "#a69272" : "#2e3f5e",
                        color: sfPlayMode ? "#d9cb9e" : "#8aadcc",
                      }}
                      onClick={startSfPlay}
                    >
                      ♟ Play from position
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingTop: 2 }}>
                  {safeSteps.map((_, i: number) => (
                    <div
                      key={i}
                      style={{
                        width: 5,
                        height: 5,
                        background:
                          i < currentStepIndex
                            ? "#4a5743"
                            : i === currentStepIndex
                            ? "#8c795c"
                            : "#d1c4b0",
                        outline: "1px solid #7a6b54",
                      }}
                    />
                  ))}
                </div>

                {finished && !sfPlayMode && (
                  <>
                    <div style={{ textAlign: "center", color: "#7a6e5d", fontSize: 10 }}>❖</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={S.wbLabel}>Reflection</span>
                      <p
                        style={{
                          fontSize: 13,
                          color: "#2b2118",
                          margin: 0,
                          lineHeight: "18px",
                          fontFamily: "Georgia, serif",
                        }}
                      >
                        {(lesson as { finalReflection?: string }).finalReflection ||
                          "Lesson completed successfully."}
                      </p>
                    </div>
                    <button style={S.sfBtn} onClick={startSfPlay}>
                      ♟ Play vs Stockfish
                    </button>
                    {currentModuleData?.lessons && lessonIndex < currentModuleData.lessons.length - 1 && (
                      <button style={S.nextBtn} onClick={() => loadLesson(lessonIndex + 1)}>
                        Accept & Continue →
                      </button>
                    )}
                  </>
                )}
              </div>

              <canvas
                ref={canvasRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  width: "100%",
                  height: "100%",
                  touchAction: "none",
                  cursor: drawingMode ? "crosshair" : "default",
                  opacity: drawingMode ? 0.8 : 0.4,
                  pointerEvents: drawingMode ? "auto" : "none",
                }}
              />
            </div>
          </div>
        </div>

        {editorOpen && (
          <BoardEditor
            lesson={lesson}
            moduleId={lesson.module || moduleId}
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

// ── MASTER ROUTER COMPONENT ───────────────────────────────────────────────────
export default function App() {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(() => {
    return localStorage.getItem("endgame_activeModule") || null;
  });

  useEffect(() => {
    if (activeModuleId) {
      localStorage.setItem("endgame_activeModule", activeModuleId);
    } else {
      localStorage.removeItem("endgame_activeModule");
    }
  }, [activeModuleId]);

  if (!activeModuleId) {
    return <HomeView onOpenModule={(mod) => setActiveModuleId(mod)} />;
  }

  if (activeModuleId === "vision-game") {
    return <VisionGameView onBack={() => setActiveModuleId(null)} />;
  }

  if (activeModuleId === "knight-game") {
    return <KnightNavigatorView onBack={() => setActiveModuleId(null)} />;
  }

  return <ClassroomView moduleId={activeModuleId} onBack={() => setActiveModuleId(null)} />;
}

// ── SHARED STYLES ─────────────────────────────────────────────────────────────
const S: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
    alignItems: "flex-start",
    height: "100dvh",
    background: "#14110e",
    padding: "16px 16px 24px 16px",
    boxSizing: "border-box",
    overflowY: "auto",
    overflowX: "hidden",
    fontFamily: "Georgia, serif",
  },
  mainContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    width: "100%",
    maxWidth: 1040,
    minHeight: "max-content",
  },
  vintageHeaderBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    maxWidth: 1040,
    textAlign: "center",
    marginBottom: 0,
  },
  headerTopBorder: {
    width: "100%",
    height: "3px",
    borderTop: "1px solid #594e3f",
    borderBottom: "1px solid #594e3f",
    marginBottom: 4,
  },
  centeredTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: "400",
    color: "#d9cbb0",
    fontFamily: "Georgia, serif",
    letterSpacing: "3px",
    textTransform: "uppercase",
    lineHeight: 1.0,
  },
  headerSubtitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 2,
    marginBottom: 4,
  },
  headerEst: {
    fontSize: 9,
    color: "#8c7e6b",
    letterSpacing: "2px",
    fontFamily: "Georgia, serif",
  },
  headerOrnament: { color: "#594e3f", fontSize: 8 },
  headerBottomBorder: { width: "100%", height: "1px", background: "#362f25" },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: 1040,
    paddingBottom: 4,
  },
  hamburger: {
    position: "fixed",
    top: 12,
    left: 12,
    background: "#1c1712",
    border: "1px solid #4a3f31",
    borderRadius: 0,
    color: "#b0a28f",
    fontSize: 10,
    padding: "4px 8px",
    cursor: "pointer",
    zIndex: 10,
    fontFamily: "Georgia, serif",
    letterSpacing: "1px",
    textTransform: "uppercase",
  },
  sidebar: {
    position: "fixed",
    top: 0,
    left: 0,
    width: 250,
    height: "100vh",
    background: "#120f0d",
    borderRight: "1px solid #2e261f",
    zIndex: 9,
    display: "flex",
    flexDirection: "column",
    transition: "transform 0.3s ease",
    boxShadow: "12px 0 32px rgba(0,0,0,0.9)",
  },
  sidebarHead: {
    padding: "20px 16px 12px",
    borderBottom: "1px solid #211b16",
    background: "#0a0807",
  },
  sidebarTitle: {
    margin: 0,
    fontSize: 16,
    color: "#d9cb9e",
    fontFamily: "Georgia, serif",
    fontWeight: "normal",
  },
  sidebarSub: { margin: "2px 0 0", fontSize: 10, color: "#6e6252", fontStyle: "italic" },
  sidebarBody: {
    flex: 1,
    overflowY: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  lessonBtn: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    border: "none",
    padding: "6px 8px",
    textAlign: "left",
    fontSize: 12,
    cursor: "pointer",
    borderRadius: 0,
    gap: 0,
    fontFamily: "inherit",
  },
  cols: {
    display: "flex",
    justifyContent: "center",
    gap: 40,
    width: "100%",
    maxWidth: 1040,
    minHeight: "max-content",
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  rightCol: { display: "flex", flexDirection: "column", flexShrink: 0 },
  btn: {
    flex: 1,
    background: "#1c1712",
    border: "1px solid #362f25",
    borderRadius: 0,
    color: "#bdae99",
    fontSize: 10,
    padding: "2px 6px",
    lineHeight: "12px",
    fontFamily: "Georgia, serif",
    cursor: "pointer",
  },
  navBtn: {
    background: "#14110e",
    border: "1px solid #2e261f",
    borderRadius: 0,
    color: "#a69272",
    fontSize: 10,
    padding: "2px 8px",
    lineHeight: "12px",
    fontFamily: "Georgia, serif",
    cursor: "pointer",
  },
  badge: {
    fontSize: 10,
    color: "#d9cb9e",
    background: "#1c1712",
    border: "1px solid #362f25",
    borderRadius: 0,
    padding: "4px 8px",
    fontFamily: "Georgia, serif",
  },
  themeBadge: {
    fontSize: 10,
    color: "#8fa388",
    background: "#141712",
    border: "1px solid #262e22",
    borderRadius: 0,
    padding: "2px 6px",
    fontFamily: "Georgia, serif",
  },
  toolBtn: {
    background: "#1c1712",
    border: "1px solid #362f25",
    borderRadius: 0,
    color: "#ad9e87",
    fontSize: 10,
    padding: "4px 8px",
    fontFamily: "Georgia, serif",
    cursor: "pointer",
  },
  toolActive: { background: "#2e261f", color: "#f2e6cf", border: "1px solid #594e3f" },
  editInactive: { background: "#182418", color: "#7cb37c", border: "1px solid #273d27" },
  paper: {
    position: "relative",
    background: "#ebdcb9",
    borderRadius: 0,
    border: "10px solid #26211a",
    outline: "1px solid #ebdcb9",
    boxShadow: "0 16px 36px rgba(0,0,0,0.9)",
    overflow: "hidden",
  },
  wbLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#4d3f31",
    letterSpacing: "1px",
    textTransform: "uppercase",
    fontFamily: "Georgia, serif",
  },
  nextBtn: {
    background: "#2d3b28",
    border: "1px solid #41543b",
    borderRadius: 0,
    color: "#cadbc3",
    fontSize: 11,
    padding: "5px 10px",
    fontFamily: "Georgia, serif",
    cursor: "pointer",
    marginTop: 2,
  },
  sfBtn: {
    background: "#1a1f2e",
    border: "1px solid #2e3f5e",
    borderRadius: 0,
    color: "#8aadcc",
    fontSize: 11,
    padding: "5px 10px",
    fontFamily: "Georgia, serif",
    cursor: "pointer",
    marginTop: 4,
  },
};