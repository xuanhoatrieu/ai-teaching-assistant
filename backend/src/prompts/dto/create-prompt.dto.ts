import {
    IsString,
    IsOptional,
    IsArray,
    IsBoolean,
    MaxLength,
} from 'class-validator';

export class CreatePromptDto {
    @IsString()
    slug: string;

    @IsString()
    name: string;

    @IsString()
    @MaxLength(10000)
    content: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    variables?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
