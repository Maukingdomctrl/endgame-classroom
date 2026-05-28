import { Chessboard } from "react-chessboard";

interface BoardProps {
  fen: string;
  size: number;
  onPieceDrop: (source: string, target: string) => boolean;
}

export default function Board({ fen, size, onPieceDrop }: BoardProps) {
  return (
    <div style={{ width: size, height: size, ...s.boardWrap }}>
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        boardWidth={size}
        customBoardStyle={{ borderRadius: "3px" }}
        customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
        customDarkSquareStyle={{ backgroundColor: "#8B4513" }}
      />
    </div>
  );
}

const s = {
  boardWrap: { borderRadius: "4px", overflow: "hidden", border: "8px solid #3d1f0a", boxShadow: "0 12px 48px rgba(0,0,0,0.8), 0 0 0 2px #7a4a1a" },
};