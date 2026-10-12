import type { WorkspaceBaseItem } from "./workspace";

export interface ChapterCreativeMetrics {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  wordCount: number;
  pacing: number;
  dialogueRatio: number;
  actionRatio: number;
  descriptionRatio: number;
  pov: string;
  characterMentions: Record<string, number>;
  foreshadowsOpen: number;
  foreshadowsClosed: number;
  quality: {
    goal: boolean;
    conflict: boolean;
    turn: boolean;
    information: boolean;
    characterAction: boolean;
    endingHook: boolean;
  };
}

export interface CharacterArcAlert {
  characterId: string;
  characterName: string;
  type: "长期未出场" | "动机中断" | "知情异常" | "规划偏离";
  detail: string;
  chapterId?: string;
}

export interface CreativeStatisticsSnapshot extends WorkspaceBaseItem {
  label: string;
  metrics: ChapterCreativeMetrics[];
  povShares: Array<{ name: string; chapters: number; ratio: number }>;
  characterDensity: Array<{
    id: string;
    name: string;
    total: number;
    chapters: number;
  }>;
  foreshadowSummary: { open: number; closed: number; recoveryRate: number };
  arcAlerts: CharacterArcAlert[];
}

export interface ChapterQualityReport {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  wordCount: number;
  signals: {
    scenes: number;
    facts: number;
    characters: number;
    foreshadows: number;
    goal: boolean;
    conflict: boolean;
    turn: boolean;
    information: boolean;
    characterAction: boolean;
    endingHook: boolean;
  };
  adjacentComparison?: string;
  concerns: string[];
}
