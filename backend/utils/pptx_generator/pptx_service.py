"""
PPTX Generator Service
Core logic for generating PowerPoint presentations using python-pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml
from lxml import etree
import os
import time
import tempfile
import shutil
from typing import List, Dict, Any, Optional


class PPTXGeneratorService:
    """
    Service for generating PPTX files from templates
    """
    
    def __init__(self, templates_dir: str = None):
        """Initialize with templates directory"""
        if templates_dir is None:
            self.templates_dir = os.path.join(os.path.dirname(__file__), 'templates')
        else:
            self.templates_dir = templates_dir
            
        # Ensure templates directory exists
        os.makedirs(self.templates_dir, exist_ok=True)
    
    def get_available_templates(self) -> List[Dict[str, str]]:
        """List available template files"""
        templates = []
        
        if os.path.exists(self.templates_dir):
            for filename in os.listdir(self.templates_dir):
                if filename.endswith('.pptx'):
                    templates.append({
                        'name': filename.replace('.pptx', ''),
                        'path': os.path.join(self.templates_dir, filename),
                        'filename': filename
                    })
        
        return templates
    
    def generate_presentation(
        self,
        template_path: str,
        lesson_title: str,
        slides: List[Dict[str, Any]],
        title_bg_path: Optional[str] = None,
        content_bg_path: Optional[str] = None
    ) -> str:
        """
        Generate a PPTX presentation from template and content
        Layout matches pptx_creator.py exactly
        
        Args:
            template_path: Path to template PPTX file, or 'blank' for new presentation
            lesson_title: Title of the lesson/presentation
            slides: List of slide content dictionaries
            title_bg_path: Path to background image for title slide
            content_bg_path: Path to background image for content slides
            
        Returns:
            Path to generated PPTX file
        """
        # Log background paths for debugging
        print(f"[PPTX] title_bg_path: {title_bg_path}")
        print(f"[PPTX] content_bg_path: {content_bg_path}")
        
        # Create presentation (from template or blank)
        if template_path and os.path.exists(template_path) and template_path != 'blank':
            prs = Presentation(template_path)
        else:
            # Create blank presentation - MATCH pptx_creator.py exactly
            prs = Presentation()
            prs.slide_width = Inches(10)      # Match pptx_creator.py line 51
            prs.slide_height = Inches(5.625)  # Match pptx_creator.py line 52
        
        # Clear existing slides if using template (keep layouts)
        while len(prs.slides) > 0:
            rId = prs.slides._sldIdLst[0].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[0]
        
        # Add slides following pptx_creator.py structure:
        # - Slide 0: Title slide
        # - Slide 1: Agenda/Objectives (2-column)
        # - Slide 2+: Content slides
        for i, slide_data in enumerate(slides):
            slide_type = slide_data.get('slideType', 'content')
            slide_index = slide_data.get('slideIndex', i)
            
            # Use layout 6 (blank) for ALL slides - match pptx_creator.py
            # Find true blank layout (no placeholders) to avoid "CLICK TO EDIT" text
            blank_layout = self._find_blank_layout(prs)
            slide = prs.slides.add_slide(blank_layout)
            
            # Clear any placeholder shapes that may exist from template layout
            self._clear_placeholders(slide)
            
            if slide_type == 'title' or slide_index == 0:
                self._add_title_slide(slide, slide_data, title_bg_path)
            elif slide_type in ['agenda', 'objectives'] or slide_index == 1:
                self._add_agenda_slide(slide, slide_data, content_bg_path)
            else:
                self._add_content_slide_v2(slide, slide_data, content_bg_path)
            
            # Add speaker notes
            speaker_note = slide_data.get('speakerNote', '')
            if speaker_note:
                self._add_speaker_notes(slide, speaker_note)
            
            # Add audio with auto-play
            audio_path = slide_data.get('audioPath')
            if audio_path and os.path.exists(audio_path):
                self._add_audio_with_autoplay(slide, audio_path)
            
            # Add extra / sample audio (clickable)
            extra_audio_path = slide_data.get('extraAudioPath')
            if extra_audio_path and os.path.exists(extra_audio_path):
                self._add_clickable_audio(slide, extra_audio_path)
        
        # Save to temp file
        output_path = tempfile.mktemp(suffix='.pptx')
        prs.save(output_path)
        
        return output_path

    def generate_presentation_stream(
        self,
        template_path: str,
        lesson_title: str,
        slides: List[Dict[str, Any]],
        title_bg_path: Optional[str] = None,
        content_bg_path: Optional[str] = None,
        output_path: Optional[str] = None
    ):
        """
        Generate PPTX presentation while yielding real-time progress events per slide.
        Yields dicts with step, index, total, message, and final outputPath.
        """
        total = len(slides)
        yield {
            "step": "init",
            "total": total,
            "message": "Đang chuẩn bị mẫu PowerPoint..."
        }

        # Create presentation (from template or blank)
        if template_path and os.path.exists(template_path) and template_path != 'blank':
            prs = Presentation(template_path)
        else:
            prs = Presentation()
            prs.slide_width = Inches(10)
            prs.slide_height = Inches(5.625)

        # Clear existing slides if using template
        while len(prs.slides) > 0:
            rId = prs.slides._sldIdLst[0].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[0]

        for i, slide_data in enumerate(slides):
            slide_type = slide_data.get('slideType', 'content')
            slide_index = slide_data.get('slideIndex', i + 1)
            title = slide_data.get('title', f"Slide {i + 1}")

            yield {
                "step": "slide",
                "index": i + 1,
                "total": total,
                "slideIndex": slide_index,
                "title": title,
                "message": f"Đang nhúng slide {i + 1}/{total}: {title[:30]}..."
            }

            blank_layout = self._find_blank_layout(prs)
            slide = prs.slides.add_slide(blank_layout)
            self._clear_placeholders(slide)

            if slide_type == 'title' or i == 0:
                self._add_title_slide(slide, slide_data, title_bg_path)
            elif slide_type in ['agenda', 'objectives'] or i == 1:
                self._add_agenda_slide(slide, slide_data, content_bg_path)
            else:
                self._add_content_slide_v2(slide, slide_data, content_bg_path)

            speaker_note = slide_data.get('speakerNote', '')
            if speaker_note:
                self._add_speaker_notes(slide, speaker_note)

            audio_path = slide_data.get('audioPath')
            if audio_path and os.path.exists(audio_path):
                self._add_audio_with_autoplay(slide, audio_path)

            extra_audio_path = slide_data.get('extraAudioPath')
            if extra_audio_path and os.path.exists(extra_audio_path):
                self._add_clickable_audio(slide, extra_audio_path)

            time.sleep(0.04)

        yield {
            "step": "saving",
            "total": total,
            "message": "Đang nén và hoàn tất file PowerPoint..."
        }

        if not output_path:
            output_path = tempfile.mktemp(suffix='.pptx')

        parent_dir = os.path.dirname(output_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        prs.save(output_path)

        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        yield {
            "step": "done",
            "total": total,
            "outputPath": output_path,
            "fileSize": file_size,
            "message": "Đã tạo xong file PowerPoint!"
        }
    
    def _find_blank_layout(self, prs: Presentation):
        """
        Find a truly blank layout (no placeholder shapes) from the presentation.
        Tries: layout 6 (standard blank), then searches for layout with no placeholders,
        finally falls back to last layout.
        """
        layouts = prs.slide_layouts
        
        # Try layout 6 first (standard blank in most templates)
        if len(layouts) > 6:
            layout_6 = layouts[6]
            # Check if it has placeholder shapes
            if len(list(layout_6.placeholders)) == 0:
                return layout_6
        
        # Search for a layout with no placeholders (truly blank)
        for layout in layouts:
            if len(list(layout.placeholders)) == 0:
                return layout
        
        # If no truly blank layout, find one with minimal placeholders
        min_placeholders = float('inf')
        best_layout = layouts[-1]
        for layout in layouts:
            num_ph = len(list(layout.placeholders))
            if num_ph < min_placeholders:
                min_placeholders = num_ph
                best_layout = layout
        
        return best_layout
    
    def _clear_placeholders(self, slide):
        """
        Remove all placeholder shapes from a slide.
        This prevents 'CLICK TO EDIT MASTER TITLE STYLE' text from appearing.
        Must iterate backward or collect shapes first because we're modifying the list.
        """
        # Collect all placeholder shapes first, then remove
        # Check for shapes with placeholder_format or specific text patterns
        shapes_to_remove = []
        
        for shape in slide.shapes:
            try:
                # Method 1: Check is_placeholder attribute
                if hasattr(shape, 'is_placeholder') and shape.is_placeholder:
                    shapes_to_remove.append(shape)
                    continue
                
                # Method 2: Check if shape has placeholder format
                if hasattr(shape, 'placeholder_format') and shape.placeholder_format is not None:
                    shapes_to_remove.append(shape)
                    continue
                    
                # Method 3: Check for placeholder-like text (CLICK TO EDIT, Click to add)
                if hasattr(shape, 'text_frame'):
                    text = shape.text_frame.text.lower() if shape.text_frame.text else ''
                    if 'click to' in text or 'master' in text:
                        shapes_to_remove.append(shape)
                        continue
            except Exception:
                # Skip shapes that cause errors when checking
                pass
        
        # Remove all identified placeholder shapes
        for shape in shapes_to_remove:
            try:
                sp = shape._element
                if sp.getparent() is not None:
                    sp.getparent().remove(sp)
                    print(f"[PPTX] Removed placeholder shape")
            except Exception as e:
                print(f"[PPTX] Could not remove placeholder: {e}")
    
    def _add_title_slide(self, slide, slide_data: Dict[str, Any], bg_path: Optional[str] = None):
        """
        Add Title Slide - matches pptx_creator.py lines 54-80
        Custom textbox for title/subtitle, white text on dark background
        """
        # Add background image if provided (MUST be added FIRST so it's behind text)
        if bg_path and os.path.exists(bg_path):
            try:
                # Fill entire slide with background image
                bg_pic = slide.shapes.add_picture(
                    bg_path,
                    Inches(0), Inches(0),
                    width=Inches(10), height=Inches(5.625)
                )
                # Send to back
                spTree = slide.shapes._spTree
                spTree.insert(2, bg_pic._element)  # Insert after shape tree start
                print(f"[PPTX] Title slide background added: {bg_path}")
            except Exception as e:
                print(f"[PPTX] Could not add title background: {e}")
        
        title = slide_data.get('title', '')
        content = slide_data.get('content', [])
        subtitle = content[0] if content else ''
        
        # Title textbox - centered at position (1, 2)
        title_shape = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1.5))
        tf = title_shape.text_frame
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Arial"
        p.font.size = Pt(44)
        p.font.bold = True
        p.font.color.rgb = RGBColor(255, 255, 255)  # White text
        p.alignment = PP_ALIGN.CENTER
        
        # Subtitle textbox
        if subtitle:
            subtitle_shape = slide.shapes.add_textbox(Inches(1), Inches(3.5), Inches(8), Inches(1))
            tf_sub = subtitle_shape.text_frame
            p_sub = tf_sub.paragraphs[0]
            p_sub.text = subtitle
            p_sub.font.name = "Arial"
            p_sub.font.size = Pt(22)
            p_sub.font.color.rgb = RGBColor(255, 255, 255)  # White text
            p_sub.alignment = PP_ALIGN.CENTER
    
    def _add_slide(
        self,
        prs: Presentation,
        layouts,
        slide_data: Dict[str, Any]
    ):
        """Add a single slide to the presentation"""
        
        slide_type = slide_data.get('slideType', 'content')
        title = slide_data.get('title', '')
        content = slide_data.get('content', [])
        bullets = slide_data.get('bullets')  # Structured bullets from AI
        image_path = slide_data.get('imagePath')
        audio_path = slide_data.get('audioPath')
        speaker_note = slide_data.get('speakerNote', '')
        slide_index = slide_data.get('slideIndex', 0)
        
        # Select appropriate layout
        layout_idx = self._get_layout_index(layouts, slide_type)
        slide_layout = layouts[layout_idx]
        
        # Add slide
        slide = prs.slides.add_slide(slide_layout)
        
        # Set title
        if slide.shapes.title:
            slide.shapes.title.text = title
        
        # Add content based on slide type
        if slide_type == 'title':
            self._add_title_slide_content(slide, title, content)
        elif slide_type in ['agenda', 'objectives'] or slide_index == 1:
            # Agenda/objectives slide with 2-column layout (matching pptx_creator.py)
            self._add_agenda_slide(slide, title, content, bullets)
        else:
            self._add_content_slide(slide, title, content, image_path, bullets)
        
        # Add speaker notes
        if speaker_note:
            self._add_speaker_notes(slide, speaker_note)
        
        # Add audio with auto-play
        if audio_path and os.path.exists(audio_path):
            self._add_audio_with_autoplay(slide, audio_path)

        # Add extra / sample audio (clickable)
        extra_audio_path = slide_data.get('extraAudioPath')
        if extra_audio_path and os.path.exists(extra_audio_path):
            self._add_clickable_audio(slide, extra_audio_path)
    
    def _add_agenda_slide(self, slide, slide_data: Dict[str, Any], bg_path: Optional[str] = None):
        """
        Add Agenda/Objectives slide with 2-column layout
        Matches pptx_creator.py lines 89-130
        """
        # Add background image if provided (MUST be added FIRST so it's behind text)
        if bg_path and os.path.exists(bg_path):
            try:
                bg_pic = slide.shapes.add_picture(
                    bg_path,
                    Inches(0), Inches(0),
                    width=Inches(10), height=Inches(5.625)
                )
                # Send to back
                spTree = slide.shapes._spTree
                spTree.insert(2, bg_pic._element)
                print(f"[PPTX] Agenda slide background added: {bg_path}")
            except Exception as e:
                print(f"[PPTX] Could not add agenda background: {e}")
        
        title = slide_data.get('title', 'Nội dung bài học')
        bullets = slide_data.get('bullets', [])
        content = slide_data.get('content', [])
        
        # Title textbox - white text at top
        title_shape = slide.shapes.add_textbox(Inches(0.5), Inches(0.2), Inches(9), Inches(0.8))
        p_title = title_shape.text_frame.paragraphs[0]
        p_title.text = title
        p_title.font.name = "Arial"
        p_title.font.size = Pt(28)
        p_title.font.color.rgb = RGBColor(255, 255, 255)  # White text
        p_title.alignment = PP_ALIGN.CENTER
        
        # Use bullets if available, else fallback to content
        items = []
        if bullets:
            items = [f"{b.get('emoji', '')} {b.get('point', '') or b.get('description', '')}" for b in bullets]
        elif content:
            items = content if isinstance(content, list) else [content]
        
        if not items:
            return
        
        # Check if image exists
        image_path = slide_data.get('imagePath')
        has_image = image_path and os.path.exists(image_path)
        
        # Content on LEFT side (like content slides)
        # Image 1:1 (4.5\" x 4.5\") at position 5.2\", so content width = 4.5\"
        content_width = Inches(4.5) if has_image else Inches(9)
        content_col = slide.shapes.add_textbox(Inches(0.5), Inches(1.2), content_width, Inches(4.0))
        tf_content = content_col.text_frame
        tf_content.clear()
        tf_content.word_wrap = True
        
        for item in items:
            p = tf_content.add_paragraph()
            p.text = f"• {item}" if not item.startswith('•') else item
            p.font.name = "Arial"
            p.font.size = Pt(22)
            p.font.color.rgb = RGBColor(58, 102, 77)
            p.space_after = Pt(12)
        
        # Add image on RIGHT if exists - 1:1 square ratio (4.5\" x 4.5\")
        if has_image:
            try:
                # Image starts right after title (Y=1.0\")
                slide.shapes.add_picture(image_path, Inches(5.2), Inches(1.0), height=Inches(4.5))
                print(f"[PPTX] Agenda slide image added: {image_path}")
            except Exception as e:
                print(f"[PPTX] Could not add agenda image: {e}")
    
    def _populate_bullets_or_content(self, text_frame, bullets, content, title_pt=20, desc_pt=16):
        """Helper to render formatted bullets or fallback string content into a text frame"""
        text_frame.clear()
        text_frame.word_wrap = True
        
        if bullets:
            for bullet in bullets:
                emoji = bullet.get('emoji', '')
                point = bullet.get('point', '')
                description = bullet.get('description', '')
                
                if point:
                    p_point = text_frame.add_paragraph()
                    p_point.text = f"{emoji} {point}".strip()
                    p_point.font.name = "Arial"
                    p_point.font.bold = True
                    p_point.font.size = Pt(title_pt)
                    p_point.font.color.rgb = RGBColor(26, 77, 46)
                    p_point.space_after = Pt(2)
                    
                    if description:
                        p_desc = text_frame.add_paragraph()
                        p_desc.text = description
                        p_desc.font.name = "Arial"
                        p_desc.font.size = Pt(desc_pt)
                        p_desc.font.color.rgb = RGBColor(50, 60, 55)
                        p_desc.space_before = Pt(0)
                        p_desc.space_after = Pt(6)
                        p_desc.level = 1
                else:
                    p_point = text_frame.add_paragraph()
                    p_point.text = description
                    p_point.font.name = "Arial"
                    p_point.font.size = Pt(desc_pt)
                    p_point.font.color.rgb = RGBColor(50, 60, 55)
                    p_point.space_after = Pt(6)
        elif content:
            for item in content:
                p = text_frame.add_paragraph()
                p.text = f"• {item}" if not item.startswith('•') else item
                p.font.name = "Arial"
                p.font.size = Pt(desc_pt)
                p.font.color.rgb = RGBColor(50, 60, 55)
                p.space_after = Pt(6)

    def _render_layout_split_standard(self, slide, title, bullets, content, image_path, has_image):
        """1. Split Standard: Text trái 4.5\", Image phải 4.5\""""
        if has_image:
            content_shape = slide.shapes.add_textbox(Inches(0.5), Inches(1.2), Inches(4.5), Inches(4.0))
        else:
            content_shape = slide.shapes.add_textbox(Inches(0.5), Inches(1.2), Inches(9.0), Inches(4.0))
        self._populate_bullets_or_content(content_shape.text_frame, bullets, content, title_pt=21, desc_pt=17)
        if has_image:
            try:
                slide.shapes.add_picture(image_path, Inches(5.2), Inches(1.0), height=Inches(4.5))
            except Exception as e:
                print(f"[PPTX] Could not add picture {image_path}: {e}")

    def _render_layout_split_reversed(self, slide, title, bullets, content, image_path, has_image):
        """2. Split Reversed: Image trái 4.5\", Text phải 4.5\""""
        if has_image:
            try:
                slide.shapes.add_picture(image_path, Inches(0.5), Inches(1.0), height=Inches(4.5))
            except Exception as e:
                print(f"[PPTX] Could not add picture {image_path}: {e}")
            content_shape = slide.shapes.add_textbox(Inches(5.2), Inches(1.2), Inches(4.5), Inches(4.0))
        else:
            content_shape = slide.shapes.add_textbox(Inches(0.5), Inches(1.2), Inches(9.0), Inches(4.0))
        self._populate_bullets_or_content(content_shape.text_frame, bullets, content, title_pt=21, desc_pt=17)

    def _render_layout_comparison_3col(self, slide, title, bullets, content, image_path, has_image):
        """3. Comparison 3-Column: 3 Bento Cards song song"""
        col_lefts = [Inches(0.5), Inches(3.6), Inches(6.7)]
        col_w = Inches(2.8)
        col_h = Inches(4.0)
        col_y = Inches(1.2)
        
        # Prepare 3 data items
        items = []
        if bullets and len(bullets) >= 3:
            items = bullets[:3]
        elif content and len(content) >= 3:
            for c in content[:3]:
                parts = c.split(':', 1) if ':' in c else [c, '']
                items.append({'emoji': '📌', 'point': parts[0].replace('•', '').strip(), 'description': parts[1].strip()})
        else:
            # Fallback spread
            src = bullets if bullets else [{'point': c, 'description': ''} for c in content]
            for i in range(3):
                items.append(src[i % len(src)] if src else {'point': f'Mục {i+1}', 'description': ''})
                
        for idx, item in enumerate(items[:3]):
            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_lefts[idx], col_y, col_w, col_h)
            card.fill.solid()
            card.fill.fore_color.rgb = RGBColor(247, 250, 248)
            card.line.color.rgb = RGBColor(185, 215, 198)
            card.line.width = Pt(1.5)
            
            tf = card.text_frame
            tf.word_wrap = True
            tf.margin_left = Inches(0.2)
            tf.margin_right = Inches(0.2)
            tf.margin_top = Inches(0.25)
            
            p_head = tf.paragraphs[0]
            emoji = item.get('emoji', '📌')
            point = item.get('point', f'Cột {idx+1}')
            p_head.text = f"{emoji} {point}".strip()
            p_head.font.name = "Arial"
            p_head.font.bold = True
            p_head.font.size = Pt(17)
            p_head.font.color.rgb = RGBColor(26, 77, 46)
            p_head.space_after = Pt(8)
            
            p_body = tf.add_paragraph()
            p_body.text = item.get('description', '')
            p_body.font.name = "Arial"
            p_body.font.size = Pt(13)
            p_body.font.color.rgb = RGBColor(50, 60, 55)

    def _render_layout_hero_infographic(self, slide, title, bullets, content, image_path, has_image):
        """4. Hero Infographic: Visual/Hero lớn trên, 3 thẻ takeaways dưới"""
        if has_image:
            try:
                slide.shapes.add_picture(image_path, Inches(2.2), Inches(1.1), height=Inches(2.3))
            except Exception as e:
                print(f"[PPTX] Hero infographic picture failed: {e}")
        else:
            hero_box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(1.1), Inches(9.0), Inches(2.3))
            hero_box.fill.solid()
            hero_box.fill.fore_color.rgb = RGBColor(238, 246, 241)
            hero_box.line.color.rgb = RGBColor(140, 195, 160)
            hero_box.line.width = Pt(1.5)
            tf = hero_box.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            first_text = bullets[0].get('description') if bullets else (content[0] if content else title)
            p.text = f"💡 {first_text}"
            p.font.name = "Arial"
            p.font.bold = True
            p.font.size = Pt(19)
            p.font.color.rgb = RGBColor(26, 77, 46)
            p.alignment = PP_ALIGN.CENTER
            
        # Bottom 3 takeaway cards
        col_lefts = [Inches(0.5), Inches(3.6), Inches(6.7)]
        col_w = Inches(2.8)
        takeaway_items = (bullets[1:4] if bullets and len(bullets) > 1 else bullets[:3]) or [{'point': c, 'description': ''} for c in content[:3]]
        while len(takeaway_items) < 3:
            takeaway_items.append({'point': f'Điểm nhấn {len(takeaway_items)+1}', 'description': 'Tóm tắt bài học'})
            
        for idx, item in enumerate(takeaway_items[:3]):
            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_lefts[idx], Inches(3.6), col_w, Inches(1.6))
            card.fill.solid()
            card.fill.fore_color.rgb = RGBColor(255, 255, 255)
            card.line.color.rgb = RGBColor(190, 215, 202)
            card.line.width = Pt(1.2)
            tf = card.text_frame
            tf.word_wrap = True
            tf.margin_left = Inches(0.15)
            tf.margin_right = Inches(0.15)
            tf.margin_top = Inches(0.15)
            
            p_head = tf.paragraphs[0]
            p_head.text = f"✅ {item.get('point', '')}".strip()
            p_head.font.name = "Arial"
            p_head.font.bold = True
            p_head.font.size = Pt(14)
            p_head.font.color.rgb = RGBColor(26, 77, 46)
            
            if item.get('description'):
                p_body = tf.add_paragraph()
                p_body.text = item.get('description', '')
                p_body.font.name = "Arial"
                p_body.font.size = Pt(11)
                p_body.font.color.rgb = RGBColor(70, 80, 75)

    def _render_layout_process_steps(self, slide, title, bullets, content, image_path, has_image):
        """5. Process Steps: Timeline các bước (Node tròn số) + Visual phải"""
        items = bullets if bullets else [{'point': c, 'description': ''} for c in content]
        step_items = items[:4] if items else [{'point': 'Bước 1', 'description': ''}]
        
        # Left timeline
        y_start = 1.2
        step_gap = 0.95
        for k, item in enumerate(step_items):
            cur_y = y_start + (k * step_gap)
            # Oval number circle
            circle = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.5), Inches(cur_y), Inches(0.42), Inches(0.42))
            circle.fill.solid()
            circle.fill.fore_color.rgb = RGBColor(26, 120, 70)
            circle.line.fill.background()
            p_num = circle.text_frame.paragraphs[0]
            p_num.text = str(k + 1)
            p_num.font.name = "Arial"
            p_num.font.bold = True
            p_num.font.size = Pt(13)
            p_num.font.color.rgb = RGBColor(255, 255, 255)
            p_num.alignment = PP_ALIGN.CENTER
            
            # Step card textbox
            step_box = slide.shapes.add_textbox(Inches(1.02), Inches(cur_y - 0.05), Inches(3.9), Inches(0.85))
            tf = step_box.text_frame
            tf.word_wrap = True
            p_title = tf.paragraphs[0]
            emoji = item.get('emoji', '')
            point = item.get('point', f'Bước {k+1}')
            p_title.text = f"{emoji} {point}".strip()
            p_title.font.name = "Arial"
            p_title.font.bold = True
            p_title.font.size = Pt(15)
            p_title.font.color.rgb = RGBColor(26, 77, 46)
            
            if item.get('description'):
                p_desc = tf.add_paragraph()
                p_desc.text = item.get('description', '')
                p_desc.font.name = "Arial"
                p_desc.font.size = Pt(12)
                p_desc.font.color.rgb = RGBColor(60, 70, 65)

        # Right side: Visual or summary box
        if has_image:
            try:
                slide.shapes.add_picture(image_path, Inches(5.2), Inches(1.0), height=Inches(4.4))
            except Exception as e:
                print(f"[PPTX] Process steps image failed: {e}")
        else:
            sum_card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(5.2), Inches(1.2), Inches(4.3), Inches(3.9))
            sum_card.fill.solid()
            sum_card.fill.fore_color.rgb = RGBColor(245, 249, 246)
            sum_card.line.color.rgb = RGBColor(180, 210, 195)
            tf_s = sum_card.text_frame
            tf_s.word_wrap = True
            tf_s.margin_left = Inches(0.2)
            tf_s.margin_right = Inches(0.2)
            tf_s.margin_top = Inches(0.3)
            p = tf_s.paragraphs[0]
            p.text = "🎯 Mục tiêu & Kết quả quy trình"
            p.font.name = "Arial"
            p.font.bold = True
            p.font.size = Pt(17)
            p.font.color.rgb = RGBColor(26, 77, 46)
            p.space_after = Pt(10)
            p2 = tf_s.add_paragraph()
            p2.text = "Tuân thủ chặt chẽ từng bước trên giúp tối ưu hóa hiệu quả thực hành và hiểu sâu bản chất kiến thức."
            p2.font.name = "Arial"
            p2.font.size = Pt(14)
            p2.font.color.rgb = RGBColor(60, 70, 65)

    def _render_layout_audio_lab(self, slide, title, bullets, content, image_path, has_image, slide_data):
        """6. Audio Lab: Header badge + Transcript / Lời thoại trái + Visual / Tasks phải"""
        banner = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(1.05), Inches(9.0), Inches(0.5))
        banner.fill.solid()
        banner.fill.fore_color.rgb = RGBColor(230, 245, 235)
        banner.line.color.rgb = RGBColor(70, 160, 100)
        banner.line.width = Pt(1.2)
        p_b = banner.text_frame.paragraphs[0]
        p_b.text = "🎧 PHÒNG THỰC HÀNH NGHE & PHÁT ÂM (AUDIO LAB)"
        p_b.font.name = "Arial"
        p_b.font.bold = True
        p_b.font.size = Pt(14)
        p_b.font.color.rgb = RGBColor(26, 77, 46)
        p_b.alignment = PP_ALIGN.CENTER
        
        # Left: Dialogue & Transcript card
        card_w = Inches(4.5) if has_image else Inches(9.0)
        dialogue_card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(1.7), card_w, Inches(3.5))
        dialogue_card.fill.solid()
        dialogue_card.fill.fore_color.rgb = RGBColor(255, 255, 255)
        dialogue_card.line.color.rgb = RGBColor(190, 215, 202)
        dialogue_card.line.width = Pt(1.2)
        
        tf = dialogue_card.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.2)
        tf.margin_right = Inches(0.2)
        tf.margin_top = Inches(0.2)
        p_head = tf.paragraphs[0]
        p_head.text = "📝 Nội dung bài nghe / Transcript:"
        p_head.font.name = "Arial"
        p_head.font.bold = True
        p_head.font.size = Pt(15)
        p_head.font.color.rgb = RGBColor(26, 77, 46)
        p_head.space_after = Pt(8)
        
        self._populate_bullets_or_content(tf, bullets, content, title_pt=15, desc_pt=13)
        
        if has_image:
            try:
                slide.shapes.add_picture(image_path, Inches(5.2), Inches(1.7), height=Inches(3.5))
            except Exception as e:
                print(f"[PPTX] Audio lab picture failed: {e}")

    def _render_layout_checkpoint_gate(self, slide, title, bullets, content, image_path, has_image, slide_data):
        """7. Checkpoint Gate: Trạm kiểm soát kiến thức chặn bài"""
        banner = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(1.05), Inches(9.0), Inches(0.55))
        banner.fill.solid()
        banner.fill.fore_color.rgb = RGBColor(26, 77, 46)
        banner.line.fill.background()
        p_b = banner.text_frame.paragraphs[0]
        p_b.text = "🎯 TRẠM KIỂM SOÁT KIẾN THỨC (MASTERY CHECKPOINT)"
        p_b.font.name = "Arial"
        p_b.font.bold = True
        p_b.font.size = Pt(15)
        p_b.font.color.rgb = RGBColor(255, 255, 255)
        p_b.alignment = PP_ALIGN.CENTER
        
        quiz_card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(1.75), Inches(9.0), Inches(3.55))
        quiz_card.fill.solid()
        quiz_card.fill.fore_color.rgb = RGBColor(255, 255, 255)
        quiz_card.line.color.rgb = RGBColor(190, 215, 202)
        quiz_card.line.width = Pt(1.5)
        
        tf = quiz_card.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.25)
        tf.margin_right = Inches(0.25)
        tf.margin_top = Inches(0.2)
        
        # Check if interactiveData questions exist
        inter = slide_data.get('interactiveData') or {}
        questions = inter.get('questions', []) if isinstance(inter, dict) else []
        
        if questions:
            for q_idx, q in enumerate(questions[:2]):  # Display up to 2 questions cleanly in PPTX
                p_q = tf.paragraphs[0] if q_idx == 0 else tf.add_paragraph()
                q_text = q.get('question', f'Câu {q_idx+1}')
                p_q.text = f"Câu {q_idx+1}: {q_text}"
                p_q.font.name = "Arial"
                p_q.font.bold = True
                p_q.font.size = Pt(14)
                p_q.font.color.rgb = RGBColor(26, 77, 46)
                p_q.space_after = Pt(4)
                
                options = q.get('options', [])
                if options:
                    p_opt = tf.add_paragraph()
                    opt_labels = ['A', 'B', 'C', 'D', 'E']
                    opt_str = "    ".join([f"[{opt_labels[o_idx]}] {opt}" for o_idx, opt in enumerate(options[:4])])
                    p_opt.text = opt_str
                    p_opt.font.name = "Arial"
                    p_opt.font.size = Pt(12)
                    p_opt.font.color.rgb = RGBColor(60, 70, 65)
                    p_opt.space_after = Pt(8)
        else:
            self._populate_bullets_or_content(tf, bullets, content, title_pt=16, desc_pt=14)
            
        p_badge = tf.add_paragraph()
        p_badge.text = "⚠️ Yêu cầu chuẩn đạt: Hoàn thành đúng tối thiểu 4/5 câu hỏi để mở khóa bài học kế tiếp."
        p_badge.font.name = "Arial"
        p_badge.font.italic = True
        p_badge.font.size = Pt(11)
        p_badge.font.color.rgb = RGBColor(180, 100, 20)
        p_badge.space_before = Pt(8)

    def _add_content_slide_v2(self, slide, slide_data: Dict[str, Any], bg_path: Optional[str] = None):
        """
        Add content slide with Multi-Layout Engine (7 Pedagogical Layouts):
        - split_standard: Text trái, Image phải
        - split_reversed: Image trái, Text phải
        - comparison_3col: 3 Bento Cards song song
        - hero_infographic: Hero visual lớn trên, 3 takeaways dưới
        - process_steps: Timeline các bước (nodes tròn số) + Visual phải
        - audio_lab: Audio header + Transcript trái + Tasks phải
        - checkpoint_gate: Trạm kiểm soát kiến thức
        """
        if bg_path and os.path.exists(bg_path):
            try:
                bg_pic = slide.shapes.add_picture(
                    bg_path,
                    Inches(0), Inches(0),
                    width=Inches(10), height=Inches(5.625)
                )
                spTree = slide.shapes._spTree
                spTree.insert(2, bg_pic._element)
                print(f"[PPTX] Content slide background added: {bg_path}")
            except Exception as e:
                print(f"[PPTX] Could not add content background: {e}")
        
        title = slide_data.get('title', '')
        bullets = slide_data.get('bullets', [])
        content = slide_data.get('content', [])
        image_path = slide_data.get('imagePath')
        has_image = bool(image_path and os.path.exists(image_path))
        
        # Determine layout type
        layout_type = slide_data.get('layoutType', 'split_standard')
        if slide_data.get('isInteractive') or slide_data.get('slideType') == 'interactive':
            layout_type = 'checkpoint_gate'
            
        # Title textbox - white text at top
        title_shape = slide.shapes.add_textbox(Inches(0.5), Inches(0.2), Inches(9.0), Inches(0.8))
        p_title = title_shape.text_frame.paragraphs[0]
        p_title.text = title
        p_title.font.name = "Arial"
        p_title.font.size = Pt(28)
        p_title.font.color.rgb = RGBColor(255, 255, 255)
        p_title.alignment = PP_ALIGN.CENTER
        
        # Dispatch to layout renderers
        if layout_type == 'split_reversed':
            self._render_layout_split_reversed(slide, title, bullets, content, image_path, has_image)
        elif layout_type == 'comparison_3col':
            self._render_layout_comparison_3col(slide, title, bullets, content, image_path, has_image)
        elif layout_type == 'hero_infographic':
            self._render_layout_hero_infographic(slide, title, bullets, content, image_path, has_image)
        elif layout_type == 'process_steps':
            self._render_layout_process_steps(slide, title, bullets, content, image_path, has_image)
        elif layout_type == 'audio_lab':
            self._render_layout_audio_lab(slide, title, bullets, content, image_path, has_image, slide_data)
        elif layout_type == 'checkpoint_gate':
            self._render_layout_checkpoint_gate(slide, title, bullets, content, image_path, has_image, slide_data)
        else:  # default 'split_standard'
            self._render_layout_split_standard(slide, title, bullets, content, image_path, has_image)
    
    def _get_layout_index(self, layouts, slide_type: str) -> int:
        """Get appropriate layout index for slide type"""
        layout_map = {
            'title': 0,        # Title Slide
            'objectives': 1,   # Title and Content
            'content': 1,      # Title and Content
            'summary': 1,      # Title and Content
            'blank': 6,        # Blank
        }
        
        idx = layout_map.get(slide_type, 1)
        
        # Ensure index is valid
        if idx >= len(layouts):
            idx = min(1, len(layouts) - 1)
        
        return idx
    
    def _add_title_slide_content(
        self,
        slide,
        title: str,
        content: List[str]
    ):
        """Add content to title slide"""
        # Title is already set, add subtitle if content exists
        if content and len(content) > 0:
            for shape in slide.shapes:
                if hasattr(shape, 'text') and shape != slide.shapes.title:
                    if hasattr(shape, 'text_frame'):
                        shape.text = content[0]
                        break
    
    def _add_content_slide(
        self,
        slide,
        title: str,
        content: List[str],
        image_path: Optional[str],
        bullets: Optional[List[Dict[str, str]]] = None
    ):
        """
        Add content to regular content slide with proper layout.
        
        Format matches pptx_creator.py:
        - If bullet has point: Bold emoji+point (22pt), then description (18pt) on next line
        - If bullet has no point (definition/concept): Just description (20pt)
        """
        
        # Check image path and log for debugging
        has_image = False
        if image_path:
            if os.path.exists(image_path):
                has_image = True
                print(f"[PPTX] Image found: {image_path}")
            else:
                print(f"[PPTX] Image NOT found: {image_path}")
        
        # Find content placeholder or create text box
        content_placeholder = None
        for shape in slide.shapes:
            if shape.has_text_frame and shape != slide.shapes.title:
                content_placeholder = shape
                break
        
        # Create text frame for content (similar to pptx_creator.py)
        if content_placeholder:
            tf = content_placeholder.text_frame
            tf.clear()
            tf.word_wrap = True
        else:
            # Create text box if no placeholder
            left = Inches(0.5)
            top = Inches(1.2)  # Match pptx_creator.py
            
            if has_image:
                width = Inches(4.5)  # Make room for image on right
            else:
                width = Inches(9)  # Full width match pptx_creator.py
            
            height = Inches(4.0)
            
            txBox = slide.shapes.add_textbox(left, top, width, height)
            tf = txBox.text_frame
            tf.word_wrap = True
        
        # Use structured bullets if available, otherwise fallback to flat content
        if bullets:
            # Limit bullets to prevent overflow (max 5 for structured format)
            MAX_BULLETS = 5
            if len(bullets) > MAX_BULLETS:
                bullets = bullets[:MAX_BULLETS]
                print(f"Warning: Bullets truncated to {MAX_BULLETS}")
            
            first_para = True
            for bullet in bullets:
                emoji = bullet.get('emoji', '')
                point = bullet.get('point', '')
                description = bullet.get('description', '')
                
                if point:
                    # Format: Bold emoji+point, then description on next line
                    # (Matching pptx_creator.py lines 160-173)
                    p_point = tf.add_paragraph() if not first_para else tf.paragraphs[0]
                    p_point.text = f'{emoji} {point}' if emoji else point
                    p_point.font.name = "Arial"
                    p_point.font.bold = True
                    p_point.font.size = Pt(22)
                    p_point.font.color.rgb = RGBColor(58, 102, 77)  # Green color
                    p_point.space_after = Pt(2)
                    
                    if description:
                        p_desc = tf.add_paragraph()
                        p_desc.text = description
                        p_desc.font.name = "Arial"
                        p_desc.font.size = Pt(18)
                        p_desc.font.color.rgb = RGBColor(58, 102, 77)
                        p_desc.space_before = Pt(0)
                        p_desc.space_after = Pt(8)
                        p_desc.level = 1
                else:
                    # Golden Rule: Definition/concept - just show full description
                    # (Matching pptx_creator.py lines 174-177)
                    p_point = tf.add_paragraph() if not first_para else tf.paragraphs[0]
                    p_point.text = description
                    p_point.font.name = "Arial"
                    p_point.font.size = Pt(20)
                    p_point.font.color.rgb = RGBColor(58, 102, 77)
                    p_point.space_after = Pt(8)
                
                first_para = False
        
        elif content:
            # Fallback: flat content array
            MAX_BULLETS = 6
            if len(content) > MAX_BULLETS:
                content = content[:MAX_BULLETS]
            
            # Calculate font size based on content length
            if len(content) <= 3:
                font_size = Pt(16)
            elif len(content) <= 5:
                font_size = Pt(14)
            else:
                font_size = Pt(12)
            
            for i, item in enumerate(content):
                if i == 0:
                    p = tf.paragraphs[0]
                else:
                    p = tf.add_paragraph()
                
                p.text = f"• {item}"
                p.font.name = "Arial"
                p.font.size = font_size
                p.font.color.rgb = RGBColor(58, 102, 77)
                p.space_after = Pt(6)
        
        # Add image if exists
        if has_image:
            self._add_image(slide, image_path, has_content=bool(content or bullets))
    
    def _add_image(self, slide, image_path: str, has_content: bool = False):
        """Add image to slide"""
        try:
            if has_content:
                # Image on right side
                left = Inches(7)
                top = Inches(1.5)
                width = Inches(5.5)
            else:
                # Image centered
                left = Inches(1.5)
                top = Inches(1.5)
                width = Inches(10)
            
            slide.shapes.add_picture(image_path, left, top, width=width)
        except Exception as e:
            print(f"Warning: Could not add image: {e}")
    
    def _add_speaker_notes(self, slide, notes: str):
        """Add speaker notes to slide"""
        notes_slide = slide.notes_slide
        notes_slide.notes_text_frame.text = notes
    
    def _add_audio_with_autoplay(self, slide, audio_path: str):
        """
        Add audio to slide with auto-play on slide transition.
        Uses direct XML/relationship manipulation instead of add_movie()
        which is broken in python-pptx 1.0.x for audio files.
        """
        try:
            from pptx.opc.package import Part
            from pptx.opc.packuri import PackURI
            
            ext = os.path.splitext(audio_path)[1].lower()
            
            mime_map = {
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg',
                '.m4a': 'audio/mp4',
                '.wma': 'audio/x-ms-wma',
            }
            
            if ext not in mime_map:
                print(f"Warning: Unsupported audio format: {ext}")
                return
            
            content_type = mime_map[ext]
            
            # Read audio file
            with open(audio_path, 'rb') as f:
                audio_data = f.read()
            
            # Get slide index from its partname (e.g., /ppt/slides/slide3.xml → index 2)
            slide_part = slide.part
            slide_partname = str(slide_part.partname)  # e.g., '/ppt/slides/slide3.xml'
            import re
            match = re.search(r'slide(\d+)', slide_partname)
            slide_idx = int(match.group(1)) - 1 if match else 0
            
            # Collect ALL existing media partnames across the entire package to avoid duplicates
            existing_media = set()
            try:
                for part in slide_part.package.iter_parts():
                    existing_media.add(str(part.partname))
            except Exception:
                # Fallback: scan only this slide's relationships
                for rel in slide_part.rels.values():
                    if hasattr(rel, 'target_partname') and rel.target_partname:
                        existing_media.add(str(rel.target_partname))
            
            media_idx = 1
            while True:
                partname = f"/ppt/media/audio_s{slide_idx}_{media_idx}{ext}"
                if partname not in existing_media:
                    break
                media_idx += 1
            
            # Create the media part (arg order: partname, content_type, package, blob)
            audio_part = Part(
                PackURI(partname),
                content_type,
                slide_part.package,
                audio_data,
            )
            
            # Add relationship from slide to audio
            rId_audio = slide_part.relate_to(audio_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio')
            rId_media = slide_part.relate_to(audio_part, 'http://schemas.microsoft.com/office/2007/relationships/media')
            
            # Generate a unique shape ID
            max_id = 0
            for shape in slide.shapes:
                if shape.shape_id > max_id:
                    max_id = shape.shape_id
            shape_id = max_id + 1
            
            # Position: off-screen (hidden from students)
            left_emu = int(-0.6 * 914400)  # -0.6 inches in EMU
            top_emu = 0
            width_emu = int(0.4 * 914400)   # 0.4 inches
            height_emu = int(0.4 * 914400)
            
            # Create speaker icon image part for the audio frame visual
            icon_path = os.path.join(os.path.dirname(__file__), 'speaker_icon.png')
            if os.path.exists(icon_path):
                with open(icon_path, 'rb') as f:
                    icon_data = f.read()
                icon_partname = f"/ppt/media/speaker_s{slide_idx}{media_idx}.png"
                icon_part = Part(
                    PackURI(icon_partname),
                    'image/png',
                    slide_part.package,
                    icon_data,
                )
                rId_icon = slide_part.relate_to(icon_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image')
            else:
                rId_icon = ""
            
            # Build audio frame XML (p:pic with audioFile)
            audio_xml = f'''
            <p:pic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                   xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
                <p:nvPicPr>
                    <p:cNvPr id="{shape_id}" name="Audio {shape_id}">
                        <a:hlinkClick r:id="" action="ppaction://media"/>
                    </p:cNvPr>
                    <p:cNvPicPr>
                        <a:picLocks noChangeAspect="1"/>
                    </p:cNvPicPr>
                    <p:nvPr>
                        <a:audioFile r:link="{rId_audio}"/>
                        <p:extLst>
                            <p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}">
                                <p14:media r:embed="{rId_media}"/>
                            </p:ext>
                        </p:extLst>
                    </p:nvPr>
                </p:nvPicPr>
                <p:blipFill>
                    <a:blip r:embed="{rId_icon}"/>
                    <a:stretch>
                        <a:fillRect/>
                    </a:stretch>
                </p:blipFill>
                <p:spPr>
                    <a:xfrm>
                        <a:off x="{left_emu}" y="{top_emu}"/>
                        <a:ext cx="{width_emu}" cy="{height_emu}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect">
                        <a:avLst/>
                    </a:prstGeom>
                </p:spPr>
            </p:pic>
            '''
            
            # Parse and add audio element to slide
            audio_elem = etree.fromstring(audio_xml.strip().encode('utf-8'))
            slide._element.find(qn('p:cSld')).find(qn('p:spTree')).append(audio_elem)
            
            print(f"[PPTX] Audio injected (XML): slide {slide_idx} <- {audio_path}")
            
            # Set auto-play timing
            self._set_audio_autoplay_xml(slide, shape_id)
            
        except Exception as e:
            import traceback
            print(f"Warning: Could not add audio: {e}")
            traceback.print_exc()
    
    def _set_audio_autoplay_xml(self, slide, shape_id: int):
        """
        Set audio to auto-play when slide appears using XML timing
        """
        try:
            timing_xml = f'''
            <p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
                <p:tnLst>
                    <p:par>
                        <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
                            <p:childTnLst>
                                <p:seq concurrent="1" nextAc="seek">
                                    <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
                                        <p:childTnLst>
                                            <p:par>
                                                <p:cTn id="3" fill="hold">
                                                    <p:stCondLst>
                                                        <p:cond delay="0"/>
                                                    </p:stCondLst>
                                                    <p:childTnLst>
                                                        <p:par>
                                                            <p:cTn id="4" fill="hold">
                                                                <p:stCondLst>
                                                                    <p:cond delay="0"/>
                                                                </p:stCondLst>
                                                                <p:childTnLst>
                                                                    <p:par>
                                                                        <p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect">
                                                                            <p:stCondLst>
                                                                                <p:cond delay="0"/>
                                                                            </p:stCondLst>
                                                                            <p:childTnLst>
                                                                                <p:cmd type="call" cmd="playFrom(0.0)">
                                                                                    <p:cBhvr>
                                                                                        <p:cTn id="6" dur="1" fill="hold"/>
                                                                                        <p:tgtEl>
                                                                                            <p:spTgt spid="{shape_id}"/>
                                                                                        </p:tgtEl>
                                                                                    </p:cBhvr>
                                                                                </p:cmd>
                                                                            </p:childTnLst>
                                                                        </p:cTn>
                                                                    </p:par>
                                                                </p:childTnLst>
                                                            </p:cTn>
                                                        </p:par>
                                                    </p:childTnLst>
                                                </p:cTn>
                                            </p:par>
                                        </p:childTnLst>
                                    </p:cTn>
                                </p:seq>
                            </p:childTnLst>
                        </p:cTn>
                    </p:par>
                </p:tnLst>
            </p:timing>
            '''
            
            timing_elem = parse_xml(timing_xml)
            
            slide_elem = slide._element
            existing_timing = slide_elem.find(qn('p:timing'))
            
            if existing_timing is not None:
                slide_elem.remove(existing_timing)
            
            slide_elem.append(timing_elem)
            
        except Exception as e:
            print(f"Warning: Could not set auto-play for audio: {e}")

    def _add_clickable_audio(self, slide, audio_path: str):
        """
        Add extra / sample media audio to slide (e.g. English listening dialogue).
        Placed visibly as a clickable speaker icon button (no auto-play on slide transition).
        Clicking the icon during presentation plays/pauses the audio.
        """
        try:
            from pptx.opc.package import Part
            from pptx.opc.packuri import PackURI
            
            ext = os.path.splitext(audio_path)[1].lower()
            mime_map = {
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg',
                '.m4a': 'audio/mp4',
                '.ogg': 'audio/ogg',
                '.wma': 'audio/x-ms-wma',
            }
            if ext not in mime_map:
                print(f"Warning: Unsupported audio format: {ext}")
                return
            
            content_type = mime_map[ext]
            with open(audio_path, 'rb') as f:
                audio_data = f.read()
            
            slide_part = slide.part
            slide_partname = str(slide_part.partname)
            import re
            match = re.search(r'slide(\d+)', slide_partname)
            slide_idx = int(match.group(1)) - 1 if match else 0
            
            existing_media = set()
            try:
                for part in slide_part.package.iter_parts():
                    existing_media.add(str(part.partname))
            except Exception:
                for rel in slide_part.rels.values():
                    if hasattr(rel, 'target_partname') and rel.target_partname:
                        existing_media.add(str(rel.target_partname))
            
            media_idx = 1
            while True:
                partname = f"/ppt/media/extra_audio_s{slide_idx}_{media_idx}{ext}"
                if partname not in existing_media:
                    break
                media_idx += 1
            
            audio_part = Part(
                PackURI(partname),
                content_type,
                slide_part.package,
                audio_data,
            )
            
            rId_audio = slide_part.relate_to(audio_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio')
            rId_media = slide_part.relate_to(audio_part, 'http://schemas.microsoft.com/office/2007/relationships/media')
            
            max_id = 0
            for shape in slide.shapes:
                if shape.shape_id > max_id:
                    max_id = shape.shape_id
            shape_id = max_id + 1
            
            # Position: visible near top right
            left_emu = int(12.0 * 914400)
            top_emu = int(0.6 * 914400)
            width_emu = int(0.6 * 914400)
            height_emu = int(0.6 * 914400)
            
            icon_path = os.path.join(os.path.dirname(__file__), 'speaker_icon.png')
            if os.path.exists(icon_path):
                with open(icon_path, 'rb') as f:
                    icon_data = f.read()
                icon_partname = f"/ppt/media/extra_speaker_s{slide_idx}{media_idx}.png"
                icon_part = Part(
                    PackURI(icon_partname),
                    'image/png',
                    slide_part.package,
                    icon_data,
                )
                rId_icon = slide_part.relate_to(icon_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image')
            else:
                rId_icon = ""
            
            audio_xml = f'''
            <p:pic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                   xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
                <p:nvPicPr>
                    <p:cNvPr id="{shape_id}" name="ExtraAudio {shape_id}">
                        <a:hlinkClick r:id="" action="ppaction://media"/>
                    </p:cNvPr>
                    <p:cNvPicPr>
                        <a:picLocks noChangeAspect="1"/>
                    </p:cNvPicPr>
                    <p:nvPr>
                        <a:audioFile r:link="{rId_audio}"/>
                        <p:extLst>
                            <p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}">
                                <p14:media r:embed="{rId_media}"/>
                            </p:ext>
                        </p:extLst>
                    </p:nvPr>
                </p:nvPicPr>
                <p:blipFill>
                    <a:blip r:embed="{rId_icon}"/>
                    <a:stretch>
                        <a:fillRect/>
                    </a:stretch>
                </p:blipFill>
                <p:spPr>
                    <a:xfrm>
                        <a:off x="{left_emu}" y="{top_emu}"/>
                        <a:ext cx="{width_emu}" cy="{height_emu}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect">
                        <a:avLst/>
                    </a:prstGeom>
                </p:spPr>
            </p:pic>
            '''
            audio_elem = etree.fromstring(audio_xml.strip().encode('utf-8'))
            slide._element.find(qn('p:cSld')).find(qn('p:spTree')).append(audio_elem)
            print(f"[PPTX] Clickable extra audio injected (XML): slide {slide_idx} <- {audio_path}")
        except Exception as e:
            import traceback
            print(f"Warning: Could not add extra audio: {e}")
            traceback.print_exc()


# Standalone test
if __name__ == "__main__":
    service = PPTXGeneratorService()
    
    # Test data
    test_slides = [
        {
            "slideIndex": 0,
            "slideType": "title",
            "title": "Bài 01: Giới thiệu Python",
            "content": ["Khóa học lập trình cơ bản"],
            "speakerNote": "Chào mừng các bạn đến với bài học đầu tiên."
        },
        {
            "slideIndex": 1,
            "slideType": "objectives",
            "title": "Mục tiêu bài học",
            "content": [
                "Hiểu Python là gì",
                "Cài đặt Python và IDE",
                "Viết chương trình Hello World"
            ],
            "speakerNote": "Sau bài học này, các bạn sẽ biết cách cài đặt và chạy Python."
        },
        {
            "slideIndex": 2,
            "slideType": "content",
            "title": "Python là gì?",
            "content": [
                "Ngôn ngữ lập trình bậc cao",
                "Dễ đọc, dễ học",
                "Phổ biến trong AI, Data Science, Web"
            ],
            "speakerNote": "Python được tạo ra bởi Guido van Rossum năm 1991."
        }
    ]
    
    output = service.generate_presentation(
        template_path='blank',
        lesson_title='Test Presentation',
        slides=test_slides
    )
    
    print(f"Generated: {output}")
