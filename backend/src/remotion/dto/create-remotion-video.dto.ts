import { IsString, IsOptional, IsInt, IsIn, IsArray, IsBoolean } from 'class-validator';

export class CreateRemotionVideoDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  lessonId?: string;

  @IsOptional()
  @IsIn(['slide', 'ai_topic', 'manual'])
  inputType?: 'slide' | 'ai_topic' | 'manual' = 'slide';

  @IsOptional()
  @IsInt()
  sourceSlideIdx?: number;

  @IsOptional()
  @IsIn(['explainer', 'comparison', 'pipeline', 'quiz'])
  templateType?: 'explainer' | 'comparison' | 'pipeline' | 'quiz' = 'explainer';

  @IsOptional()
  @IsIn(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9' = '9:16';

  @IsOptional()
  @IsInt()
  targetDuration?: number; // seconds: 30, 45, 60, etc.

  @IsOptional()
  @IsString()
  scriptContent?: string;

  @IsOptional()
  @IsArray()
  scenes?: any[];
}

export class UpdateRemotionVideoDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(['explainer', 'comparison', 'pipeline', 'quiz'])
  templateType?: 'explainer' | 'comparison' | 'pipeline' | 'quiz';

  @IsOptional()
  @IsIn(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9';

  @IsOptional()
  @IsInt()
  targetDuration?: number;

  @IsOptional()
  @IsArray()
  scenes?: any[];
}

export class SuggestTopicsDto {
  @IsString()
  lessonId: string;
}

export class GenerateSceneAudioDto {
  @IsInt()
  sceneIndex: number;

  @IsOptional()
  @IsString()
  voiceId?: string;

  @IsOptional()
  @IsString()
  multilingualMode?: string;

  @IsOptional()
  @IsString()
  vittsEngine?: string;

  @IsOptional()
  @IsString()
  vittsMode?: string;

  @IsOptional()
  @IsString()
  vittsDesignInstruct?: string;

  @IsOptional()
  @IsBoolean()
  vittsNormalize?: boolean;
}

export class GenerateSceneImageDto {
  @IsInt()
  sceneIndex: number;

  @IsOptional()
  @IsString()
  prompt?: string;
}
