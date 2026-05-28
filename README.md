# ♟ Endgame Classroom

An interactive chess endgame learning app featuring puzzle and lecture modes, Capablanca-style lessons, coach hints, and play-vs-Stockfish — styled as a vintage chess academy.

Built with **React + Vite + TypeScript**, powered by **Stockfish WASM** (multi-variant, Emscripten build).

---

## Screenshots

> Add screenshots here after first deployment.

---

## Features

- 📖 **Lecture mode** — follow master games move by move with coach narration
- 🎯 **Puzzle mode** — find the correct move with hints and feedback
- ♟ **Play vs Stockfish** — challenge the engine at adjustable skill levels (1–20)
- 📊 **Eval bar** — live centipawn evaluation during engine play
- 💡 **Coach hints** — PGN comments surface as in-lesson guidance
- ✒ **Board drawing** — annotate positions with pen/eraser overlay
- ✏ **Board editor** — edit and save lesson positions mid-session
- 📚 **Curriculum sidebar** — navigate all modules and lessons
- 🗂 **PGN-driven lessons** — drop a `.pgn` file into a module folder to add a lesson

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Install & Run

```bash
git clone https://github.com/Maukingdomctrl/endgame-classroom.git
cd endgame-classroom
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
npm run build
npm run preview
```

---

## Project Structure

```
endgame-classroom/
├── public/
│   ├── stockfish.js          # Stockfish WASM engine (Emscripten build)
│   └── sf-worker.js          # Web Worker wrapper for Stockfish
├── src/
│   ├── components/
│   │   └── BoardEditor.tsx   # In-app FEN/position editor
│   ├── engine/
│   │   ├── parsePgn.ts       # PGN → RawLesson converter
│   │   ├── session.ts        # Lesson session state manager
│   │   └── useStockfish.ts   # Stockfish React hook (analyze + playMove)
│   ├── modules/
│   │   └── module1/
│   │       ├── loader.ts     # Vite glob loader for .pgn files
│   │       ├── 0001-*.pgn    # Lesson 1
│   │       └── 0002-*.pgn    # Lesson 2
│   ├── App.tsx               # Main application
│   └── main.tsx
├── vite.config.ts
└── package.json
```

---

## Adding Lessons

Drop a `.pgn` file into `src/modules/module1/`. The loader picks it up automatically on next build/dev restart. Files are sorted alphabetically — prefix with a zero-padded number (`0003-`, `0004-`) to control order.

See [LESSONS.md](./LESSONS.md) for the full PGN header reference.

---

## Stockfish Integration

This app uses a 2019 Emscripten-compiled multi-variant Stockfish build. The engine runs in a Web Worker and communicates via UCI.

**Key implementation notes:**

- The build is an Emscripten module — it does **not** expose a `STOCKFISH()` factory function
- Output is captured by overriding `self.print` before `importScripts`
- Input is dispatched via `MessageEvent` after the script installs its own `onmessage`
- COOP/COEP headers are required for SharedArrayBuffer (set in `vite.config.ts`)

See `public/sf-worker.js` and `src/engine/useStockfish.ts` for implementation.

---

## Tech Stack

| Package | Purpose |
|---|---|
| React 18 | UI framework |
| Vite 5 | Build tool |
| TypeScript | Type safety |
| chess.js | Move validation and FEN handling |
| react-chessboard | Board rendering |
| @mliebelt/pgn-parser | PGN parsing |
| Stockfish WASM | Chess engine |

---

## License

MIT — see [LICENSE](./LICENSE)
