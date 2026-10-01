/**
 * SCORM 1.2 Package Generator for AI Teaching Assistant
 * 
 * Generates an ADL SCORM 1.2 compliant ZIP package ready for Moodle LMS.
 * Includes:
 * - imsmanifest.xml (SCORM 1.2 manifest)
 * - index.html (Modern responsive HTML5 interactive player with narration autoplay, sample audio player, interactive quiz engine, and LMS communication)
 */

import * as fs from 'fs';
import * as path from 'path';

const archiver = require('archiver');

function escapeXml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function resolveLocalMediaFile(publicUrl: string): string | null {
    if (!publicUrl) return null;
    const cleanUrl = publicUrl.split('?')[0];

    // Handle /uploads/... path
    if (cleanUrl.startsWith('/uploads')) {
        const p = path.join(process.cwd(), cleanUrl);
        if (fs.existsSync(p)) return p;
    }

    // Handle /files/public/{userId}/{lessonId}/images/{filename}
    const publicMatch = cleanUrl.match(/^\/files\/public\/([^/]+)\/([^/]+)\/images\/(.+)$/);
    if (publicMatch) {
        const [, userId, lessonId, filename] = publicMatch;
        const p = path.join(process.cwd(), 'datauser', userId, 'lessons', lessonId, 'images', filename);
        if (fs.existsSync(p)) return p;
    }

    // Handle /files/{userId}/{lessonId}/audio/{filename}
    const authMatch = cleanUrl.match(/^\/files\/([^/]+)\/([^/]+)\/audio\/(.+)$/);
    if (authMatch) {
        const [, userId, lessonId, filename] = authMatch;
        const p = path.join(process.cwd(), 'datauser', userId, 'lessons', lessonId, 'audio', filename);
        if (fs.existsSync(p)) return p;
    }

    // Handle /templates/...
    if (cleanUrl.startsWith('/templates')) {
        const p = path.join(process.cwd(), 'public', cleanUrl);
        if (fs.existsSync(p)) return p;
    }

    // Fallback: absolute path
    if (path.isAbsolute(cleanUrl) && fs.existsSync(cleanUrl)) {
        return cleanUrl;
    }

    return null;
}

