import { IsString, IsOptional, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class SlideContentDto {
    @IsNumber()
    slideIndex: number;

    @IsString()
    title: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    content?: string[];

    @IsString()
    @IsOptional()
    imagePath?: string;

    @IsString()
    @IsOptional()
    audioPath?: string;

    @IsString()
    @IsOptional()
    speakerNote?: string;

    @IsString()
    @IsOptional()
    slideType?: string;
}

export class GeneratePptxDto {
    @IsString()
    templateId: string;
}

export class GeneratePptxRequestDto {
    @IsString()
    templatePath: string;

    @IsString()
    lessonTitle: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SlideContentDto)
    slides: SlideContentDto[];
}
