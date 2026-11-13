#!/usr/bin/env python3
"""
DOCX Post-Processor for Textbook & Practice Guide Export

Post-processes Pandoc / fallback DOCX output:
- Default profile ("textbook"):
  1. Code blocks: gray background, border, Consolas font, LEFT alignment (forced via XML)
  2. ALL other paragraphs & tables: force Times New Roman font (override Aptos theme), black table borders
- Practice Guide profile ("practice"):
  1. Page setup: A4 (21.0 x 29.7 cm), Margins: Left 3.0 cm, Top/Right/Bottom 2.0 cm
  2. Body typography: Times New Roman, size 13pt, Line spacing Multiple 1.3, Paragraph spacing 4pt after (0pt before)
  3. Code blocks: Consolas 10pt, light gray box + border, LEFT alignment
  4. Tables:
     - Single black borders on all edges + repeating header row + cantSplit
     - ZERO extra line spacing (Single 1.0) and ZERO paragraph spacing (before=0pt, after=0pt)
     - Header row: centered horizontally & vertically, bold
     - Numeric/data columns: centered horizontally & vertically
     - Text/other columns: LEFT horizontally, CENTER vertically ("trái ở giữa")

Usage:
  python3 docx_postprocess.py input.docx output.docx [--profile textbook|practice]
"""
import argparse
import re
import sys
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt


FONT_NAME = "Times New Roman"
BODY_HALF_PT = 26  # 13pt
HEADING_HALF_PT_PRACTICE = {
    "Title": 30,      # 15pt bold
    "Subtitle": 26,   # 13pt bold
    "Heading 1": 28,  # 14pt bold
    "Heading 2": 26,  # 13pt bold
    "Heading 3": 26,  # 13pt bold
    "Heading 4": 26,  # 13pt bold
    "Heading 5": 26,  # 13pt bold
}

NUMERIC_CELL_RE = re.compile(
    r"^("
    r"[-+]?\d+(?:[.,]\d+)?"
    r"(?:\s*(?:%|cm|mm|m|km|ml|l|g|kg|mg|ug|µg|°c|c|k|v|mv|a|ma|w|kw|hz|khz|mhz|s|ms|phút|giờ|tiết|đ|đ\.|điểm|lần|mẫu|px))?"
    r"|\d+\s*[:/×x\-–]\s*\d+"
    r"|[.\-_]{2,}"
    r")$",
    re.IGNORECASE,
)

NUMERIC_HEADER_HINT_RE = re.compile(
    r"^(stt|tt|số\s*tt|thứ\s*tự|số\s*lượng|trọng\s*số(?:\s*\(%\))?|điểm(?:\s*tối\s*đa)?|tỷ\s*lệ(?:\s*\(%\))?|lần\s*\d+|mẫu\s*\d+|thời\s*lượng|thời\s*gian)$",
    re.IGNORECASE,
)


def force_font_on_runs(paragraph, font_name, font_size_half_pt=None, force_bold=None):
    """Force font (and optionally size/bold) on all runs via XML w:rFonts."""
    for run in paragraph.runs:
        style_name = run.style.name if run.style else ""
        if any(cn in style_name for cn in ["Verbatim", "Source Code"]) and font_name != "Consolas":
            # Keep monospace font for inline code snippets
            continue

        rPr = run._r.find(qn("w:rPr"))
        if rPr is None:
            rPr = parse_xml(f'<w:rPr {nsdecls("w")} />')
            run._r.insert(0, rPr)

        existing = rPr.find(qn("w:rFonts"))
        if existing is not None:
            rPr.remove(existing)

        rFonts = parse_xml(
            f'<w:rFonts {nsdecls("w")}'
            f' w:ascii="{font_name}"'
            f' w:hAnsi="{font_name}"'
            f' w:eastAsia="{font_name}"'
            f' w:cs="{font_name}"/>'
        )
        rPr.insert(0, rFonts)

        if font_size_half_pt:
            for tag in ["w:sz", "w:szCs"]:
                existing_sz = rPr.find(qn(tag))
                if existing_sz is not None:
                    rPr.remove(existing_sz)
            rPr.append(parse_xml(f'<w:sz {nsdecls("w")} w:val="{font_size_half_pt}"/>'))
            rPr.append(parse_xml(f'<w:szCs {nsdecls("w")} w:val="{font_size_half_pt}"/>'))

        if force_bold is True:
            run.bold = True


