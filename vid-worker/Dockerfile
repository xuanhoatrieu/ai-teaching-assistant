FROM python:3.12-slim

# System dependencies for ManimGL, Playwright, FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    libgl1-mesa-glx \
    libegl1-mesa \
    libgles2-mesa \
    libcairo2-dev \
    libpango1.0-dev \
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-latex-extra \
    fonts-noto-cjk \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ManimGL
RUN pip install --no-cache-dir manimlib

# Install Playwright browsers
RUN pip install playwright && playwright install chromium --with-deps

# Copy worker code
COPY . .

# Create tmp directory
RUN mkdir -p /app/tmp

# Resource limits hint
ENV PYTHONUNBUFFERED=1
ENV MANIM_DIR=/app

CMD ["python", "worker.py"]
