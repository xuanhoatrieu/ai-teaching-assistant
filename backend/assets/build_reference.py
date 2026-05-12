"""
Build Pandoc reference.docx template for textbook export.
Based on AWF skill pattern:
- A4 page, margins: top/bottom/right 2cm, left 3cm
- Font: Times New Roman 13pt (ALL styles), Consolas 10pt (code only)
- Alignment: Justify (body), Left (code, headings)
- Code blocks: bordered box with light gray background
"""
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(SCRIPT_DIR, "reference.docx")
PANDOC_PATH = os.path.join(SCRIPT_DIR, "..", "..", ".local", "bin", "pandoc")

# Use system pandoc or local
pandoc = PANDOC_PATH if os.path.exists(PANDOC_PATH) else "pandoc"

# Generate fresh default template
subprocess.run([pandoc, "-o", TEMPLATE, "--print-default-data-file", "reference.docx"],
               capture_output=True)

doc = Document(TEMPLATE)

# --- Page setup (A4, margins) ---
for section in doc.sections:
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(3.0)
    section.right_margin = Cm(2.0)


def force_font_xml(style_element, font_name, font_size_half_pt=None):
    """Force font family via XML to override theme fonts (Aptos etc.)."""
    rPr = style_element.find(qn('w:rPr'))
    if rPr is None:
        rPr = parse_xml(f'<w:rPr {nsdecls("w")} />')
        style_element.append(rPr)

    # Remove existing rFonts
    existing = rPr.find(qn('w:rFonts'))
    if existing is not None:
        rPr.remove(existing)

    # Set all font slots to override theme
    rFonts = parse_xml(
        f'<w:rFonts {nsdecls("w")}'
        f' w:ascii="{font_name}"'
        f' w:hAnsi="{font_name}"'
        f' w:eastAsia="{font_name}"'
        f' w:cs="{font_name}"/>'
    )
    rPr.insert(0, rFonts)

    if font_size_half_pt:
        existing_sz = rPr.find(qn('w:sz'))
        if existing_sz is not None:
            rPr.remove(existing_sz)
        existing_szCs = rPr.find(qn('w:szCs'))
        if existing_szCs is not None:
            rPr.remove(existing_szCs)
        sz = parse_xml(f'<w:sz {nsdecls("w")} w:val="{font_size_half_pt}"/>')
        szCs = parse_xml(f'<w:szCs {nsdecls("w")} w:val="{font_size_half_pt}"/>')
        rPr.append(sz)
        rPr.append(szCs)


def add_code_box(style):
    """Add border and gray background to a paragraph style for code blocks."""
    pPr = style.element.find(qn('w:pPr'))
    if pPr is None:
        pPr = parse_xml(f'<w:pPr {nsdecls("w")} />')
        style.element.insert(0, pPr)

    # Borders
    borders = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        '  <w:top w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>'
        '  <w:left w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/>'
        '  <w:bottom w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>'
        '  <w:right w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/>'
        '</w:pBdr>'
    )
    existing = pPr.find(qn('w:pBdr'))
    if existing is not None:
        pPr.remove(existing)
    pPr.append(borders)

    # Shading
    shading = parse_xml(
        f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="F5F5F5"/>'
    )
    existing_shd = pPr.find(qn('w:shd'))
    if existing_shd is not None:
        pPr.remove(existing_shd)
    pPr.append(shading)

    # Indentation
    ind = parse_xml(
        f'<w:ind {nsdecls("w")} w:left="284" w:right="284"/>'
    )
    existing_ind = pPr.find(qn('w:ind'))
    if existing_ind is not None:
        pPr.remove(existing_ind)
    pPr.append(ind)


# --- Constants ---
FONT_NAME = "Times New Roman"
BODY_SIZE = 26       # 13pt in half-points
CODE_SIZE = 20       # 10pt in half-points
CODE_FONT = "Consolas"

HEADING_SIZES = {
    "Heading 1": 36,   # 18pt
    "Heading 2": 32,   # 16pt
    "Heading 3": 28,   # 14pt
    "Heading 4": 26,   # 13pt
    "Heading 5": 26,   # 13pt
}

# --- Apply styles ---
for style in doc.styles:
    if style.type not in (1, 2):  # paragraph=1, character=2
        continue

    name = style.name
    is_code = any(cn in name for cn in ["Source Code", "Verbatim"])

    if is_code:
        # Code: Consolas + styling
        force_font_xml(style.element, CODE_FONT, CODE_SIZE)
        try:
            style.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
        except Exception:
            pass

        if style.type == 1:
            pf = style.paragraph_format
            pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
            pf.space_before = Pt(6)
            pf.space_after = Pt(6)
            add_code_box(style)
    else:
        # Everything else: Times New Roman
        if name in HEADING_SIZES:
            force_font_xml(style.element, FONT_NAME, HEADING_SIZES[name])
            style.font.bold = True
            if style.type == 1:
                style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        else:
            force_font_xml(style.element, FONT_NAME, BODY_SIZE)
            if style.type == 1:
                pf = style.paragraph_format
                pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

# Normal style explicitly
normal = doc.styles["Normal"]
force_font_xml(normal.element, FONT_NAME, BODY_SIZE)
normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
normal.paragraph_format.line_spacing = 1.3

# Also override theme fonts in document settings
try:
    theme = doc.element.find('.//' + qn('w:themeFontLang'))
    if theme is not None:
        theme.getparent().remove(theme)
except Exception:
    pass

doc.save(TEMPLATE)
print(f"✅ Template updated: {TEMPLATE}")
print(f"  Page: A4, margins 2/2/3/2cm")
print(f"  Body: {FONT_NAME} 13pt (ALL styles via XML rFonts)")
print(f"  Code: {CODE_FONT} 10pt + gray box + border + LEFT align")
print(f"  Headings: {FONT_NAME} + LEFT align")
print(f"  Body: JUSTIFY align, 1.3x line spacing")