def set_paragraph_jc(paragraph, align_val: str):
    """Force horizontal alignment via direct XML <w:jc w:val='...'/>."""
    pPr = paragraph._p.get_or_add_pPr()
    existing_jc = pPr.find(qn("w:jc"))
    if existing_jc is not None:
        pPr.remove(existing_jc)
    jc = parse_xml(f'<w:jc {nsdecls("w")} w:val="{align_val}"/>')
    pPr.append(jc)


def force_left_alignment(paragraph):
    set_paragraph_jc(paragraph, "left")


def set_paragraph_spacing_xml(paragraph, before_twips: int, after_twips: int, line_val: int, line_rule: str = "auto"):
    """Explicitly set <w:spacing> at paragraph XML level so style inheritance cannot override it."""
    pPr = paragraph._p.get_or_add_pPr()
    existing = pPr.find(qn("w:spacing"))
    if existing is not None:
        pPr.remove(existing)
    spacing = parse_xml(
        f'<w:spacing {nsdecls("w")} w:before="{before_twips}" w:after="{after_twips}" w:line="{line_val}" w:lineRule="{line_rule}"/>'
    )
    pPr.append(spacing)


def set_style_font_and_spacing(style, font_name, half_pt, before_pt=None, after_pt=None, multiple_line=None):
    """Normalize a style's rFonts, size, and paragraph spacing in XML."""
    rPr = style.element.find(qn("w:rPr"))
    if rPr is None:
        rPr = parse_xml(f'<w:rPr {nsdecls("w")} />')
        style.element.append(rPr)

    existing = rPr.find(qn("w:rFonts"))
    if existing is not None:
        rPr.remove(existing)
    rPr.insert(
        0,
        parse_xml(
            f'<w:rFonts {nsdecls("w")}'
            f' w:ascii="{font_name}"'
            f' w:hAnsi="{font_name}"'
            f' w:eastAsia="{font_name}"'
            f' w:cs="{font_name}"/>'
        ),
    )

    if half_pt:
        for tag in ["w:sz", "w:szCs"]:
            ex = rPr.find(qn(tag))
            if ex is not None:
                rPr.remove(ex)
        rPr.append(parse_xml(f'<w:sz {nsdecls("w")} w:val="{half_pt}"/>'))
        rPr.append(parse_xml(f'<w:szCs {nsdecls("w")} w:val="{half_pt}"/>'))

    if style.type == 1:  # paragraph style
        pf = style.paragraph_format
        if before_pt is not None:
            pf.space_before = Pt(before_pt)
        if after_pt is not None:
            pf.space_after = Pt(after_pt)
        if multiple_line is not None:
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = multiple_line


def add_shading(paragraph, color="F5F5F5"):
    """Add background shading to a paragraph."""
    pPr = paragraph._p.get_or_add_pPr()
    existing = pPr.find(qn("w:shd"))
    if existing is not None:
        pPr.remove(existing)
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{color}"/>')
    pPr.append(shd)


def add_border(paragraph):
    """Add box border to a paragraph."""
    pPr = paragraph._p.get_or_add_pPr()
    existing = pPr.find(qn("w:pBdr"))
    if existing is not None:
        pPr.remove(existing)
    borders = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        '  <w:top w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>'
        '  <w:left w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/>'
        '  <w:bottom w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>'
        '  <w:right w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/>'
        '</w:pBdr>'
    )
    pPr.append(borders)


def is_code_paragraph(paragraph):
    """Check if a paragraph is a code block (Pandoc style or monospace fallback)."""
    style_name = paragraph.style.name if paragraph.style else ""
    if any(cn in style_name for cn in ["Source Code", "Verbatim"]):
        return True
    pPr = paragraph._p.find(qn("w:pPr"))
    has_fill = pPr is not None and pPr.find(qn("w:shd")) is not None
    if has_fill and paragraph.runs:
        fonts = {r.font.name for r in paragraph.runs if r.font and r.font.name}
        if fonts and fonts.issubset({"Consolas", "Courier New"}):
            return True
    return False


