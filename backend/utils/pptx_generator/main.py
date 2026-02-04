"""
PPTX Generator Service
FastAPI server for generating PowerPoint presentations from templates
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import tempfile
import os

from pptx_service import PPTXGeneratorService

app = FastAPI(
    title="PPTX Generator Service",
    description="Generate PowerPoint presentations from templates with content, images, and audio",
    version="1.0.0"
)

# CORS for NestJS backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize service
pptx_service = PPTXGeneratorService()


class SlideContent(BaseModel):
    slideIndex: int
    title: str
    content: List[str] = []
    bullets: Optional[List[dict]] = None  # Structured bullets from AI
    imagePath: Optional[str] = None
    audioPath: Optional[str] = None
    speakerNote: Optional[str] = None
    slideType: Optional[str] = "content"


class GeneratePPTXRequest(BaseModel):
    templatePath: str
    lessonTitle: str
    slides: List[SlideContent]
    titleBgPath: Optional[str] = None     # Background image for title slide
    contentBgPath: Optional[str] = None   # Background image for content slides


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "service": "pptx-generator"}


@app.get("/templates")
async def list_templates():
    """List available system templates"""
    templates = pptx_service.get_available_templates()
    return {"templates": templates}


@app.post("/generate")
async def generate_pptx(request: GeneratePPTXRequest):
    """
    Generate a PPTX file from template and content
    Returns the generated PPTX file
    """
    try:
        # Generate PPTX
        output_path = pptx_service.generate_presentation(
            template_path=request.templatePath,
            lesson_title=request.lessonTitle,
            slides=[s.model_dump() for s in request.slides],
            title_bg_path=request.titleBgPath,
            content_bg_path=request.contentBgPath
        )
        
        # Return the file
        return FileResponse(
            path=output_path,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{request.lessonTitle}.pptx"
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate PPTX: {str(e)}")


@app.post("/generate-buffer")
async def generate_pptx_buffer(request: GeneratePPTXRequest):
    """
    Generate a PPTX file and return as base64 buffer
    Alternative to /generate for easier integration
    """
    import base64
    
    try:
        output_path = pptx_service.generate_presentation(
            template_path=request.templatePath,
            lesson_title=request.lessonTitle,
            slides=[s.model_dump() for s in request.slides],
            title_bg_path=request.titleBgPath,
            content_bg_path=request.contentBgPath
        )
        
        with open(output_path, 'rb') as f:
            buffer = base64.b64encode(f.read()).decode('utf-8')
        
        # Cleanup temp file
        os.unlink(output_path)
        
        return {
            "buffer": buffer,
            "filename": f"{request.lessonTitle}.pptx"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate PPTX: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)
