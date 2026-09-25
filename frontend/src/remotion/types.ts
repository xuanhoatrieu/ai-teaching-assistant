export type VisualType =
  | 'formula'
  | 'code'
  | 'comparison'
  | 'step_rail'
  | 'definition'
  | 'stat_counter'
  | 'image'
  | 'quiz';

export interface MathFormulaProps {
  formula: string; // LaTeX string
  label?: string;
  explanation?: string;
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  activeLines?: number[];
}

export interface ComparisonItem {
  title: string;
  icon?: string;
  points: string[];
  isWinner?: boolean;
}

export interface ComparisonProps {
  title?: string;
  itemA: ComparisonItem;
  itemB: ComparisonItem;
  verdict?: string;
}

export interface StepItem {
  number: number;
  label: string;
  desc?: string;
}

export interface StepRailProps {
  steps: StepItem[];
  activeStep: number;
  title?: string;
}

export interface DefinitionProps {
  term: string;
  category?: string;
  definition: string;
  keyPoints?: string[];
  icon?: string;
}

export interface StatCounterProps {
  number: number;
  suffix?: string;
  prefix?: string;
  label: string;
  subtext?: string;
}

export interface ImageVisualProps {
  imageUrl?: string;
  caption?: string;
  zoomDirection?: 'in' | 'out';
}

export interface QuizVisualProps {
  question: string;
  options: { key: string; text: string }[];
  correctKey: string;
  explanation: string;
  countdownSec?: number;
}

export type VisualProps =
  | { type: 'formula'; data: MathFormulaProps }
  | { type: 'code'; data: CodeBlockProps }
  | { type: 'comparison'; data: ComparisonProps }
  | { type: 'step_rail'; data: StepRailProps }
  | { type: 'definition'; data: DefinitionProps }
  | { type: 'stat_counter'; data: StatCounterProps }
  | { type: 'image'; data: ImageVisualProps }
  | { type: 'quiz'; data: QuizVisualProps };

export interface Scene {
  id: string;
  sceneIndex: number;
  sceneType: 'hook' | 'concept' | 'comparison' | 'pipeline' | 'takeaway' | 'quiz' | 'outro';
  title: string;
  narration: string;
  audioUrl?: string;
  audioDuration?: number; // seconds
  durationInFrames: number;
  visualType: VisualType;
  visualProps: any; // typed by VisualProps
}

export interface RemotionVideoData {
  id?: string;
  title: string;
  brandName?: string;
  subjectName?: string;
  templateType: 'explainer' | 'comparison' | 'pipeline' | 'quiz';
  aspectRatio: '9:16' | '16:9';
  fps: number;
  totalFrames: number;
  scenes: Scene[];
}
