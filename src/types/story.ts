export interface StoryEvidence {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  heading: string;
  quote: string;
  start: number;
  end: number;
}

export type StoryFactStatus = "AI识别" | "已确认" | "已忽略";

export interface StoryFact {
  id: string;
  type: string;
  subject: string;
  predicate: string;
  object: string;
  chapterId: string;
  chapterTitle: string;
  volume: string;
  confidence: number;
  status: StoryFactStatus;
  evidence: StoryEvidence[];
  sourceRevision: string;
  userNote?: string;
  origin?: "ai" | "manual";
  userEditedFields?: string[];
  stale?: boolean;
  updatedAt: string;
}

export interface CharacterStoryState {
  id: string;
  characterId: string;
  characterName: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder?: number;
  volume: string;
  location: string;
  physical: string[];
  mental: string[];
  abilities: string[];
  route: string[];
  goals: string[];
  obstacles: string[];
  knowledge: string[];
  knowledgeSources: string[];
  possessions: string[];
  relationships: string[];
  relationshipChanges: string[];
  lastAppearance: string;
  lastAppearancePosition?: { start: number; end: number };
  evidence: StoryEvidence[];
  sourceRevision: string;
  confidence: number;
  updatedAt: string;
}

export interface CharacterStateHistory {
  characterId: string;
  characterName: string;
  states: CharacterStoryState[];
  latest: CharacterStoryState | null;
}

export type ForeshadowStatus =
  | "AI候选"
  | "已确认埋下"
  | "持续强化"
  | "等待回收"
  | "已经回收"
  | "已废弃";

export interface ForeshadowItem {
  id: string;
  title: string;
  description: string;
  status: ForeshadowStatus;
  plantedAt: StoryEvidence[];
  reinforcedAt: StoryEvidence[];
  payoffAt: StoryEvidence[];
  plannedPayoff: string;
  relatedCharacters: string[];
  sourceRevision: string;
  confidence: number;
  userNote?: string;
  origin?: "ai" | "manual";
  userEditedFields?: string[];
  stale?: boolean;
  updatedAt: string;
}

export interface ChapterBoardItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  order: number;
  locked: boolean;
  completed: boolean;
  sourceRefs: StoryEvidence[];
  implementation?: string;
  risks?: string[];
  alternatives?: string[];
}

export interface ChapterPreparationBoard {
  id: string;
  chapterId: string;
  chapterTitle: string;
  targetChapterId: string;
  targetChapterTitle: string;
  status: string;
  generatedAt: string;
  updatedAt: string;
  apiError?: string;
  items: ChapterBoardItem[];
}

export interface StoryOverview {
  updatedAt: string;
  counts: {
    chapters: number;
    facts: number;
    characterStates: number;
    foreshadows: number;
    boards: number;
  };
  coverage: {
    total: number;
    analyzed: number;
    stale: string[];
    missing: string[];
  };
  chapterEntries: Array<{
    chapterId: string;
    chapterTitle: string;
    volume: string;
    sourceRevision: string;
    analysisMode: "local" | "ai";
    analyzedAt: string;
    factCount: number;
    characterStateCount: number;
    foreshadowCount: number;
  }>;
  facts: StoryFact[];
  characterStates: CharacterStateHistory[];
  foreshadows: ForeshadowItem[];
  pageInfo?: {
    facts: { total: number; offset: number; limit: number };
    characters: { total: number; offset: number; limit: number };
    foreshadows: { total: number; offset: number; limit: number };
  };
}
