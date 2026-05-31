// src/modules/moduleLoader.ts
import { parseMultiPgn } from "../engine/parsePgn";

// --- CORE TYPES ---
// Defined here to resolve TS2307 in all other files
export interface LessonStep {
  correctMove: string;
  hint?: string;
  explanation?: string;
  from?: string; // <-- Added to resolve TS error
  to?: string;   // <-- Added to resolve TS error
  opponentReply?: {
    move: string;
    explanation?: string;
    from?: string; // <-- Added to resolve TS error
    to?: string;   // <-- Added to resolve TS error
  } | null;
}

export interface RawLesson {
  id: string;
  module: string;
  title: string;
  elo: number;
  theme: string[];
  objective: string;
  intro: string;
  startFen: string;
  sideToMove: "white" | "black";
  mode?: "lecture" | "puzzle" | "free"; // <-- Made optional
  steps: LessonStep[];
  finalReflection?: string;
  mastersNote?: string;
}

export interface ModuleData {
  id: string;
  title: string;
  lessons: RawLesson[];
}

// --- STATE ---
let moduleCache: Record<string, ModuleData> = {};

// Callback system to notify the app when the cache is refreshed
let onReloadCallback: (() => void) | null = null;
export function onModulesReloaded(cb: () => void) {
  onReloadCallback = cb;
}

const MODULE_CONFIG = [
  { id: "module1", title: "Capablanca Fundamentals" },
  { id: "module2", title: "The Rook's Domain" },
  { id: "module3", title: "Minor Piece Mastery" },
  { id: "module4", title: "Queen Endgames" },
  { id: "module5", title: "Pawn Architecture" },
];

// --- LOGIC ---

async function fetchModuleData(moduleId: string, moduleTitle: string): Promise<ModuleData | null> {
  try {
    // Use relative path to take advantage of Vite Proxy
    const response = await fetch(`/api/get-pgn?moduleId=${moduleId}`);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.ok || !data.pgnText?.trim()) return null;

    // Fix implicit 'any' by typing the mapping result
    const lessons: RawLesson[] = parseMultiPgn(data.pgnText).map((lesson: RawLesson) => ({
      ...lesson,
      module: moduleId,
    }));

    return { id: moduleId, title: moduleTitle, lessons };
  } catch (err) {
    console.error(`[moduleLoader] Failed to fetch ${moduleId}:`, err);
    return null;
  }
}

export async function loadAllModules(): Promise<Record<string, ModuleData>> {
  const results = await Promise.all(
    MODULE_CONFIG.map(c => fetchModuleData(c.id, c.title))
  );

  moduleCache = {};
  results.forEach((mod) => {
    if (mod && mod.lessons.length > 0) {
      moduleCache[mod.id] = mod;
    }
  });

  // Trigger callback so UI updates
  onReloadCallback?.();

  return moduleCache;
}

export const getModuleData = (moduleId: string): ModuleData | null => {
  const data = moduleCache[moduleId];
  if (!data) {
    console.warn(`[moduleLoader] No data for "${moduleId}" — is syncServer running?`);
    return null;
  }
  return data;
};