def add_table_borders(table):
    """Force single black borders (all sides + inside) on a table via tblPr."""
    tblPr = table._tbl.tblPr
    existing = tblPr.find(qn("w:tblBorders"))
    if existing is not None:
        tblPr.remove(existing)
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        '  <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '  <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '  <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '  <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '</w:tblBorders>'
    )
    tblPr.append(borders)


def set_table_practice_props(table):
    """Set 100% width and tidy cell padding on a practice table."""
    tblPr = table._tbl.tblPr
    for tag in ["w:tblW", "w:tblCellMar"]:
        ex = tblPr.find(qn(tag))
        if ex is not None:
            tblPr.remove(ex)
    tblPr.append(parse_xml(f'<w:tblW {nsdecls("w")} w:w="5000" w:type="pct"/>'))
    tblPr.append(
        parse_xml(
            f'<w:tblCellMar {nsdecls("w")}>'
            '  <w:top w:w="60" w:type="dxa"/>'
            '  <w:left w:w="100" w:type="dxa"/>'
            '  <w:bottom w:w="60" w:type="dxa"/>'
            '  <w:right w:w="100" w:type="dxa"/>'
            '</w:tblCellMar>'
        )
    )


def set_cell_vertical_center(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    ex = tcPr.find(qn("w:vAlign"))
    if ex is not None:
        tcPr.remove(ex)
    tcPr.append(parse_xml(f'<w:vAlign {nsdecls("w")} w:val="center"/>'))


def set_cell_shading(cell, fill="F2F2F2"):
    tcPr = cell._tc.get_or_add_tcPr()
    ex = tcPr.find(qn("w:shd"))
    if ex is not None:
        tcPr.remove(ex)
    tcPr.append(parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{fill}"/>'))


def is_row_header(row, row_idx: int) -> bool:
    if row_idx == 0:
        return True
    trPr = row._tr.find(qn("w:trPr"))
    return trPr is not None and trPr.find(qn("w:tblHeader")) is not None


def mark_row_header_and_no_split(row, is_hdr: bool):
    trPr = row._tr.find(qn("w:trPr"))
    if trPr is None:
        trPr = parse_xml(f'<w:trPr {nsdecls("w")} />')
        row._tr.insert(0, trPr)
    if trPr.find(qn("w:cantSplit")) is None:
        trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")} />'))
    if is_hdr and trPr.find(qn("w:tblHeader")) is None:
        trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")} />'))


def detect_numeric_columns(table) -> set[int]:
    """Identify numeric/data/index columns using body cell values and header hints."""
    if len(table.rows) < 2:
        return set()

    num_cols = max(len(r.cells) for r in table.rows)
    header_row = table.rows[0]
    numeric_cols: set[int] = set()

    for c in range(num_cols):
        header_text = header_row.cells[c].text.strip() if c < len(header_row.cells) else ""
        body_texts = [
            row.cells[c].text.strip()
            for row in table.rows[1:]
            if c < len(row.cells) and row.cells[c].text.strip()
        ]
        if not body_texts:
            if NUMERIC_HEADER_HINT_RE.match(header_text):
                numeric_cols.add(c)
            continue

        numeric_matches = sum(1 for val in body_texts if NUMERIC_CELL_RE.match(val))
        ratio = numeric_matches / len(body_texts)
        avg_len = sum(len(v) for v in body_texts) / len(body_texts)

        if ratio >= 0.7:
            numeric_cols.add(c)
        elif NUMERIC_HEADER_HINT_RE.match(header_text) and avg_len <= 24:
            numeric_cols.add(c)

    return numeric_cols


def apply_practice_page_and_styles(doc: Document):
    """Apply A4, Left 3cm / Top-Right-Bottom 2cm, TNR 13pt, 1.3x line spacing, 4pt after."""
    for section in doc.sections:
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin = Cm(3.0)
        section.right_margin = Cm(2.0)

    for style in doc.styles:
        if style.type not in (1, 2):
            continue
        name = style.name
        if any(cn in name for cn in ["Source Code", "Verbatim"]):
            set_style_font_and_spacing(style, "Consolas", 20, before_pt=4, after_pt=4, multiple_line=1.15)
        elif name in HEADING_HALF_PT_PRACTICE:
            is_top_title = name in ("Title", "Subtitle")
            set_style_font_and_spacing(
                style,
                FONT_NAME,
                HEADING_HALF_PT_PRACTICE[name],
                before_pt=6,
                after_pt=4,
                multiple_line=1.3,
            )
            if style.type == 1:
                style.font.bold = True
                style.paragraph_format.alignment = (
                    WD_ALIGN_PARAGRAPH.CENTER if is_top_title else WD_ALIGN_PARAGRAPH.LEFT
                )
        else:
            set_style_font_and_spacing(
                style,
                FONT_NAME,
                BODY_HALF_PT,
                before_pt=0,
                after_pt=4,
                multiple_line=1.3,
            )
            if style.type == 1 and name in ("Normal", "Body Text", "First Paragraph", "Compact"):
                style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY


def postprocess_docx(input_path, output_path, profile="textbook"):
    """Post-process Pandoc/fallback DOCX according to selected profile."""
    doc = Document(input_path)
    is_practice = profile == "practice"

    if is_practice:
        apply_practice_page_and_styles(doc)

    code_count = 0
    body_count = 0

    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        if is_code_paragraph(paragraph):
            force_font_on_runs(paragraph, "Consolas", 20)
            add_shading(paragraph)
            add_border(paragraph)
            force_left_alignment(paragraph)
            if is_practice:
                set_paragraph_spacing_xml(paragraph, before_twips=0, after_twips=40, line_val=264)
            code_count += 1
        elif is_practice:
            target_sz = HEADING_HALF_PT_PRACTICE.get(style_name, BODY_HALF_PT)
            is_heading = style_name in HEADING_HALF_PT_PRACTICE
            force_font_on_runs(paragraph, FONT_NAME, target_sz, force_bold=True if is_heading else None)

            # Top 6pt (120 twips) before headings only; 4pt (80 twips) after; 1.3x line spacing (312)
            has_drawing = bool(paragraph._p.findall(".//" + qn("w:drawing")))
            if has_drawing:
                set_paragraph_jc(paragraph, "center")
                set_paragraph_spacing_xml(paragraph, before_twips=80, after_twips=80, line_val=240)
            elif style_name in ("Title", "Subtitle"):
                set_paragraph_jc(paragraph, "center")
                set_paragraph_spacing_xml(paragraph, before_twips=60, after_twips=80, line_val=312)
            elif is_heading:
                set_paragraph_jc(paragraph, "left")
                set_paragraph_spacing_xml(paragraph, before_twips=120, after_twips=80, line_val=312)
            else:
                set_paragraph_spacing_xml(paragraph, before_twips=0, after_twips=80, line_val=312)
            body_count += 1
        else:
            force_font_on_runs(paragraph, FONT_NAME)
            body_count += 1

    table_count = 0
    for table in doc.tables:
        add_table_borders(table)
        if is_practice:
            set_table_practice_props(table)
            numeric_cols = detect_numeric_columns(table)
            for r_idx, row in enumerate(table.rows):
                hdr = is_row_header(row, r_idx)
                mark_row_header_and_no_split(row, hdr)
                for c_idx, cell in enumerate(row.cells):
                    set_cell_vertical_center(cell)
                    if hdr:
                        set_cell_shading(cell, "F2F2F2")
                    for paragraph in cell.paragraphs:
                        force_font_on_runs(
                            paragraph,
                            FONT_NAME,
                            BODY_HALF_PT,
                            force_bold=True if hdr else None,
                        )
                        # Zero line/paragraph spacing inside tables: single line (240), before=0, after=0
                        set_paragraph_spacing_xml(paragraph, before_twips=0, after_twips=0, line_val=240)
                        if hdr or (c_idx in numeric_cols):
                            set_paragraph_jc(paragraph, "center")
                        else:
                            set_paragraph_jc(paragraph, "left")
        else:
            for row in table.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        force_font_on_runs(paragraph, FONT_NAME)
        table_count += 1

    doc.save(output_path)
    print(f"Post-processed ({profile}): {code_count} code + {body_count} body paragraphs + {table_count} tables")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Post-process generated DOCX formatting.")
    parser.add_argument("input_path")
    parser.add_argument("output_path")
    parser.add_argument("--profile", choices=["textbook", "practice"], default="textbook")
    args = parser.parse_args()
    postprocess_docx(args.input_path, args.output_path, profile=args.profile)
