import { Injectable, Logger } from '@nestjs/common';

/**
 * FidelityValidatorService
 * 
 * Validates that AI-generated content covers all input sections
 * and doesn't add unauthorized content.
 * 
 * Key features:
 * 1. Coverage check: All input sections appear in output
 * 2. Addition detection: Warns if AI adds new topics
 * 3. Generates coverage report for responses
 */

export interface ValidationResult {
    isValid: boolean;
    coveragePercent: number;
    coveredSections: string[];
    missingSections: string[];
    additionalSections: string[];
    warnings: string[];
}

export interface ContentSection {
    id: string;
    title: string;
    subsections?: ContentSection[];
}

@Injectable()
export class FidelityValidatorService {
    private readonly logger = new Logger(FidelityValidatorService.name);

    /**
     * Validate outline output against raw outline input
     * 
     * @param rawOutline - Original user input (raw outline text)
     * @param generatedOutline - AI-generated detailed outline (JSON string or object)
     * @returns ValidationResult with coverage analysis
     */
    validateOutline(rawOutline: string, generatedOutline: string | object): ValidationResult {
        const inputSections = this.extractSectionsFromRaw(rawOutline);
        const outputSections = this.extractSectionsFromGenerated(generatedOutline);

        return this.compareAndValidate(inputSections, outputSections);
    }

    /**
     * Validate slides output covers all outline sections
     * 
     * @param detailedOutline - Outline JSON with sections
     * @param slideScript - AI-generated slide script (JSON string or object)
     * @returns ValidationResult with coverage analysis
     */
    validateSlides(detailedOutline: string | object, slideScript: string | object): ValidationResult {
        const inputSections = this.extractSectionsFromGenerated(detailedOutline);
        const outputSections = this.extractSlideSections(slideScript);

        return this.compareAndValidate(inputSections, outputSections);
    }

    /**
     * Extract sections from raw outline text
     * Looks for patterns like:
     * - "1. Topic"
     * - "- Topic"
     * - "# Topic"
     */
    private extractSectionsFromRaw(rawOutline: string): string[] {
        const sections: string[] = [];
        const lines = rawOutline.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Match numbered items: "1. Topic" or "1) Topic"
            const numberedMatch = trimmed.match(/^\d+[\.\)]\s*(.+)/);
            if (numberedMatch) {
                sections.push(this.normalize(numberedMatch[1]));
                continue;
            }

            // Match bullet items: "- Topic" or "* Topic"
            const bulletMatch = trimmed.match(/^[-*]\s*(.+)/);
            if (bulletMatch) {
                sections.push(this.normalize(bulletMatch[1]));
                continue;
            }

            // Match headers: "# Topic" or "## Topic"
            const headerMatch = trimmed.match(/^#+\s*(.+)/);
            if (headerMatch) {
                sections.push(this.normalize(headerMatch[1]));
                continue;
            }
        }

