// src/modules/moduleLoader.ts

// 1. Import your raw PGN files (Vite uses ?raw to import as string)
import module1Pgn from "./module1/0001-endgame-lessons.pgn?raw";
// import module2Pgn from "./module2/0002-rook-endgames.pgn?raw"; 

// ── GENERIC PGN PARSER ────────────────────────────────────────────────────────
// This function takes raw PGN text and converts it into your app's Lesson format
function parseModulePgn(pgnText: string, moduleId: string, moduleTitle: string) {
  if (!pgnText) return { id: moduleId, title: moduleTitle, lessons: [] };

  // Split the text into individual games based on the [Event tag
  const gameBlocks = pgnText.split(/(?=\[Event ")/).filter(b => b.trim().length > 0);
  
  const lessons = gameBlocks.map((block, index) => {
    const tags: Record<string, string> = {};
    
    // Extract all [Key "Value"] tags
    const tagMatches = block.matchAll(/\[(\w+)\s+"([^"]+)"\]/g);
    for (const match of tagMatches) {
      tags[match[1]] = match[2];
    }

    // Extract the movetext (everything after the tags)
    const moveTextMatch = block.replace(/\[.*?\]\n/g, '').trim();

    return {
      id: tags.LessonId || `${moduleId}-${index + 1}`,
      module: moduleId,
      title: tags.Title || "Untitled Lesson",
      elo: parseInt(tags.Elo || "800", 10),
      theme: tags.Theme ? tags.Theme.split(",").map(t => t.trim()) : [],
      objective: tags.Objective || "",
      intro: tags.Intro || "",
      mastersNote: tags.MastersNote || "",
      finalReflection: tags.FinalReflection || "",
      mode: (tags.Mode || "puzzle").toLowerCase(),
      startFen: tags.FEN || "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
      white: tags.White || "",
      black: tags.Black || "",
      // This is the raw move text that the Session parses
      rawMoves: moveTextMatch 
    };
  });

  return {
    id: moduleId,
    title: moduleTitle,
    lessons
  };
}

// ── MODULE REGISTRY ───────────────────────────────────────────────────────────
// Parse the modules once when the app loads
export const modulesData: Record<string, any> = {
  module1: parseModulePgn(module1Pgn, "module1", "Capablanca Fundamentals"),
  // module2: parseModulePgn(module2Pgn, "module2", "The Rook's Domain"),
};

// ── GETTER FUNCTION FOR THE UI ────────────────────────────────────────────────
export const getModuleData = (moduleId: string) => {
  const data = modulesData[moduleId];
  if (!data) {
    console.warn(`Module data not found for ID: ${moduleId}`);
    return null;
  }
  return data;
};