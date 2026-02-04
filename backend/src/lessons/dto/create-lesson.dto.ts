import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateLessonDto {
    @IsString()
    @MinLength(1)
    @MaxLength(300)
    title: string;

    @IsOptional()
    @IsString()
    @MaxLength(50000)
    outlineRaw?: string;
}
