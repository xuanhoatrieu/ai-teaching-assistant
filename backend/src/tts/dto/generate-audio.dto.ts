import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max, MinLength, MaxLength, IsIn } from 'class-validator';

export class GenerateAudioDto {
    @IsString()
    @MinLength(1)
    @MaxLength(5000)
    text: string;

    @IsOptional()
    @IsString()
    voiceId?: string;

    @IsOptional()
    @IsString()
    model?: string; // TTS model, e.g., 'gemini-2.5-flash-preview-tts'

    @IsOptional()
    @IsString()
    provider?: string; // TTS provider: 'GEMINI', 'VBEE', or 'VITTS'

    @IsOptional()
    @IsNumber()
    @Min(0.5)
    @Max(2.0)
    speed?: number;

    @IsOptional()
    @IsNumber()
    @Min(-20)
    @Max(20)
    pitch?: number;

    @IsOptional()
    @IsString()
    languageCode?: string;

    @IsOptional()
    @IsString()
    @IsIn(['auto', 'syllable', 'english', null])
    multilingualMode?: string; // ViTTS multilingual: 'auto', 'syllable', 'english'

    @IsOptional()
    @IsString()
    @IsIn(['auto', 'clone', 'design', null])
    vittsMode?: string; // OmniVoice mode: 'auto', 'clone', 'design'

    @IsOptional()
    @IsString()
    @MaxLength(500)
    vittsDesignInstruct?: string; // Voice Design instruct text

    @IsOptional()
    @IsBoolean()
    vittsNormalize?: boolean; // SEA-G2P Normalize, default true
}