        return sections;
    }

    /**
     * Extract sections from generated JSON outline
     */
    private extractSectionsFromGenerated(outline: string | object): string[] {
        const sections: string[] = [];

        try {
            const data = typeof outline === 'string' ? this.parseJson(outline) : outline;

            // Extract from "sections" array
            if (data.sections && Array.isArray(data.sections)) {
                for (const section of data.sections) {
                    if (section.title) {
                        sections.push(this.normalize(section.title));
                    }
                    // Extract subsections
                    if (section.subsections && Array.isArray(section.subsections)) {
                        for (const sub of section.subsections) {
                            if (sub.title) {
                                sections.push(this.normalize(sub.title));
                            }
                        }
                    }
                }
            }

            // Extract from "agenda" array
            if (data.agenda && Array.isArray(data.agenda)) {
                for (const item of data.agenda) {
                    sections.push(this.normalize(item));
                }
            }

        } catch (error) {
            this.logger.warn('Failed to parse generated outline for sections');
        }

        return sections;
    }

    /**
     * Extract sections covered by slides
     */
    private extractSlideSections(slideScript: string | object): string[] {
        const sections: string[] = [];

        try {
            const data = typeof slideScript === 'string' ? this.parseJson(slideScript) : slideScript;

            // Check coverageCheck field (our custom field)
            if (data.coverageCheck?.inputSections) {
                return data.coverageCheck.inputSections.map((s: string) => this.normalize(s));
            }

            // Fallback: extract from slide titles
            if (data.slides && Array.isArray(data.slides)) {
                for (const slide of data.slides) {
                    if (slide.slideType === 'content' && slide.title) {
                        sections.push(this.normalize(slide.title));
                    }
                }
            }

        } catch (error) {
            this.logger.warn('Failed to parse slide script for sections');
        }

        return sections;
    }

    /**
     * Compare input and output sections
     */
    private compareAndValidate(inputSections: string[], outputSections: string[]): ValidationResult {
        const covered: string[] = [];
        const missing: string[] = [];
        const additional: string[] = [];
        const warnings: string[] = [];

        // Normalize both arrays
        const normalizedInput = inputSections.map(s => this.normalize(s));
        const normalizedOutput = outputSections.map(s => this.normalize(s));

        // Check coverage: input sections present in output
        for (const section of normalizedInput) {
            if (this.containsSimilar(normalizedOutput, section)) {
                covered.push(section);
            } else {
                missing.push(section);
            }
        }

        // Check additions: output sections not in input
        for (const section of normalizedOutput) {
            if (!this.containsSimilar(normalizedInput, section)) {
                additional.push(section);
            }
        }

        // Generate warnings
        if (missing.length > 0) {
            warnings.push(`⚠️ ${missing.length} mục trong input chưa được bao phủ: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`);
        }

        if (additional.length > 0) {
            warnings.push(`ℹ️ AI đã thêm ${additional.length} mục mới: ${additional.slice(0, 3).join(', ')}${additional.length > 3 ? '...' : ''}`);
        }

        const coveragePercent = normalizedInput.length > 0
            ? Math.round((covered.length / normalizedInput.length) * 100)
            : 100;

        return {
            isValid: missing.length === 0,
            coveragePercent,
            coveredSections: covered,
            missingSections: missing,
            additionalSections: additional,
            warnings,
        };
    }

    /**
     * Check if array contains a similar string (fuzzy match)
     */
    private containsSimilar(arr: string[], target: string): boolean {
        return arr.some(item => {
            // Exact match
            if (item === target) return true;

            // Contains check (one contains the other)
            if (item.includes(target) || target.includes(item)) return true;

            // Similarity > 70%
            const similarity = this.calculateSimilarity(item, target);
            return similarity > 0.7;
        });
    }

    /**
     * Calculate string similarity (Jaccard index on words)
     */
    private calculateSimilarity(a: string, b: string): number {
        const wordsA = new Set(a.toLowerCase().split(/\s+/));
        const wordsB = new Set(b.toLowerCase().split(/\s+/));

        const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
        const union = new Set([...wordsA, ...wordsB]);

        return intersection.size / union.size;
    }

    /**
     * Normalize string for comparison
     */
    private normalize(s: string): string {
        return s
            .toLowerCase()
            .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '') // Keep Vietnamese
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Parse JSON from string, handling markdown code blocks
     */
    private parseJson(str: string): any {
        // Extract from markdown code block if present
        const jsonMatch = str.match(/```json?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : str;
        return JSON.parse(jsonStr.trim());
    }

    /**
     * Generate human-readable coverage report
     */
    generateReport(result: ValidationResult): string {
        const lines: string[] = [];

        lines.push(`📊 **Coverage Report**`);
        lines.push(`- Coverage: ${result.coveragePercent}%`);
        lines.push(`- Status: ${result.isValid ? '✅ Pass' : '⚠️ Incomplete'}`);

        if (result.missingSections.length > 0) {
            lines.push(`\n**Missing sections:**`);
            for (const section of result.missingSections.slice(0, 5)) {
                lines.push(`- ❌ ${section}`);
            }
            if (result.missingSections.length > 5) {
                lines.push(`- ... và ${result.missingSections.length - 5} mục khác`);
            }
        }

        if (result.additionalSections.length > 0) {
            lines.push(`\n**Added by AI:**`);
            for (const section of result.additionalSections.slice(0, 3)) {
                lines.push(`- ➕ ${section}`);
            }
        }

        return lines.join('\n');
    }
}
