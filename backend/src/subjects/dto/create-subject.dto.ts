import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateSubjectDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string;

    // Role definition fields for AI prompt context
    @IsOptional()
    @IsString()
    @MaxLength(100)
    institutionType?: string; // Đại học, Cao đẳng, THPT, Doanh nghiệp

    @IsOptional()
    @IsString()
    @MaxLength(500)
    expertiseArea?: string; // Lĩnh vực chuyên môn của giảng viên

    @IsOptional()
    @IsString()
    @MaxLength(200)
    courseName?: string; // Tên môn học đầy đủ

    @IsOptional()
    @IsString()
    @MaxLength(500)
    targetAudience?: string; // Đối tượng học viên

    @IsOptional()
    @IsString()
    @MaxLength(200)
    majorName?: string; // Ngành học

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    additionalContext?: string; // Yêu cầu bổ sung
}
