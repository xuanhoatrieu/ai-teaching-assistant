import { IsString, IsOptional, IsIn } from 'class-validator';

export class CreateDictionaryEntryDto {
    @IsString()
    @IsIn(['acronym', 'word'])
    type: string;

    @IsString()
    original: string;

    @IsString()
    replacement: string;
}

export class UpdateDictionaryEntryDto {
    @IsOptional()
    @IsString()
    original?: string;

    @IsOptional()
    @IsString()
    replacement?: string;
}

export class NormalizeTextDto {
    @IsString()
    text: string;

    @IsOptional()
    enableTransliteration?: boolean = true;
}

export class ImportCsvDto {
    @IsString()
    @IsIn(['acronym', 'word'])
    type: string;

    @IsString()
    csvContent: string; // Raw CSV text: "original,replacement\nCPU,xê pê u\n..."
}
