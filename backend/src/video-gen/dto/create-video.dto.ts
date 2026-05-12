import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';


/**
 * DTO for creating a new video (draft) in a subject.
 * POST /subjects/:subjectId/videos
 */
export class CreateVideoDto {
  @IsOptional()
  @IsString()
  title?: string;

  // Input source
  @IsOptional()
  @IsString()
  inputType?: string = 'manual'; // 'lesson' | 'manual' | 'upload'

  @IsOptional()
  @IsString()
  lessonId?: string; // If inputType === 'lesson'

  @IsOptional()
  @IsString()
  inputText?: string; // If inputType === 'manual'

  @IsOptional()
  @IsArray()
  inputFiles?: Array<{ name: string; url: string; type: string }>; // If inputType === 'upload'

  // Video config
  @IsOptional()
  @IsString()
  format?: string = 'horizontal';

  @IsOptional()
  @IsString()
  resolution?: string = '1080p';

  @IsOptional()
  @IsString()
  narrationLang?: string = 'vi';

  @IsOptional()
  @IsString()
  subtitleLang?: string = 'vi';

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  narrationSpeed?: number = 1.0;

  @IsOptional()
  @IsString()
  style?: string = 'auto';
}


/**
 * DTO for updating a video's config / input.
 * PUT /subjects/:subjectId/videos/:videoId
 */
export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  inputType?: string;

  @IsOptional()
  @IsString()
  lessonId?: string;

  @IsOptional()
  @IsString()
  inputText?: string;

  @IsOptional()
  @IsArray()
  inputFiles?: Array<{ name: string; url: string; type: string }>;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  narrationLang?: string;

  @IsOptional()
  @IsString()
  subtitleLang?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  narrationSpeed?: number;

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsNumber()
  wizardStep?: number;
}


/**
 * DTO for saving an edited video script.
 * PUT /subjects/:subjectId/videos/:videoId/script
 */
export class SaveScriptDto {
  @IsArray()
  scenes: Array<{
    index: number;
    title: string;
    approach: string;
    narration_vi?: string;
    narration_en?: string;
    visual_desc?: string;
    image_prompt?: string;
    manim_code?: string;
    duration_est?: number;
  }>;
}
