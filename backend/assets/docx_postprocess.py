#!/usr/bin/env python3
"""
DOCX Post-Processor for Textbook Export

Post-processes Pandoc DOCX output:
1. Code blocks: gray background, border, Consolas font, LEFT alignment (forced via XML)
2. ALL other paragraphs: force Times New Roman font (override Aptos theme)

Usage: python3 docx_postprocess.py input.docx output.docx
"""
import sys
from docx import Document
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml


def force_font_on_runs(paragraph, font_name, font_size_half_pt=None):
    """Force font on all runs via XML w:rFonts."""
    for run in paragraph.runs:
        rPr = run._r.find(qn('w:rPr'))
        if rPr is None:
            rPr = parse_xml(f'<w:rPr {nsdecls("w")} />')
            run._r.insert(0, rPr)

        existing = rPr.find(qn('w:rFonts'))
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
            for tag in ['w:sz', 'w:szCs']:
                existing_sz = rPr.find(qn(tag))
                if existing_sz is not None:
                    rPr.remove(existing_sz)
            rPr.append(parse_xml(f'<w:sz {nsdecls("w")} w:val="{font_size_half_pt}"/>'))
            rPr.append(parse_xml(f'<w:szCs {nsdecls("w")} w:val="{font_size_half_pt}"/>'))


def force_left_alignment(paragraph):
    """Force LEFT alignment via direct XML - python-docx won't write LEFT because it's 'default'."""
    pPr = paragraph._p.get_or_add_pPr()
    # Remove any existing jc
    existing_jc = pPr.find(qn('w:jc'))
    if existing_jc is not None:
        pPr.remove(existing_jc)
    # Explicitly write <w:jc w:val="left"/>
    jc = parse_xml(f'<w:jc {nsdecls("w")} w:val="left"/>')
    pPr.append(jc)


def add_shading(paragraph, color="F5F5F5"):
    """Add background shading to a paragraph."""
    pPr = paragraph._p.get_or_add_pPr()
    existing = pPr.find(qn('w:shd'))
    if existing is not None:
        pPr.remove(existing)
    shd = parse_xml(
        f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{color}"/>'
    )
    pPr.append(shd)


def add_border(paragraph):
    """Add box border to a paragraph."""
    pPr = paragraph._p.get_or_add_pPr()
    existing = pPr.find(qn('w:pBdr'))
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
    """Check if a paragraph is a code block."""
    style_name = paragraph.style.name if paragraph.style else ""
    return any(cn in style_name for cn in ["Source Code", "Verbatim"])


def postprocess_docx(input_path, output_path):
    """Post-process Pandoc DOCX: fix fonts + code block styling."""
    doc = Document(input_path)

    code_count = 0
    body_count = 0

    for paragraph in doc.paragraphs:
        if is_code_paragraph(paragraph):
            # Code blocks: Consolas + gray + border + LEFT (via XML)
            force_font_on_runs(paragraph, "Consolas", 20)
            add_shading(paragraph)
            add_border(paragraph)
            force_left_alignment(paragraph)  # XML-level, not python-docx API
            code_count += 1
        else:
            # Everything else: force Times New Roman
            force_font_on_runs(paragraph, "Times New Roman")
            body_count += 1

    doc.save(output_path)
    print(f"Post-processed: {code_count} code (LEFT) + {body_count} body paragraphs")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 docx_postprocess.py input.docx output.docx")
        sys.exit(1)
    postprocess_docx(sys.argv[1], sys.argv[2])
