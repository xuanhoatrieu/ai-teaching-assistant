import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class CreateUserTTSConfigDto {
    @IsString()
    providerId: string;

    @IsOptional()
    @IsObject()
    credentials?: Record<string, string>;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}

export class UpdateUserTTSConfigDto {
    @IsOptional()
    @IsObject()
    credentials?: Record<string, string>;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}
