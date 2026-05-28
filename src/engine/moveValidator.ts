import { Chess } from "chess.js";

export function validateMove(game: Chess, from: string, to: string) {
  try {
    const currentFen = game.fen();
    const parts = currentFen.split(" ");
    
    if (parts[1] !== "w") {
      parts[1] = "w"; 
      const testGame = new Chess(parts.join(" "));
      const move = testGame.move({ from, to, promotion: "q" });
      return move || null;
    }

    const testGame = new Chess(currentFen);
    const move = testGame.move({ from, to, promotion: "q" });
    return move || null;
  } catch {
    // Omit variable completely to fix the unused-vars lint error
    return null;
  }
}