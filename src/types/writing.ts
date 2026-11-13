// 写作统计（P75）渲染层契约类型。
export interface WritingDayPoint {
  date: string;
  netWords: number;
  saves: number;
  metGoal: boolean;
}

export interface WritingOverview {
  goal: number;
  today: { date: string; netWords: number; saves: number; metGoal: boolean };
  streak: number;
  series: WritingDayPoint[];
  totalRecorded: number;
  activeDays: number;
  bestDay: { date: string; netWords: number } | null;
  updatedAt: string;
}