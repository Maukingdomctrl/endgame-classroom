/**
 * EvalBar.tsx
 *
 * Accepts the raw StockfishEval output and renders a clean eval bar.
 *
 * Props:
 *   bar   — pre-clamped [-5, +5] float from useStockfish
 *   cp    — centipawn value (nullable)
 *   mate  — mate-in-N (nullable)
 *   size  — height in px, should match board height
 */

export const EVAL_W   = 16;
export const EVAL_GAP = 12;

interface EvalBarProps {
  bar:  number;
  cp:   number | null;
  mate: number | null;
  size: number;
}

export default function EvalBar({ bar, cp, mate, size }: EvalBarProps) {
  // bar is [-5, +5]; convert to percentage (0 = black winning, 100 = white winning)
  const pct = Math.round(((bar + 5) / 10) * 100);

  let label: string;
  if (mate !== null) {
    label = mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  } else if (cp !== null) {
    const pawns = cp / 100;
    label = pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
  } else {
    label = "0.0";
  }

  return (
    <div
      style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        width:          EVAL_W,
        height:         size,
        flexShrink:     0,
        marginRight:    EVAL_GAP,
      }}
    >
      <div
        style={{
          width:          "100%",
          flex:           1,
          border:         "1px solid #2b261f",
          borderRadius:   1,
          overflow:       "hidden",
          display:        "flex",
          flexDirection:  "column",
          background:     "#1c1813",
        }}
      >
        {/* Black side — top */}
        <div
          style={{
            width:      "100%",
            background: "#2b251f",
            height:     `${100 - pct}%`,
            transition: "height 0.25s ease",
          }}
        />
        {/* White side — bottom */}
        <div
          style={{
            width:      "100%",
            background: "#d9cb9e",
            height:     `${pct}%`,
            transition: "height 0.25s ease",
          }}
        />
      </div>

      <span
        style={{
          fontSize:    11,
          color:       "#8c7e6b",
          marginTop:   4,
          whiteSpace:  "nowrap",
          fontFamily:  "Georgia, serif",
          fontStyle:   "italic",
        }}
      >
        {label}
      </span>
    </div>
  );
}