export type LessonStep = {
  san: string;
  note?: string;
};

export type Lesson = {
  id: string;
  title: string;
  description?: string;
  startFen: string;
  sideToMove: "white" | "black";
  moves: LessonStep[];
};

export type Module = {
  id: string;
  title: string;
  description?: string;
  lessons: Lesson[];
};