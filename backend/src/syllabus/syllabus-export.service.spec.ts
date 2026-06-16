import { SyllabusExportService } from './syllabus-export.service';
import { Table, TableRow, TableCell } from 'docx';

describe('SyllabusExportService', () => {
    let service: SyllabusExportService;

    beforeEach(() => {
        service = new SyllabusExportService();
    });

    it('should parse markdown table correctly', () => {
        const markdown = `Một số văn bản giới thiệu.

| Tiết | Nội dung | CĐR |
| --- | --- | --- |
| 1 | Lý thuyết | CLO1 |
| ^ | > | CLO2 |

Văn bản kết thúc.`;
        const parsed = (service as any).parseMarkdownTable(markdown);
        expect(parsed).not.toBeNull();
        expect(parsed.beforeText).toBe('Một số văn bản giới thiệu.');
        expect(parsed.afterText).toBe('Văn bản kết thúc.');
        expect(parsed.headers).toEqual(['Tiết', 'Nội dung', 'CĐR']);
        expect(parsed.rows).toEqual([
            ['1', 'Lý thuyết', 'CLO1'],
            ['^', '>', 'CLO2'],
        ]);
    });

    it('should build docx Table with correct cell spans', () => {
        const parsed = {
            headers: ['Tiết', 'Nội dung', 'CĐR'],
            rows: [
                ['1', 'Lý thuyết', 'CLO1'],
                ['^', '>', 'CLO2'],
            ],
        };
        const table = (service as any).buildDocxTable(parsed);
        expect(table).toBeInstanceOf(Table);
        
        // table.root contains TableProperties, TableGrid, and TableRow objects
        const rows = (table as any).root.filter((child: any) => child.rootKey === 'w:tr');
        expect(rows).toHaveLength(3); // header + 2 data rows
        
        // Check header row cells
        const headerCells = rows[0].options.children;
        expect(headerCells).toHaveLength(3); // 3 headers, no merge
        
        // Check Row 1 cells: ['1', 'Lý thuyết', 'CLO1'] -> no merge
        const row1Cells = rows[1].options.children;
        expect(row1Cells).toHaveLength(3);
        
        // Check Row 2 cells: ['^', '>', 'CLO2']
        // '^' is vertical merge continue -> cell 0 is continue
        // '>' is horizontal merge -> cell 1 is merged into cell 0, so cell 0 should span 2 columns!
        const row2Cells = rows[2].options.children;
        expect(row2Cells).toHaveLength(2); // cell 0 (columnSpan=2) + cell 1 (CLO2, columnSpan=1)
        
        const cell0 = row2Cells[0];
        expect(cell0.options.columnSpan).toBe(2);
        expect(cell0.options.verticalMerge).toBe('continue');
        
        const cell1 = row2Cells[1];
        expect(cell1.options.columnSpan).toBe(1);
        expect(cell1.options.verticalMerge).toBeUndefined();
    });
});
