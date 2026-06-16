export interface ParsedTable {
    beforeText: string;
    headers: string[];
    rows: string[][];
    afterText: string;
}

/**
 * Parses a markdown string and extracts the first table found.
 * Preserves text before and after the table.
 * Replaces HTML <br> tags inside cells with newlines for visual editing.
 */
export function parseMarkdownTable(markdown: string): ParsedTable | null {
    if (!markdown) return null;
    
    const lines = markdown.split('\n');
    let tableStartIndex = -1;
    let tableEndIndex = -1;

    // Helper to check if a line is a separator row (e.g. | --- | :---: |)
    const isSeparatorRow = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
        const inner = trimmed.slice(1, -1);
        const parts = inner.split('|');
        if (parts.length === 0) return false;
        return parts.every(part => /^\s*:?-+:?\s*$/.test(part));
    };

    // Helper to check if a line is a table row
    const isTableRow = (line: string): boolean => {
        const trimmed = line.trim();
        return trimmed.startsWith('|') && trimmed.endsWith('|');
    };

    // Find the table start index (header line followed by separator line)
    for (let i = 0; i < lines.length - 1; i++) {
        if (isTableRow(lines[i]) && isSeparatorRow(lines[i + 1])) {
            tableStartIndex = i;
            break;
        }
    }

    if (tableStartIndex === -1) {
        return null;
    }

    // Find the table end index
    tableEndIndex = tableStartIndex + 1; // separator row is included
    while (tableEndIndex + 1 < lines.length && isTableRow(lines[tableEndIndex + 1])) {
        tableEndIndex++;
    }

    // Capture text before and after the table
    const beforeText = lines.slice(0, tableStartIndex).join('\n').trim();
    const afterText = lines.slice(tableEndIndex + 1).join('\n').trim();

    // Parse headers
    const headerLine = lines[tableStartIndex].trim().slice(1, -1);
    const headers = headerLine.split('|').map(cell => cell.trim());

    // Parse rows
    const rows: string[][] = [];
    for (let i = tableStartIndex + 2; i <= tableEndIndex; i++) {
        const rowLine = lines[i].trim().slice(1, -1);
        const cells = rowLine.split('|').map(cell => {
            let val = cell.trim();
            // Replace <br>, <br/>, <br /> (case-insensitive) with actual newlines
            val = val.replace(/<br\s*\/?>/gi, '\n');
            return val;
        });

        // Normalize cell count to match headers
        while (cells.length < headers.length) {
            cells.push('');
        }
        if (cells.length > headers.length) {
            cells.splice(headers.length);
        }
        rows.push(cells);
    }

    return {
        beforeText,
        headers,
        rows,
        afterText,
    };
}

/**
 * Converts a ParsedTable structure back into a Markdown string.
 * Replaces newlines inside cells with <br> tags.
 */
export function formatMarkdownTable(parsed: ParsedTable): string {
    const { beforeText, headers, rows, afterText } = parsed;
    const lines: string[] = [];

    if (beforeText) {
        lines.push(beforeText);
        lines.push(''); // blank line before table
    }

    // Format headers
    lines.push(`| ${headers.join(' | ')} |`);

    // Format separator
    const separators = headers.map(() => '---');
    lines.push(`| ${separators.join(' | ')} |`);

    // Format rows
    for (const row of rows) {
        const formattedCells = row.map(cell => {
            if (!cell) return '';
            // Replace newlines with <br> tags
            return cell.replace(/\r?\n/g, '<br>');
        });
        lines.push(`| ${formattedCells.join(' | ')} |`);
    }

    if (afterText) {
        lines.push(''); // blank line after table
        lines.push(afterText);
    }

    return lines.join('\n');
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

    // Calculate colspan (horizontal merge with right cells containing '>')
    for (let c = colIndex + 1; c < numCols; c++) {
        if (rows[rowIndex][c] === '>') {
            colSpan++;
        } else {
            break;
        }
    }

    // Calculate rowspan (vertical merge with bottom cells containing '^')
    for (let r = rowIndex + 1; r < numRows; r++) {
        // Only merge down if it hasn't hit a different column boundary
        if (rows[r][colIndex] === '^') {
            rowSpan++;
        } else {
            break;
        }
    }

    return { isMerged: false, colSpan, rowSpan };
}

