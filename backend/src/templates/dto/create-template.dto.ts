import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateTemplateDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    titleBgUrl?: string;

    @IsOptional()
    @IsString()
    contentBgUrl?: string;

    @IsOptional()
    @IsString()
    thumbnailUrl?: string;

    @IsOptional()
    @IsString()
    fileUrl?: string;  // Path to uploaded PPTX file

    @IsOptional()
    @IsString()
    stylingJson?: string;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}
