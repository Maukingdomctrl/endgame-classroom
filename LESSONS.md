# Writing Lessons

Lessons are plain `.pgn` files dropped into a module folder. The loader reads them automatically — no code changes needed.

---

## File Naming

```
0001-king-opposition.pgn
0002-pawn-breakthrough.pgn
0003-lucena-position.pgn
```

- Zero-pad the prefix to 4 digits
- Use lowercase kebab-case for the slug
- Files are sorted alphabetically, so the number controls lesson order

---

## PGN Header Reference

These headers are read by `parsePgn.ts`. All are optional except `FEN` and the moves.

| Header | Required | Description | Example |
|---|---|---|---|
| `FEN` | ✅ | Starting position | `"8/4k3/... w - - 0 1"` |
| `LessonId` | recommended | Unique ID (falls back to Event) | `"m1-0002"` |
| `Module` | recommended | Module this lesson belongs to | `"module-1"` |
| `Title` | recommended | Display name (falls back to Event) | `"Pawn Breakthrough"` |
| `Elo` | — | Approximate difficulty rating | `"950"` |
| `Theme` | — | Comma-separated tags | `"Pawn Endgame, Breakthrough"` |
| `Mode` | — | `lecture`, `puzzle`, or `free` (default: `lecture`) | `"puzzle"` |
| `Intro` | — | Introduction paragraph shown on the paper panel | `"In this position..."` |
| `Objective` | — | What the student must achieve | `"Find the winning pawn break"` |
| `FinalReflection` | — | Shown after lesson completion | `"Remember: one sacrifice..."` |
| `MastersNote` | — | Italic attribution quote | `"Pawn endings are won by..."` |
| `SideToMove` | — | `white` or `black` (default: `white`) | `"black"` |

---

## Move Comments

Comments in `{ curly braces }` after a move become the **coach hint** for that step.

```pgn
5. b4! { The decisive breakthrough sacrifice. White shatters Black's queenside in one move. }
```

To show a different hint vs explanation, separate them with `|`:

```pgn
3. Kb2 { March the King | The King needs to reach a3 before the break is possible. }
```

- Text before `|` → shown as the inline hint bar
- Text after `|` → shown in the hint popup (💡 button)

If there is no `|`, the same text is used for both.

---

## Modes

### `lecture`
White plays each move; Black's reply is automated. The coach narrates via move comments. Students follow along. A "Play from this position" Stockfish button appears mid-lesson.

### `puzzle`
Student must find the correct move. Wrong moves trigger a "Try again" response. Hints are available via the 💡 button. Stockfish play unlocks after completion.

### `free`
No move validation. The board is free to explore.

---

## Full Example

```pgn
[Event "King and Pawn: Opposition"]
[SetUp "1"]
[FEN "8/8/4k3/8/8/4K3/8/8 w - - 0 1"]
[LessonId "m1-0003"]
[Module "module-1"]
[Title "King Opposition"]
[Elo "800"]
[Theme "King and Pawn, Opposition"]
[Mode "puzzle"]
[Intro "Opposition is the most fundamental King endgame concept."]
[Objective "Gain the opposition against the Black King."]
[FinalReflection "Direct opposition means your King faces the opponent's with one square between them — and it is their turn to move."]
[MastersNote "He who controls the opposition controls the endgame."]

1. Ke4! { Step directly in front of the Black King. | Taking the opposition means placing your King directly opposite the enemy King with one square between them — forcing Black to give way. } 1... Kd6 2. Kf5 { Follow the King. } 2... Ke7 3. Ke5 1-0
```

---

## Tips

- Keep comments concise — they appear in a single line hint bar
- Puzzle mode works best for positions with one clear best move per step
- Lecture mode suits full game demonstrations and opening/endgame theory
- The `MastersNote` italic quote adds personality — attribute it to a real player or leave it as wisdom
