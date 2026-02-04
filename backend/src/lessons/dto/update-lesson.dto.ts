import { PartialType } from '@nestjs/mapped-types';
import { CreateLessonDto } from './create-lesson.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { LessonStatus } from '@prisma/client';

export class UpdateLessonDto extends PartialType(CreateLessonDto) {
    @IsOptional()
    @IsEnum(LessonStatus)
    status?: LessonStatus;
}
