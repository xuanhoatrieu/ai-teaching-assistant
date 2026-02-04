import { IsString, IsEnum, IsBoolean, IsOptional, IsArray } from 'class-validator';
import { TTSProviderType } from '@prisma/client';

export class CreateTTSProviderDto {
    @IsString()
    name: string;

    @IsEnum(TTSProviderType)
    type: TTSProviderType;

    @IsOptional()
    @IsString()
    endpoint?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    requiredFields?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsBoolean()
    isSystem?: boolean;
}

export class UpdateTTSProviderDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    endpoint?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    requiredFields?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
