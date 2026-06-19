export interface ParsedTable {
    beforeText: string;
    headers: string[];
    rows: string[][];
    afterText: string;
}

// ============================================================================
// Segment model — mirrors backend splitIntoSegments() in
// backend/src/syllabus/syllabus-export.service.ts. A block's markdown is an
// ordered list of text and table segments. Keep the parsing predicates in sync
// with the backend so "what the user edits is what gets exported".
// ============================================================================

export type TextSegment = { type: 'text'; text: string };
export type TableSegment = { type: 'table'; headers: string[]; rows: string[][] };
export type Segment = TextSegment | TableSegment;

const isSeparatorRow = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
    const parts = trimmed.slice(1, -1).split('|');
    if (parts.length === 0) return false;
    return parts.every((part) => /^\s*:?-+:?\s*$/.test(part));
};

const isTableRow = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|');
};

const parseRow = (line: string, colCount: number): string[] => {
    const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim().replace(/<br\s*\/?>/gi, '\n'));
    while (cells.length < colCount) cells.push('');
    if (cells.length > colCount) cells.splice(colCount);
    return cells;
};

/**
 * Parse markdown into an ordered list of text / table segments.
 * Does NOT promote empty header rows (backend export handles that for render);
 * the editor keeps headers verbatim so round-tripping never drops rows.
 */
export function parseSegments(markdown: string): Segment[] {
    const segments: Segment[] = [];
    if (!markdown) return segments;

    const lines = markdown.split('\n');
    let textBuffer: string[] = [];
    const flushText = () => {
        if (textBuffer.length) {
            const text = textBuffer.join('\n').trim();
            if (text) segments.push({ type: 'text', text });
            textBuffer = [];
        }
    };

    let i = 0;
    while (i < lines.length) {
        if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
            flushText();
            const headers = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
            const colCount = headers.length;
            const rows: string[][] = [];
            let j = i + 2;
            while (j < lines.length && isTableRow(lines[j]) && !isSeparatorRow(lines[j])) {
                rows.push(parseRow(lines[j], colCount));
                j++;
            }
            segments.push({ type: 'table', headers, rows });
            i = j;
        } else {
            textBuffer.push(lines[i]);
            i++;
        }
    }
    flushText();

    return segments;
}

/**
 * Serialize an ordered segment list back into markdown. Tables use `---`
 * separators and encode in-cell newlines as <br>. Segments are joined with a
 * single blank line.
 */
export function serializeSegments(segments: Segment[]): string {
    const parts: string[] = [];
    for (const seg of segments) {
        if (seg.type === 'text') {
            const text = seg.text.trim();
            if (text) parts.push(text);
        } else {
            const lines: string[] = [];
            lines.push(`| ${seg.headers.join(' | ')} |`);
            lines.push(`| ${seg.headers.map(() => '---').join(' | ')} |`);
            for (const row of seg.rows) {
                const cells = row.map((cell) => (cell ? cell.replace(/\r?\n/g, '<br>') : ''));
                lines.push(`| ${cells.join(' | ')} |`);
            }
            parts.push(lines.join('\n'));
        }
    }
    return parts.join('\n\n');
}

/**
 * Calculates the colspan and rowspan for a cell at (rowIndex, colIndex) in a table grid.
 * Returns { isMerged: true } if the cell itself is merged into another cell (i.e. contains '>' or '^').
 */
export function getCellSpan(rows: string[][], rowIndex: number, colIndex: number) {
    const value = rows[rowIndex]?.[colIndex];
    if (value === '>' || value === '^') {
        return { isMerged: true, colSpan: 1, rowSpan: 1 };
    }

    let colSpan = 1;
    let rowSpan = 1;
    const numRows = rows.length;
    const numCols = rows[0]?.length || 0;

    for (let c = colIndex + 1; c < numCols; c++) {
        if (rows[rowIndex][c] === '>') {
            colSpan++;
        } else {
            break;
        }
    }

    for (let r = rowIndex + 1; r < numRows; r++) {
        if (rows[r][colIndex] === '^') {
            rowSpan++;
        } else {
            break;
        }
    }

    return { isMerged: false, colSpan, rowSpan };
}