export function generateScormManifest(lessonId: string, lessonTitle: string, assetFiles: string[] = ['index.html']): string {
    const safeTitle = escapeXml(lessonTitle || 'Bài giảng tương tác');
    const safeId = lessonId.replace(/[^a-zA-Z0-9_-]/g, '_');

    const fileEntries = assetFiles.map(f => `      <file href="${escapeXml(f)}" />`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_${safeId}" version="1.3"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_DEFAULT">
    <organization identifier="ORG_DEFAULT">
      <title>${safeTitle}</title>
      <item identifier="ITEM_${safeId}" identifierref="RES_${safeId}">
        <title>${safeTitle}</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_${safeId}" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileEntries}
    </resource>
  </resources>
</manifest>`;
}

export function generateScormPlayerHtml(lessonTitle: string, slides: any[]): string {
    const slidesJson = JSON.stringify(slides.map(s => {
        let bullets: any[] = [];
        if (Array.isArray(s.bullets)) {
            bullets = s.bullets;
        } else if (s.optimizedContentJson) {
            try {
                const opt = typeof s.optimizedContentJson === 'string' ? JSON.parse(s.optimizedContentJson) : s.optimizedContentJson;
                if (Array.isArray(opt.bullets)) bullets = opt.bullets;
                else if (Array.isArray(opt)) bullets = opt;
            } catch (e) {}
        }
        if (bullets.length === 0 && s.content) {
            const lines = Array.isArray(s.content) ? s.content : (typeof s.content === 'string' ? s.content.split('\n') : []);
            bullets = lines.filter((l: any) => typeof l === 'string' && l.trim()).map((l: string) => ({
                emoji: '📌',
                point: l.replace(/^[-*•]\s*/, '').trim(),
                description: '',
            }));
        }

        let interaction: any = null;
        if (s.interactiveData) {
            try {
                interaction = typeof s.interactiveData === 'string' ? JSON.parse(s.interactiveData) : s.interactiveData;
            } catch (e) {}
        }

        const isCheckpoint = s.slideType === 'checkpoint_quiz' || (interaction && (interaction.activityType === 'checkpoint_quiz' || interaction.isCheckpoint === true));
        const questionsCount = (interaction && Array.isArray(interaction.questions)) ? interaction.questions.length : 0;
        const passScore = (interaction && interaction.passScore !== undefined)
            ? Number(interaction.passScore)
            : (isCheckpoint ? Math.max(1, Math.min(questionsCount, 4)) : 0);
        const fallbackSlideIndex = (interaction && interaction.fallbackSlideIndex !== undefined)
            ? Number(interaction.fallbackSlideIndex)
            : Math.max(1, s.slideIndex - 1);
        const hideSolutions = isCheckpoint || (interaction && interaction.hideSolutions === true);

        const layoutType = s.layoutType || (isCheckpoint ? 'checkpoint_gate' : (s.extraAudioUrl ? 'audio_lab' : 'split_standard'));

        return {
            slideIndex: s.slideIndex,
            slideType: s.slideType || 'content',
            layoutType,
            title: s.title || `Slide ${s.slideIndex}`,
            bullets,
            speakerNote: s.speakerNote || '',
            imageUrl: s.imageUrl || '',
            audioUrl: s.audioUrl || '',
            extraAudioUrl: s.extraAudioUrl || '',
            extraAudioName: s.extraAudioName || '',
            interaction,
            isCheckpoint,
            passScore,
            fallbackSlideIndex,
            allowContinueWithoutPass: interaction?.allowContinueWithoutPass === true,
            hideSolutions,
        };
    }));

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(lessonTitle)} - Bài giảng Tương tác SCORM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #4f46e5;
      --primary-light: #e0e7ff;
      --primary-dark: #3730a3;
      --success: #10b981;
      --success-light: #d1fae5;
      --danger: #ef4444;
      --danger-light: #fee2e2;
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text-main: #f8fafc;
      --text-sub: #94a3b8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header Bar */
    header {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .header-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .score-badge {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .autoplay-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text-sub);
      cursor: pointer;
    }
    .autoplay-toggle input { cursor: pointer; accent-color: var(--primary); }

    /* Progress bar */
    .progress-track {
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      width: 100%;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #10b981);
      width: 0%;
      transition: width 0.3s ease;
    }

    /* Main Container */
    main {
      flex: 1;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Slide Card */
    .slide-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      gap: 24px;
      min-height: 520px;
    }

    .slide-top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 14px;
      gap: 16px;
    }
    .slide-title {
      font-size: 1.45rem;
      font-weight: 700;
      color: #fff;
      margin: 0;
      line-height: 1.3;
    }
    .speaker-btn {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      color: #a5b4fc;
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .speaker-btn:hover {
      background: rgba(99, 102, 241, 0.25);
      color: #fff;
      border-color: rgba(99, 102, 241, 0.6);
    }
    .speaker-btn.playing {
      background: rgba(16, 185, 129, 0.2);
      border-color: rgba(16, 185, 129, 0.5);
      color: #6ee7b7;
      animation: pulse-glow 2s infinite;
    }
    @keyframes pulse-glow {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
      70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    /* Grid Layout: Left Content, Right Image */
    .slide-content-grid {
      display: grid;
      grid-template-columns: 1.3fr 0.9fr;
      gap: 28px;
      align-items: start;
    }
    .slide-content-grid.single-media {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .slide-content-grid.single-media .slide-media-box {
      max-width: 960px;
      width: 100%;
    }
    @media (max-width: 860px) {
      .slide-content-grid { grid-template-columns: 1fr; }
    }

    /* Layout: Split Reversed (Left Media, Right Content) */
    .slide-content-grid.layout-split-reversed {
      grid-template-columns: 0.9fr 1.3fr;
    }
    @media (max-width: 860px) {
      .slide-content-grid.layout-split-reversed { grid-template-columns: 1fr; }
    }

    /* Layout: Comparison 3 Columns (Bento Cards) */
    .layout-comparison-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      width: 100%;
      margin-bottom: 24px;
    }
    @media (max-width: 900px) {
      .layout-comparison-grid { grid-template-columns: 1fr; }
    }
    .comparison-card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: transform 0.2s, border-color 0.2s;
    }
    .comparison-card:hover {
      transform: translateY(-3px);
      border-color: #818cf8;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.15);
    }
    .comparison-card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.05rem;
      font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 10px;
    }
    .comparison-card-desc {
      font-size: 0.92rem;
      color: #cbd5e1;
      line-height: 1.55;
    }

    /* Layout: Hero Infographic */
    .layout-hero-container {
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 100%;
    }
    .hero-media-box {
      width: 100%;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: #0f172a;
      max-height: 480px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-media-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .hero-takeaways-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }

    /* Layout: Process Steps Timeline */
    .process-steps-container {
      display: flex;
      flex-direction: column;
      gap: 18px;
      position: relative;
      padding-left: 32px;
      border-left: 2px dashed rgba(99, 102, 241, 0.45);
      margin: 12px 0 24px 20px;
    }
    .process-step-item {
      position: relative;
      background: rgba(30, 41, 59, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px 20px;
      transition: all 0.2s ease;
    }
    .process-step-item:hover {
      background: rgba(30, 41, 59, 0.85);
      border-color: rgba(99, 102, 241, 0.4);
    }
    .process-step-node {
      position: absolute;
      left: -46px;
      top: 16px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #6366f1;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 0 0 4px #0f172a;
    }
    .process-step-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 6px;
    }
    .process-step-desc {
      font-size: 0.9rem;
      color: #cbd5e1;
      line-height: 1.5;
    }

    /* Layout: Audio Lab Container */
    .audio-lab-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 100%;
    }

    /* Layout: Checkpoint Gate Full Width */
    .checkpoint-gate-container {
      width: 100%;
    }

    .media-center-box {
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }

    .bullets-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bullet-item {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 14px 18px;
      border-radius: 12px;
      transition: all 0.2s ease;
    }
    .bullet-item:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(99, 102, 241, 0.3);
    }
    .bullet-icon {
      font-size: 1.4rem;
      flex-shrink: 0;
      line-height: 1;
    }
    .bullet-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bullet-point {
      font-size: 1.05rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .bullet-desc {
      font-size: 0.9rem;
      color: var(--text-sub);
      line-height: 1.5;
    }

    .slide-media-box {
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #0f172a;
      aspect-ratio: 16 / 10;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .slide-media-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* Extra Sample Audio Player */
    .sample-audio-card {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .sample-audio-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sample-audio-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #6ee7b7;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sample-audio-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .sample-audio-player {
      width: 100%;
      height: 40px;
      border-radius: 8px;
    }

    /* Interactive Quiz Section */
    .interaction-card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid #3b82f6;
      border-radius: 14px;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .interaction-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 12px;
    }
    .interaction-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      color: #60a5fa;
      font-size: 1.05rem;
    }
    .interaction-instruction {
      font-size: 0.92rem;
      color: #cbd5e1;
      font-style: italic;
    }

    .questions-stack {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .question-block {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .question-prompt {
      font-size: 1rem;
      font-weight: 600;
      color: #f8fafc;
      line-height: 1.45;
    }
    .options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    @media (max-width: 640px) {
      .options-grid { grid-template-columns: 1fr; }
    }
    .option-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 12px 16px;
      color: #e2e8f0;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .option-btn:hover:not(:disabled) {
      background: rgba(99, 102, 241, 0.15);
      border-color: #818cf8;
      color: #fff;
    }
    .option-btn.correct {
      background: rgba(16, 185, 129, 0.25) !important;
      border-color: #10b981 !important;
      color: #6ee7b7 !important;
      font-weight: 600;
    }
    .option-btn.wrong {
      background: rgba(239, 68, 68, 0.25) !important;
      border-color: #ef4444 !important;
      color: #fca5a5 !important;
    }
    .option-btn:disabled {
      cursor: default;
    }

    .explanation-box {
      background: rgba(30, 41, 59, 0.8);
      border-left: 4px solid #6366f1;
      padding: 10px 14px;
      border-radius: 0 8px 8px 0;
      font-size: 0.85rem;
      color: #cbd5e1;
      display: none;
      line-height: 1.4;
    }
    .explanation-box.show { display: block; }

    /* Option Selected State */
    .option-btn.selected {
      background: rgba(99, 102, 241, 0.25) !important;
      border-color: #818cf8 !important;
      color: #fff !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4);
    }

    /* Question Type Badges */
    .qtype-tag {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 4px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .qtype-tag.mc { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.35); }
    .qtype-tag.tf { background: rgba(14, 165, 233, 0.2); color: #7dd3fc; border: 1px solid rgba(14, 165, 233, 0.35); }
    .qtype-tag.mr { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.35); }
    .qtype-tag.fib { background: rgba(245, 158, 11, 0.2); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.35); }
    .qtype-tag.match { background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.35); }

    /* Matching Pairs styles */
    .match-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
      width: 100%;
    }
    .match-row {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.04);
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .match-left {
      flex: 1;
      font-size: 0.95rem;
      color: #f1f5f9;
      font-weight: 500;
    }
    .match-arrow {
      color: #818cf8;
      font-weight: 700;
      font-size: 1.1rem;
    }
    .match-right {
      flex: 1.3;
    }
    .match-select {
      width: 100%;
      padding: 8px 12px;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #475569;
      border-radius: 6px;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .match-select:focus {
      border-color: #6366f1;
    }

    /* True/False specific buttons */
    .tf-grid {
      display: flex;
      gap: 14px;
      margin-top: 10px;
    }
    .tf-btn {
      flex: 1;
      padding: 14px 20px;
      font-size: 1rem;
      font-weight: 600;
      text-align: center;
      justify-content: center;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Multiple Response Checkbox Indicator */
    .cb-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: 1.5px solid #818cf8;
      border-radius: 4px;
      margin-right: 8px;
      font-size: 11px;
      font-weight: bold;
      color: transparent;
      background: rgba(15, 23, 42, 0.6);
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .option-btn.selected .cb-indicator {
      background: #6366f1;
      border-color: #6366f1;
      color: #fff;
    }

    /* Fill-in-the-blank input container */
    .fib-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }
    .fib-input-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .fib-input {
      flex: 1;
      min-width: 260px;
      max-width: 480px;
      background: rgba(15, 23, 42, 0.7);
      border: 1.5px solid #475569;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 0.95rem;
      color: #fff;
      outline: none;
      transition: all 0.2s ease;
    }
    .fib-input:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
      background: rgba(15, 23, 42, 0.9);
    }
    .fib-input.correct {
      border-color: #10b981 !important;
      background: rgba(16, 185, 129, 0.15) !important;
      color: #6ee7b7 !important;
    }
    .fib-input.wrong {
      border-color: #ef4444 !important;
      background: rgba(239, 68, 68, 0.15) !important;
      color: #fca5a5 !important;
    }


    /* Mastery Gate Action Bar & Banners */
    .gate-action-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(15, 23, 42, 0.7);
      border: 1px dashed rgba(99, 102, 241, 0.5);
      border-radius: 12px;
      padding: 16px 20px;
      margin-top: 12px;
      gap: 16px;
      flex-wrap: wrap;
    }
    .gate-status-text {
      font-size: 0.95rem;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .gate-passed-banner {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #6ee7b7;
      border-radius: 10px;
      padding: 14px 20px;
      font-size: 0.95rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
    }

    /* Modal Overlay for Gate Result */
    .gate-modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }
    .gate-modal-overlay.active {
      display: flex;
    }
    .gate-modal-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 32px 28px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
      animation: modal-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes modal-pop {
      0% { transform: scale(0.9); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    .gate-modal-icon { font-size: 3.5rem; margin-bottom: 12px; }
    .gate-modal-title { font-size: 1.35rem; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .gate-modal-desc { font-size: 0.95rem; color: #cbd5e1; line-height: 1.5; margin-bottom: 16px; }
    .gate-modal-badge {
      display: inline-block;
      padding: 6px 18px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 1rem;
      margin-bottom: 20px;
    }
    .gate-modal-badge.success {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .gate-modal-badge.fail {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .gate-modal-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    .gate-countdown-text {
      font-size: 0.85rem;
      color: #94a3b8;
      font-style: italic;
    }

    /* Footer Navigation (with safe right padding to avoid Moodle Chatbot widget) */
    footer {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--card-border);
      padding: 16px 90px 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      bottom: 0;
      z-index: 50;
    }
    .nav-buttons {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .btn-primary {
      background: var(--primary);
      color: #fff;
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--primary-dark);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .slide-counter {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-sub);
    }

    /* Suppress duplicate TUAF LMS floating chatbot when injected inside SCORM iframe */
    #tuaf-widget-bubble, #tuaf-widget-popup, [id*="tuaf-widget"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      width: 0 !important;
      height: 0 !important;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header>
    <div class="header-title">
      <span>🎓</span>
      <span>${escapeXml(lessonTitle)}</span>
    </div>
    <div class="header-controls">
      <label class="autoplay-toggle">
        <input type="checkbox" id="autoplayCheckbox" checked>
        <span>Tự động phát lời giảng</span>
      </label>
      <div class="score-badge" id="scoreBadge">Điểm SCORM: 100%</div>
    </div>
  </header>

  <!-- Progress bar -->
  <div class="progress-track">
    <div class="progress-fill" id="progressFill"></div>
  </div>

  <!-- Main Slide View -->
  <main id="mainContainer">
    <div class="slide-card" id="slideCard">
      <!-- Dynamic Slide Content rendered via JS -->
    </div>

    <!-- Hidden narration audio element -->
    <audio id="narrationAudio" preload="auto" style="display: none;"></audio>
  </main>

  <!-- Mastery Gate Modal Overlay -->
  <div class="gate-modal-overlay" id="gateModalOverlay">
    <div class="gate-modal-card">
      <div class="gate-modal-icon" id="gateModalIcon">🎉</div>
      <h3 class="gate-modal-title" id="gateModalTitle">Kết quả kiểm tra</h3>
      <div class="gate-modal-badge" id="gateModalBadge">4 / 5 câu đúng</div>
      <p class="gate-modal-desc" id="gateModalDesc">Mô tả kết quả...</p>
      <div class="gate-modal-actions" id="gateModalActions"></div>
      <div class="gate-countdown-text" id="gateCountdownText"></div>
    </div>
  </div>

  <!-- Footer Navigation -->
  <footer>
    <button class="btn btn-secondary" id="btnPrev" onclick="navigateSlide(-1)">
      ⬅️ Slide trước
    </button>
    <div class="slide-counter" id="slideCounter">Slide 1 / 1</div>
    <div class="nav-buttons">
      <button class="btn btn-primary" id="btnNext" onclick="navigateSlide(1)">
        Slide tiếp theo ➡️
      </button>
      <button class="btn btn-primary" id="btnFinish" style="display: none; background: #10b981;" onclick="finishCourse()">
        🏁 Hoàn thành bài học
      </button>
    </div>
  </footer>

  <script>
    // Embedded Slide Data
    const SLIDES = ${slidesJson};
    let currentSlideIdx = 0;
    let studentScores = {}; // questionKey -> boolean
    let totalQuestionsCount = 0;
    let slidePassed = {}; // slideIdx -> boolean
    let userGateAnswers = {}; // slideIdx -> { qKey: chosenOption }
    let gateCountdownTimer = null;

    // Count total questions
    SLIDES.forEach(s => {
      if (s.interaction && Array.isArray(s.interaction.questions)) {
        totalQuestionsCount += s.interaction.questions.length;
      }
    });

    // SCORM 1.2 API Wrapper
    let scormAPI = null;
    function findSCORMAPI(win) {
      let attempts = 0;
      while (win && attempts < 10) {
        if (win.API) return win.API;
        if (win.parent && win.parent !== win) win = win.parent;
        else if (win.opener) win = win.opener;
        else break;
        attempts++;
      }
      return null;
    }

    function initSCORM() {
      scormAPI = findSCORMAPI(window);
      if (scormAPI) {
        try {
          scormAPI.LMSInitialize("");
          scormAPI.LMSSetValue("cmi.core.lesson_status", "incomplete");
          scormAPI.LMSSetValue("cmi.core.score.min", "0");
          scormAPI.LMSSetValue("cmi.core.score.max", "100");
          scormAPI.LMSCommit("");
          console.log("SCORM 1.2 Initialized successfully");
        } catch (e) {
          console.warn("SCORM init error:", e);
        }
      } else {
        console.log("Running in standalone preview mode (No LMS detected)");
      }
    }

    function updateSCORMScore() {
      if (totalQuestionsCount === 0) {
        document.getElementById('scoreBadge').innerText = "Đã xem: " + Math.round(((currentSlideIdx + 1) / SLIDES.length) * 100) + "%";
        return;
      }

      let correctCount = 0;
      for (const key in studentScores) {
        if (studentScores[key] === true) correctCount++;
      }
      const scorePercent = Math.round((correctCount / totalQuestionsCount) * 100);
      document.getElementById('scoreBadge').innerText = 'Điểm: ' + scorePercent + '% (' + correctCount + '/' + totalQuestionsCount + ')';

      if (scormAPI) {
        try {
          scormAPI.LMSSetValue("cmi.core.score.raw", scorePercent.toString());
          if (scorePercent >= 80) {
            scormAPI.LMSSetValue("cmi.core.lesson_status", "passed");
          }
          scormAPI.LMSCommit("");
        } catch (e) {}
      }
    }

    function finishCourse() {
      let correctCount = 0;
      for (const key in studentScores) {
        if (studentScores[key] === true) correctCount++;
      }
      const scorePercent = totalQuestionsCount > 0 ? Math.round((correctCount / totalQuestionsCount) * 100) : 100;

      if (scormAPI) {
        try {
          scormAPI.LMSSetValue("cmi.core.score.raw", scorePercent.toString());
          scormAPI.LMSSetValue("cmi.core.lesson_status", scorePercent >= 80 ? "passed" : "completed");
          scormAPI.LMSCommit("");
          scormAPI.LMSFinish("");
        } catch (e) {}
      }
      alert("🎉 Chúc mừng bạn đã hoàn thành bài học! Điểm số: " + scorePercent + "%. Kết quả đã được đồng bộ lên Moodle LMS.");
    }

    window.addEventListener("beforeunload", () => {
      if (scormAPI) {
        try {
          scormAPI.LMSCommit("");
          scormAPI.LMSFinish("");
        } catch (e) {}
      }
    });

    function updateSpeakerBtnUI(isPlaying) {
      const btn = document.getElementById('speakerBtn');
      const icon = document.getElementById('speakerIcon');
      const wave = document.getElementById('speakerWave');
      if (!btn) return;
      if (isPlaying) {
        btn.classList.add('playing');
        if (icon) icon.innerText = '⏸️';
        if (wave) wave.innerText = 'Đang phát...';
      } else {
        btn.classList.remove('playing');
        if (icon) icon.innerText = '🔊';
        if (wave) wave.innerText = 'Nghe lời giảng';
      }
    }

    function toggleSlideAudio() {
      const audio = document.getElementById('narrationAudio');
      if (!audio || !audio.src) return;
      if (audio.paused) {
        audio.play().then(() => updateSpeakerBtnUI(true)).catch(e => console.log('Audio play error:', e));
      } else {
        audio.pause();
        updateSpeakerBtnUI(false);
      }
    }

    // Render Current Slide
    function renderSlide(idx) {
      if (idx < 0 || idx >= SLIDES.length) return;
      if (gateCountdownTimer) {
        clearInterval(gateCountdownTimer);
        gateCountdownTimer = null;
      }
      closeGateModal();

      currentSlideIdx = idx;
      const slide = SLIDES[idx];

      // Update progress
      const percent = Math.round(((idx + 1) / SLIDES.length) * 100);
      document.getElementById('progressFill').style.width = percent + '%';
      document.getElementById('slideCounter').innerText = 'Slide ' + (idx + 1) + ' / ' + SLIDES.length;

      // Update nav buttons
      document.getElementById('btnPrev').disabled = idx === 0;

      const isGatedCheckpoint = slide.isCheckpoint && !slidePassed[idx];

      if (idx === SLIDES.length - 1) {
        document.getElementById('btnNext').style.display = 'none';
        document.getElementById('btnFinish').style.display = 'inline-flex';
        document.getElementById('btnFinish').disabled = isGatedCheckpoint;
      } else {
        document.getElementById('btnNext').style.display = 'inline-flex';
        document.getElementById('btnFinish').style.display = 'none';
        document.getElementById('btnNext').disabled = isGatedCheckpoint;
        if (isGatedCheckpoint) {
          document.getElementById('btnNext').title = 'Bạn cần vượt qua bài kiểm tra để mở khóa slide tiếp theo';
        } else {
          document.getElementById('btnNext').title = 'Chuyển sang slide tiếp theo';
        }
      }



      // Bullets
      let bulletsHtml = '';
      if (slide.bullets && slide.bullets.length > 0) {
        bulletsHtml = slide.bullets.map(b => \`
          <div class="bullet-item">
            <span class="bullet-icon">\${b.emoji || '📌'}</span>
            <div class="bullet-text">
              <span class="bullet-point">\${b.point || ''}</span>
              \${(b.description && b.description.trim().toLowerCase() !== (b.point || '').trim().toLowerCase()) ? \`<span class="bullet-desc">\${b.description}</span>\` : ''}
            </div>
          </div>
        \`).join('');
      }

      // Image
      let mediaHtml = '';
      if (slide.imageUrl) {
        mediaHtml = \`
          <div class="slide-media-box">
            <img src="\${slide.imageUrl}" alt="\${slide.title}" />
          </div>
        \`;
      }

      // Sample Audio
      let sampleAudioHtml = '';
      if (slide.extraAudioUrl) {
        sampleAudioHtml = \`
          <div class="sample-audio-card">
            <div class="sample-audio-header">
              <span class="sample-audio-title">🎧 \${slide.extraAudioName || 'Đoạn audio thực hành'}</span>
            </div>
            <div class="sample-audio-controls">
              <audio controls src="\${slide.extraAudioUrl}" class="sample-audio-player" preload="metadata"></audio>
            </div>
          </div>
        \`;
      }

      // Interactive questions
      let interactionHtml = '';
      if (slide.interaction) {
        const questions = slide.interaction.questions || [];
        const isGated = slide.isCheckpoint || slide.hideSolutions;
        const answersForSlide = userGateAnswers[idx] || {};

        const qItemsHtml = questions.map((q, qIndex) => {
          const qKey = 's' + slide.slideIndex + '_q' + qIndex;
          const qType = (q.type || 'MC').toUpperCase();
          const selectedVal = answersForSlide[qKey];

          let typeBadgeHtml = '';
          if (qType === 'TF') {
            typeBadgeHtml = '<span class="qtype-tag tf">Đúng / Sai</span>';
          } else if (qType === 'MR') {
            typeBadgeHtml = '<span class="qtype-tag mr">Chọn nhiều đáp án</span>';
          } else if (qType === 'FIB') {
            typeBadgeHtml = '<span class="qtype-tag fib">Điền vào chỗ trống</span>';
          } else if (qType === 'MATCH') {
            typeBadgeHtml = '<span class="qtype-tag match">Nối cặp tương ứng</span>';
          } else {
            typeBadgeHtml = '<span class="qtype-tag mc">Chọn 1 đáp án</span>';
          }

          let bodyHtml = '';

          if (qType === 'TF') {
            // True / False format
            const tfOptions = ['Đúng', 'Sai'];
            const buttonsHtml = tfOptions.map(opt => {
              if (isGated) {
                const isSelected = selectedVal === opt;
                return \`
                  <button class="option-btn tf-btn \${isSelected ? 'selected' : ''}" onclick="selectGateOption('\${qKey}', '\${encodeURIComponent(opt)}', this, \${idx})">
                    <span>\${opt === 'Đúng' ? '✓' : '✗'}</span> \${opt}
                  </button>
                \`;
              } else {
                return \`
                  <button class="option-btn tf-btn" onclick="checkAnswer('\${qKey}', '\${encodeURIComponent(opt)}', '\${encodeURIComponent(q.correctAnswer || 'Đúng')}', this, 'expl_\${qKey}')">
                    <span>\${opt === 'Đúng' ? '✓' : '✗'}</span> \${opt}
                  </button>
                \`;
              }
            }).join('');

            bodyHtml = \`<div class="tf-grid">\${buttonsHtml}</div>\`;

          } else if (qType === 'MR') {
            // Multiple Response format (Checkboxes)
            const chosenArray = Array.isArray(selectedVal) ? selectedVal : [];
            const correctJson = encodeURIComponent(JSON.stringify(q.correctAnswers || [q.correctAnswer || '']));

            const optionsHtml = (q.options || []).map((opt, optIndex) => {
              const letter = String.fromCharCode(65 + optIndex);
              const isChecked = chosenArray.includes(opt);
              if (isGated) {
                return \`
                  <button class="option-btn \${isChecked ? 'selected' : ''}" onclick="toggleGateCheckbox('\${qKey}', '\${encodeURIComponent(opt)}', this, \${idx})">
                    <span class="cb-indicator">✓</span>
                    <strong>\${letter}.</strong> \${opt}
                  </button>
                \`;
              } else {
                return \`
                  <button class="option-btn" data-opt="\${encodeURIComponent(opt)}" onclick="togglePracticeCheckbox(this)">
                    <span class="cb-indicator">✓</span>
                    <strong>\${letter}.</strong> \${opt}
                  </button>
                \`;
              }
            }).join('');

            const practiceCheckBtn = !isGated ? \`
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;" onclick="checkMRPracticeAnswer('\${qKey}', '\${correctJson}', this, 'expl_\${qKey}')">
                  🔍 Kiểm tra đáp án câu này
                </button>
              </div>
            \` : '';

            bodyHtml = \`
              <div class="options-grid">\${optionsHtml}</div>
              \${practiceCheckBtn}
            \`;

          } else if (qType === 'FIB') {
            // Fill-in-the-blank format
            const inputVal = typeof selectedVal === 'string' ? selectedVal : '';
            const correctJson = encodeURIComponent(JSON.stringify(q.correctAnswer || (q.correctAnswers ? q.correctAnswers[0] : '')));

            if (isGated) {
              bodyHtml = \`
                <div class="fib-container">
                  <div class="fib-input-row">
                    <input type="text" class="fib-input" id="input_\${qKey}" 
                      placeholder="Gõ từ hoặc cụm từ cần điền vào đây..." 
                      value="\${inputVal}"
                      oninput="recordGateFIB('\${qKey}', this.value, \${idx})" />
                  </div>
                </div>
              \`;
            } else {
              bodyHtml = \`
                <div class="fib-container">
                  <div class="fib-input-row">
                    <input type="text" class="fib-input" id="input_\${qKey}" 
                      placeholder="Gõ từ hoặc cụm từ cần điền..." />
                    <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 10px 16px;" onclick="checkFIBPracticeAnswer('\${qKey}', 'input_\${qKey}', '\${correctJson}', this, 'expl_\${qKey}')">
                      🔍 Kiểm tra
                    </button>
                  </div>
                </div>
              \`;
            }

          } else if (qType === 'MATCH') {
            // Matching Pairs format (Left item -> Select dropdown for Right item)
            const pairs = Array.isArray(q.pairs) ? q.pairs : [];
            const rightOptions = Array.from(new Set(pairs.map(p => p.right))).sort(() => Math.random() - 0.5);
            const userMatches = (typeof selectedVal === 'object' && selectedVal !== null) ? selectedVal : {};
            const correctJson = encodeURIComponent(JSON.stringify(pairs));

            const rowsHtml = pairs.map((pair, pIdx) => {
              const currentChoice = userMatches[pair.left] || '';
              const selectOptions = ['<option value="">-- Chọn vế tương ứng --</option>']
                .concat(rightOptions.map(ro => \`<option value="\${encodeURIComponent(ro)}" \${currentChoice === ro ? 'selected' : ''}>\${ro}</option>\`))
                .join('');

              if (isGated) {
                return \`
                  <div class="match-row">
                    <div class="match-left"><strong>\${pIdx + 1}.</strong> \${pair.left}</div>
                    <div class="match-arrow">➔</div>
                    <div class="match-right">
                      <select class="match-select" onchange="recordGateMatch('\${qKey}', '\${encodeURIComponent(pair.left)}', this.value, \${idx})">
                        \${selectOptions}
                      </select>
                    </div>
                  </div>
                \`;
              } else {
                return \`
                  <div class="match-row">
                    <div class="match-left"><strong>\${pIdx + 1}.</strong> \${pair.left}</div>
                    <div class="match-arrow">➔</div>
                    <div class="match-right">
                      <select class="match-select" data-left="\${encodeURIComponent(pair.left)}">
                        \${selectOptions}
                      </select>
                    </div>
                  </div>
                \`;
              }
            }).join('');

            const practiceCheckBtn = !isGated ? \`
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;" onclick="checkMatchPracticeAnswer('\${qKey}', '\${correctJson}', this, 'expl_\${qKey}')">
                  🔍 Kiểm tra các cặp nối
                </button>
              </div>
            \` : '';

            bodyHtml = \`
              <div class="match-container">
                \${rowsHtml}
              </div>
              \${practiceCheckBtn}
            \`;

          } else {
            // Standard Single Choice (MC)
            const optionsHtml = (q.options || []).map((opt, optIndex) => {
              const letter = String.fromCharCode(65 + optIndex);
              if (isGated) {
                const isSelected = selectedVal === opt;
                return \`
                  <button class="option-btn \${isSelected ? 'selected' : ''}" onclick="selectGateOption('\${qKey}', '\${encodeURIComponent(opt)}', this, \${idx})">
                    <strong>\${letter}.</strong> \${opt}
                  </button>
                \`;
              } else {
                return \`
                  <button class="option-btn" onclick="checkAnswer('\${qKey}', '\${encodeURIComponent(opt)}', '\${encodeURIComponent(q.correctAnswer)}', this, 'expl_\${qKey}')">
                    <strong>\${letter}.</strong> \${opt}
                  </button>
                \`;
              }
            }).join('');

            bodyHtml = \`<div class="options-grid">\${optionsHtml}</div>\`;
          }

          return \`
            <div class="question-block" id="block_\${qKey}">
              <div class="question-prompt">
                \${qIndex + 1}. \${q.question}
                \${typeBadgeHtml}
              </div>
              \${bodyHtml}
              \${!isGated ? \`
                <div class="explanation-box" id="expl_\${qKey}">
                  <strong>💡 Giải thích:</strong> \${q.explanation || 'Chính xác!'}
                </div>
              \` : ''}
            </div>
          \`;
        }).join('');

        let gateFooterHtml = '';
        if (slide.isCheckpoint) {
          if (slidePassed[idx]) {
            gateFooterHtml = \`
              <div class="gate-passed-banner">
                <span>🏆</span>
                <span>Bạn đã hoàn thành xuất sắc bài kiểm tra này! Nút chuyển tiếp bài học đã được mở khóa.</span>
              </div>
            \`;
          } else {
            gateFooterHtml = \`
              <div class="gate-action-bar">
                <div class="gate-status-text">
                  <span>🔒</span>
                  <span>Yêu cầu: Đạt ít nhất <strong>\${slide.passScore}/\${questions.length} câu</strong> để mở khóa bài học tiếp theo.</span>
                </div>
                <button class="btn btn-primary" id="btnSubmitGate_\${idx}" onclick="submitGateQuiz(\${idx})">
                  📝 Nộp bài & Kiểm tra kết quả
                </button>
              </div>
            \`;
          }
        }

        interactionHtml = \`
          <div class="interaction-card">
            <div class="interaction-header">
              <div class="interaction-header-left">
                <span>\${slide.isCheckpoint ? '🎯' : '⚡'}</span>
                <span>\${slide.interaction.badgeLabel || (slide.isCheckpoint ? 'Kiểm tra chặn bài (Mastery Gate)' : 'Hoạt động củng cố kiến thức')}</span>
              </div>
            </div>
            \${slide.interaction.instruction ? \`<div class="interaction-instruction">\${slide.interaction.instruction}</div>\` : ''}
            <div class="questions-stack">
              \${qItemsHtml}
            </div>
            \${gateFooterHtml}
          </div>
        \`;
      }

      // Speaker Button
      const speakerBtnHtml = slide.audioUrl ? \`
        <button class="speaker-btn" id="speakerBtn" onclick="toggleSlideAudio()" title="Bật/Tắt lời giảng audio">
          <span id="speakerIcon">🔊</span>
          <span id="speakerWave">Nghe lời giảng</span>
        </button>
      \` : '';

      // Multi-Layout Builder
      const layoutType = slide.layoutType || 'split_standard';
      let layoutBodyHtml = '';

      if (layoutType === 'split_reversed') {
        layoutBodyHtml = \`
          <div class="slide-content-grid layout-split-reversed">
            \${mediaHtml}
            \${bulletsHtml ? \`<div class="bullets-list">\${bulletsHtml}</div>\` : ''}
          </div>
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      } else if (layoutType === 'comparison_3col') {
        const cardsHtml = (slide.bullets || []).map(b => \`
          <div class="comparison-card">
            <div class="comparison-card-header">
              <span>\${b.emoji || '📌'}</span>
              <span>\${b.point}</span>
            </div>
            <div class="comparison-card-desc">\${b.description || ''}</div>
          </div>
        \`).join('');

        layoutBodyHtml = \`
          <div class="layout-comparison-grid">
            \${cardsHtml}
          </div>
          \${mediaHtml ? \`<div class="media-center-box">\${mediaHtml}</div>\` : ''}
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      } else if (layoutType === 'hero_infographic') {
        layoutBodyHtml = \`
          <div class="layout-hero-container">
            \${mediaHtml ? \`<div class="hero-media-box">\${mediaHtml}</div>\` : ''}
            \${bulletsHtml ? \`<div class="hero-takeaways-grid">\${bulletsHtml}</div>\` : ''}
          </div>
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      } else if (layoutType === 'process_steps') {
        const stepsHtml = (slide.bullets || []).map((b, bIdx) => \`
          <div class="process-step-item">
            <div class="process-step-node">\${bIdx + 1}</div>
            <div class="process-step-title">\${b.emoji || '⚡'} \${b.point}</div>
            <div class="process-step-desc">\${b.description || ''}</div>
          </div>
        \`).join('');

        layoutBodyHtml = \`
          <div class="process-steps-container">
            \${stepsHtml}
          </div>
          \${mediaHtml ? \`<div class="media-center-box">\${mediaHtml}</div>\` : ''}
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      } else if (layoutType === 'audio_lab') {
        layoutBodyHtml = \`
          <div class="audio-lab-container">
            \${sampleAudioHtml}
            \${bulletsHtml ? \`<div class="bullets-list">\${bulletsHtml}</div>\` : ''}
            \${interactionHtml}
          </div>
        \`;
      } else if (layoutType === 'checkpoint_gate') {
        layoutBodyHtml = \`
          <div class="checkpoint-gate-container">
            \${interactionHtml}
          </div>
        \`;
      } else {
        // split_standard (Default)
        layoutBodyHtml = \`
          <div class="\${bulletsHtml ? 'slide-content-grid' : 'slide-content-grid single-media'}">
            \${bulletsHtml ? \`<div class="bullets-list">\${bulletsHtml}</div>\` : ''}
            \${mediaHtml}
          </div>
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      }

      // Construct Slide HTML
      const slideCard = document.getElementById('slideCard');
      slideCard.innerHTML = \`
        <div class="slide-top-header">
          <h2 class="slide-title">\${slide.title}</h2>
          \${speakerBtnHtml}
        </div>
        \${layoutBodyHtml}
      \`;

      // Handle Narration Audio
      const narrationAudio = document.getElementById('narrationAudio');
      if (slide.audioUrl) {
        narrationAudio.src = slide.audioUrl;
        const autoplay = document.getElementById('autoplayCheckbox').checked;
        if (autoplay) {
          narrationAudio.play().then(() => {
            updateSpeakerBtnUI(true);
          }).catch(e => {
            console.log('Autoplay blocked by browser policy:', e);
            updateSpeakerBtnUI(false);
          });
        } else {
          updateSpeakerBtnUI(false);
        }
      } else {
        narrationAudio.pause();
        narrationAudio.src = '';
      }

      // SCORM location update
      if (scormAPI) {
        try {
          scormAPI.LMSSetValue("cmi.core.lesson_location", (idx + 1).toString());
          scormAPI.LMSCommit("");
        } catch (e) {}
      }
    }

    function checkAnswer(qKey, chosenEncoded, correctEncoded, btnEl, explId) {
      const chosen = decodeURIComponent(chosenEncoded);
      const correct = decodeURIComponent(correctEncoded);
      const block = btnEl.closest('.question-block');
      const allBtns = block.querySelectorAll('.option-btn');

      // Disable buttons to lock answer
      allBtns.forEach(b => b.disabled = true);

      const isCorrect = chosen.trim().toLowerCase() === correct.trim().toLowerCase();
      studentScores[qKey] = isCorrect;

      if (isCorrect) {
        btnEl.classList.add('correct');
        btnEl.innerHTML += ' ✅';
      } else {
        btnEl.classList.add('wrong');
        btnEl.innerHTML += ' ❌';
        // Highlight correct one
        allBtns.forEach(b => {
          if (b.innerText.toLowerCase().includes(correct.toLowerCase())) {
            b.classList.add('correct');
          }
        });
      }

      // Show explanation
      const expl = document.getElementById(explId);
      if (expl) expl.classList.add('show');

      updateSCORMScore();
    }

    function selectGateOption(qKey, chosenEncoded, btnEl, slideIdx) {
      if (slidePassed[slideIdx]) return; // already passed
      const chosen = decodeURIComponent(chosenEncoded);
      if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
      userGateAnswers[slideIdx][qKey] = chosen;

      const block = btnEl.closest('.question-block');
      const allBtns = block.querySelectorAll('.option-btn');
      allBtns.forEach(b => b.classList.remove('selected'));
      btnEl.classList.add('selected');
    }

    function toggleGateCheckbox(qKey, chosenEncoded, btnEl, slideIdx) {
      if (slidePassed[slideIdx]) return;
      const chosen = decodeURIComponent(chosenEncoded);
      if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
      let arr = userGateAnswers[slideIdx][qKey];
      if (!Array.isArray(arr)) arr = [];

      const existsIdx = arr.indexOf(chosen);
      if (existsIdx > -1) {
        arr.splice(existsIdx, 1);
        btnEl.classList.remove('selected');
      } else {
        arr.push(chosen);
        btnEl.classList.add('selected');
      }
      userGateAnswers[slideIdx][qKey] = arr;
    }

    function recordGateFIB(qKey, val, slideIdx) {
      if (slidePassed[slideIdx]) return;
      if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
      userGateAnswers[slideIdx][qKey] = val;
    }

    function togglePracticeCheckbox(btnEl) {
      btnEl.classList.toggle('selected');
    }

    function checkMRPracticeAnswer(qKey, correctJson, btnEl, explId) {
      const block = btnEl.closest('.question-block');
      const allBtns = block.querySelectorAll('.option-btn');
      const correctList = JSON.parse(decodeURIComponent(correctJson)).map(c => (c || '').trim().toLowerCase());

      let allCorrect = true;
      allBtns.forEach(b => {
        const opt = decodeURIComponent(b.getAttribute('data-opt') || '').trim().toLowerCase();
        const isSelected = b.classList.contains('selected');
        const shouldBeSelected = correctList.includes(opt);

        if (isSelected && shouldBeSelected) {
          b.classList.add('correct');
        } else if (isSelected && !shouldBeSelected) {
          b.classList.add('wrong');
          allCorrect = false;
        } else if (!isSelected && shouldBeSelected) {
          b.classList.add('correct');
          allCorrect = false;
        }
      });

      studentScores[qKey] = allCorrect;
      const expl = document.getElementById(explId);
      if (expl) expl.classList.add('show');
      updateSCORMScore();
    }

    function checkFIBPracticeAnswer(qKey, inputId, correctJson, btnEl, explId) {
      const inputEl = document.getElementById(inputId);
      if (!inputEl) return;
      const val = (inputEl.value || '').trim().toLowerCase();
      const correctVal = JSON.parse(decodeURIComponent(correctJson));
      const acceptable = Array.isArray(correctVal) 
        ? correctVal.map(c => (c || '').trim().toLowerCase()) 
        : [(correctVal || '').trim().toLowerCase()];

      const isCorrect = acceptable.includes(val);
      studentScores[qKey] = isCorrect;

      inputEl.classList.remove('correct', 'wrong');
      if (isCorrect) {
        inputEl.classList.add('correct');
      } else {
        inputEl.classList.add('wrong');
      }

      const expl = document.getElementById(explId);
      if (expl) expl.classList.add('show');
      updateSCORMScore();
    }

    function recordGateMatch(qKey, leftEncoded, rightVal, slideIdx) {
      if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
      if (!userGateAnswers[slideIdx][qKey] || typeof userGateAnswers[slideIdx][qKey] !== 'object') {
        userGateAnswers[slideIdx][qKey] = {};
      }
      const left = decodeURIComponent(leftEncoded);
      if (rightVal) {
        userGateAnswers[slideIdx][qKey][left] = rightVal;
      } else {
        delete userGateAnswers[slideIdx][qKey][left];
      }
    }

    function checkMatchPracticeAnswer(qKey, correctJson, btnEl, explId) {
      const pairs = JSON.parse(decodeURIComponent(correctJson));
      const container = btnEl.closest('.question-block');
      if (!container) return;
      const selects = container.querySelectorAll('.match-select');
      let allCorrect = true;
      selects.forEach(sel => {
        const left = decodeURIComponent(sel.getAttribute('data-left') || '');
        const targetPair = pairs.find(p => p.left === left);
        const expectedRight = targetPair ? targetPair.right : '';
        const userRight = sel.value;
        sel.classList.remove('correct', 'wrong');
        if (userRight && userRight === expectedRight) {
          sel.classList.add('correct');
        } else {
          sel.classList.add('wrong');
          allCorrect = false;
        }
      });
      studentScores[qKey] = allCorrect;
      const expl = document.getElementById(explId);
      if (expl) expl.classList.add('show');
      updateSCORMScore();
    }

    function submitGateQuiz(slideIdx) {
      const slide = SLIDES[slideIdx];
      const questions = slide.interaction?.questions || [];
      const answers = userGateAnswers[slideIdx] || {};

      let answeredCount = 0;
      let correctCount = 0;

      questions.forEach((q, qIndex) => {
        const qKey = 's' + slide.slideIndex + '_q' + qIndex;
        const ans = answers[qKey];
        const qType = (q.type || 'MC').toUpperCase();

        if (qType === 'MR') {
          if (Array.isArray(ans) && ans.length > 0) {
            answeredCount++;
            const correctSet = (q.correctAnswers || [q.correctAnswer || ''])
              .map(a => (a || '').trim().toLowerCase())
              .filter(Boolean);
            const chosenSet = ans.map(a => (a || '').trim().toLowerCase()).filter(Boolean);

            const isMatch = correctSet.length === chosenSet.length && 
              correctSet.every(item => chosenSet.includes(item));
            studentScores[qKey] = isMatch;
            if (isMatch) correctCount++;
          }
        } else if (qType === 'FIB') {
          if (typeof ans === 'string' && ans.trim() !== '') {
            answeredCount++;
            const acceptable = [];
            if (q.correctAnswer) acceptable.push(q.correctAnswer.trim().toLowerCase());
            if (Array.isArray(q.correctAnswers)) {
              q.correctAnswers.forEach(a => acceptable.push((a || '').trim().toLowerCase()));
            }
            const cleanAns = ans.trim().toLowerCase();
            const isMatch = acceptable.some(acc => acc === cleanAns);
            studentScores[qKey] = isMatch;
            if (isMatch) correctCount++;
          }
        } else if (qType === 'MATCH') {
          const pairs = Array.isArray(q.pairs) ? q.pairs : [];
          if (typeof ans === 'object' && ans !== null && Object.keys(ans).length >= pairs.length) {
            answeredCount++;
            let matchCorrect = true;
            pairs.forEach(p => {
              if ((ans[p.left] || '').trim().toLowerCase() !== (p.right || '').trim().toLowerCase()) {
                matchCorrect = false;
              }
            });
            studentScores[qKey] = matchCorrect;
            if (matchCorrect) correctCount++;
          }
        } else {
          // MC, TF
          if (ans !== undefined && ans !== null && ans !== '') {
            answeredCount++;
            const isCorrect = (ans || '').trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase();
            studentScores[qKey] = isCorrect;
            if (isCorrect) correctCount++;
          }
        }
      });

      if (answeredCount < questions.length) {
        alert("⚠️ Vui lòng trả lời đầy đủ tất cả " + questions.length + " câu hỏi trước khi nộp bài! (Hiện đã chọn: " + answeredCount + "/" + questions.length + " câu)");
        return;
      }

      updateSCORMScore();

      const requiredPass = slide.passScore || Math.max(1, Math.min(questions.length, 4));
      const hasPassed = correctCount >= requiredPass;
      const allowContinueWithoutPass = slide.allowContinueWithoutPass === true;

      if (hasPassed || allowContinueWithoutPass) {
        slidePassed[slideIdx] = true;
        document.getElementById('btnNext').disabled = false;
        document.getElementById('btnNext').title = 'Chuyển sang slide tiếp theo';
        if (document.getElementById('btnFinish')) {
          document.getElementById('btnFinish').disabled = false;
        }

        showGateModal({
          icon: hasPassed ? '🏆' : '📝',
          title: hasPassed ? 'Xuất Sắc! Bạn Đã Đạt Chuẩn Kiến Thức' : 'Đã Hoàn Thành Bài Tập!',
          badgeText: 'Kết quả: ' + correctCount + ' / ' + questions.length + ' câu đúng' + (hasPassed ? ' (Đạt chuẩn)' : ' (Cho phép tiếp tục)'),
          badgeType: hasPassed ? 'success' : 'info',
          desc: hasPassed 
            ? 'Chúc mừng bạn đã nắm vững toàn bộ nội dung trọng tâm. Nút chuyển tiếp slide đã được mở khóa!'
            : 'Bạn đã hoàn thành phần luyện tập / trình bày quan điểm. Bạn có thể tiếp tục bài học mà không bị chặn!',
          actionsHtml: \`
            <button class="btn btn-primary" onclick="closeGateModal(); navigateSlide(1);">
              Tiếp tục bài học ➡️
            </button>
          \`,
          countdown: null
        });

        renderSlide(slideIdx);
      } else {
        const fallbackTarget = Math.max(0, (slide.fallbackSlideIndex || 1) - 1);
        const fallbackSlideNum = fallbackTarget + 1;
        const fallbackTitle = SLIDES[fallbackTarget]?.title || ('Slide ' + fallbackSlideNum);

        delete userGateAnswers[slideIdx];

        showGateModal({
          icon: '⚠️',
          title: 'Chưa Đạt Yêu Cầu Chặn Bài',
          badgeText: 'Kết quả: ' + correctCount + ' / ' + questions.length + ' câu đúng (Cần đạt tối thiểu: ' + requiredPass + '/' + questions.length + ')',
          badgeType: 'fail',
          desc: 'Để đảm bảo chất lượng tiếp thu kiến thức, bạn cần ôn tập lại bài giảng tại: <strong>Slide ' + fallbackSlideNum + ' (' + fallbackTitle + ')</strong>.',
          actionsHtml: \`
            <button class="btn btn-primary" onclick="branchToSlide(\${fallbackTarget})">
              🔄 Quay lại Slide \${fallbackSlideNum} để ôn tập ngay
            </button>
          \`,
          countdown: {
            seconds: 6,
            onExpire: () => branchToSlide(fallbackTarget)
          }
        });
      }
    }

    function showGateModal(cfg) {
      document.getElementById('gateModalIcon').innerText = cfg.icon;
      document.getElementById('gateModalTitle').innerText = cfg.title;
      const badge = document.getElementById('gateModalBadge');
      badge.innerText = cfg.badgeText;
      badge.className = 'gate-modal-badge ' + cfg.badgeType;
      document.getElementById('gateModalDesc').innerHTML = cfg.desc;
      document.getElementById('gateModalActions').innerHTML = cfg.actionsHtml;

      const countdownEl = document.getElementById('gateCountdownText');
      if (gateCountdownTimer) clearInterval(gateCountdownTimer);

      if (cfg.countdown) {
        let remaining = cfg.countdown.seconds;
        countdownEl.innerText = 'Hệ thống tự động chuyển slide sau ' + remaining + ' giây...';
        countdownEl.style.display = 'block';
        gateCountdownTimer = setInterval(() => {
          remaining--;
          if (remaining > 0) {
            countdownEl.innerText = 'Hệ thống tự động chuyển slide sau ' + remaining + ' giây...';
          } else {
            clearInterval(gateCountdownTimer);
            gateCountdownTimer = null;
            cfg.countdown.onExpire();
          }
        }, 1000);
      } else {
        countdownEl.style.display = 'none';
      }

      document.getElementById('gateModalOverlay').classList.add('active');
    }

    function closeGateModal() {
      if (gateCountdownTimer) {
        clearInterval(gateCountdownTimer);
        gateCountdownTimer = null;
      }
      const overlay = document.getElementById('gateModalOverlay');
      if (overlay) overlay.classList.remove('active');
    }

    function branchToSlide(targetIdx) {
      closeGateModal();
      renderSlide(targetIdx);
    }

    function navigateSlide(dir) {
      if (dir > 0) {
        const slide = SLIDES[currentSlideIdx];
        if (slide.isCheckpoint && !slidePassed[currentSlideIdx]) {
          const req = slide.passScore || 4;
          alert("⚠️ Bạn cần làm bài kiểm tra và đạt tối thiểu " + req + " câu đúng để mở khóa slide tiếp theo!");
          return;
        }
      }
      const target = currentSlideIdx + dir;
      if (target >= 0 && target < SLIDES.length) {
        renderSlide(target);
      }
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        const slide = SLIDES[currentSlideIdx];
        if (slide.isCheckpoint && !slidePassed[currentSlideIdx]) {
          e.preventDefault();
          const req = slide.passScore || 4;
          alert("⚠️ Bạn cần làm bài kiểm tra và đạt tối thiểu " + req + " câu đúng để mở khóa slide tiếp theo!");
          return;
        }
        navigateSlide(1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') navigateSlide(-1);
    });

    // Start
    window.addEventListener('DOMContentLoaded', () => {
      initSCORM();
      renderSlide(0);
      updateSCORMScore();

      const narrationAudio = document.getElementById('narrationAudio');
      if (narrationAudio) {
        narrationAudio.addEventListener('play', () => updateSpeakerBtnUI(true));
        narrationAudio.addEventListener('pause', () => updateSpeakerBtnUI(false));
        narrationAudio.addEventListener('ended', () => {
          updateSpeakerBtnUI(false);
          const wave = document.getElementById('speakerWave');
          if (wave) wave.innerText = 'Nghe lại';
        });
      }

      // Suppress duplicate TUAF LMS chatbot bubble if injected into SCORM frame
      function removeDuplicateLmsWidgets() {
        const bubble = document.getElementById('tuaf-widget-bubble');
        if (bubble) bubble.remove();
        const popup = document.getElementById('tuaf-widget-popup');
        if (popup) popup.remove();
      }
      removeDuplicateLmsWidgets();
      setInterval(removeDuplicateLmsWidgets, 300);
    });
  </script>
</body>
</html>`;
}

export async function packageScormZip(lessonTitle: string, lessonId: string, slides: any[], outputStream: any): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(outputStream);

    const assetFiles: string[] = ['index.html'];
    const packagedSlides = slides.map(s => ({ ...s }));

    for (const slide of packagedSlides) {
        // 1. Pack Slide Image into images/
        if (slide.imageUrl) {
            const localImgPath = resolveLocalMediaFile(slide.imageUrl);
            if (localImgPath) {
                const ext = path.extname(localImgPath) || '.png';
                const relativeName = `images/slide_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localImgPath, { name: relativeName });
                slide.imageUrl = relativeName;
                assetFiles.push(relativeName);
            }
        }

        // 2. Pack Narration Audio into audio/
        if (slide.audioUrl) {
            const localAudioPath = resolveLocalMediaFile(slide.audioUrl);
            if (localAudioPath) {
                const ext = path.extname(localAudioPath) || '.mp3';
                const relativeName = `audio/slide_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localAudioPath, { name: relativeName });
                slide.audioUrl = relativeName;
                assetFiles.push(relativeName);
            }
        }

        // 3. Pack Extra Sample Audio into audio/
        if (slide.extraAudioUrl) {
            const localExtraPath = resolveLocalMediaFile(slide.extraAudioUrl);
            if (localExtraPath) {
                const ext = path.extname(localExtraPath) || '.mp3';
                const relativeName = `audio/sample_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localExtraPath, { name: relativeName });
                slide.extraAudioUrl = relativeName;
                assetFiles.push(relativeName);
            }
        }
    }

    const manifestXml = generateScormManifest(lessonId, lessonTitle, assetFiles);
    archive.append(manifestXml, { name: 'imsmanifest.xml' });

    const playerHtml = generateScormPlayerHtml(lessonTitle, packagedSlides);
    archive.append(playerHtml, { name: 'index.html' });

    await archive.finalize();
}
