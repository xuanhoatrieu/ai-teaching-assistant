import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVideoDto {
  @ApiPropertyOptional({ enum: ['horizontal', 'vertical'], default: 'horizontal' })
  @IsOptional()
  @IsString()
  format?: string = 'horizontal';

  @ApiPropertyOptional({ enum: ['480p', '720p', '1080p', '4k'], default: '1080p' })
  @IsOptional()
  @IsString()
  resolution?: string = '1080p';

  @ApiPropertyOptional({ enum: ['vi', 'en'], default: 'vi' })
  @IsOptional()
  @IsString()
  narrationLang?: string = 'vi';

  @ApiPropertyOptional({ enum: ['vi', 'en', 'both', 'none'], default: 'vi' })
  @IsOptional()
  @IsString()
  subtitleLang?: string = 'vi';

  @ApiPropertyOptional({ minimum: 0.5, maximum: 2.0, default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  narrationSpeed?: number = 1.0;

  @ApiPropertyOptional({ enum: ['auto', 'manim', 'static', 'hybrid'], default: 'auto' })
  @IsOptional()
  @IsString()
  style?: string = 'auto';
}
