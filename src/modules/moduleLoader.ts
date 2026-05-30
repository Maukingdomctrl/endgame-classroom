// src/modules/moduleLoader.ts

import { parseMultiPgn } from "../engine/parsePgn";

let moduleCache: Record<string, any> = {};

// Change 1: Add callback system to notify the app when the cache is refreshed
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

async function fetchModuleData(moduleId: string, moduleTitle: string) {
  try {
    const response = await fetch(`/api/get-pgn?moduleId=${moduleId}`);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.ok || !data.pgnText?.trim()) return null;

    const lessons = parseMultiPgn(data.pgnText).map((lesson: any) => ({
      ...lesson,
      module: moduleId,
    }));

    return { id: moduleId, title: moduleTitle, lessons };
  } catch (err) {
    console.error(`[moduleLoader] Failed to fetch ${moduleId}:`, err);
    return null;
  }
}

export async function loadAllModules() {
  const results = await Promise.all(
    MODULE_CONFIG.map(c => fetchModuleData(c.id, c.title))
  );

  moduleCache = {};
  results.forEach((mod, i) => {
    if (mod && mod.lessons.length > 0) {
      moduleCache[MODULE_CONFIG[i].id] = mod;
    }
  });

  // Change 1: Trigger the callback so active components know to pull fresh data
  onReloadCallback?.();

  return moduleCache;
}

export const getModuleData = (moduleId: string) => {
  const data = moduleCache[moduleId];
  if (!data) {
    console.warn(`[moduleLoader] No data for "${moduleId}" — is syncServer running?`);
    return null;
  }
  return data;
};