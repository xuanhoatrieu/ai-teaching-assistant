# PPTX Generator Service - Python FastAPI + Headless LibreOffice Slide Renderer
FROM python:3.11-slim

WORKDIR /app

# Install headless LibreOffice Impress, Poppler (pdftoppm), and Unicode/Vietnamese/IPA fonts
# for 100% faithful 16:9 slide rendering in SCORM & H5P exports
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    libreoffice-common \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 3002

# Run the service
CMD ["python", "main.py"]
