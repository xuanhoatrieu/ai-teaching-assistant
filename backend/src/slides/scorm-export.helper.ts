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

export interface ScormExportOptions {
    templateId?: string;
    templateName?: string;
    titleBgUrl?: string;
    contentBgUrl?: string;
    bgOption?: string; // 'tuaf_clean' | 'tuaf_full' | 'minimal' | 'custom'
    theme?: string; // 'light' | 'dark'
    hasTitleBg?: boolean;
    hasContentBg?: boolean;
}

export function resolveLocalMediaFile(publicUrl: string): string | null {
    if (!publicUrl) return null;
    const cleanUrl = publicUrl.split('?')[0];

    // Handle /uploads/... path
    if (cleanUrl.startsWith('/uploads')) {
        const p = path.join(process.cwd(), cleanUrl);
        if (fs.existsSync(p)) return p;
    }

    // Handle /files/public/system/templates/{uuid}/{filename}
    const systemTemplateMatch = cleanUrl.match(/^\/files\/public\/system\/templates\/([^/]+)\/(.+)$/);
    if (systemTemplateMatch) {
        const [, templateUuid, filename] = systemTemplateMatch;
        const p = path.join(process.cwd(), 'datauser', 'system', 'templates', templateUuid, filename);
        if (fs.existsSync(p)) return p;
    }

    // Handle /files/public/{userId}/templates/{uuid}/{filename}
    const userTemplateMatch = cleanUrl.match(/^\/files\/public\/([^/]+)\/templates\/([^/]+)\/(.+)$/);
    if (userTemplateMatch) {
        const [, userId, templateUuid, filename] = userTemplateMatch;
        const p = path.join(process.cwd(), 'datauser', userId, 'templates', templateUuid, filename);
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

        // Fallback: check in datauser/system/templates
        const sysDir = path.join(process.cwd(), 'datauser', 'system', 'templates');
        if (fs.existsSync(sysDir)) {
            try {
                const dirs = fs.readdirSync(sysDir);
                for (const d of dirs) {
                    const subPath = path.join(sysDir, d);
                    if (fs.statSync(subPath).isDirectory()) {
                        const isTitle = cleanUrl.includes('1.png') || cleanUrl.includes('title');
                        const candidate = path.join(subPath, isTitle ? 'title_bg.png' : 'content_bg.png');
                        if (fs.existsSync(candidate)) return candidate;
                    }
                }
            } catch {}
        }
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

export function generateScormPlayerHtml(lessonTitle: string, slides: any[], options?: ScormExportOptions): string {
    const bgOption = options?.bgOption || 'tuaf_clean';
    const initialTheme = (options?.theme === 'dark') ? 'dark' : 'light';
    const isMinimal = bgOption === 'minimal';
    const isImageBg = (bgOption === 'tuaf_full' || bgOption === 'custom') && (options?.hasTitleBg || options?.hasContentBg);
    const isTuafClean = !isMinimal && !isImageBg;

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
      --primary: #005a36;
      --primary-light: #ecfdf5;
      --primary-dark: #003d24;
      --success: #10b981;
      --success-light: #d1fae5;
      --danger: #ef4444;
      --danger-light: #fee2e2;
      --tuaf-green: #005a36;
      --tuaf-dark-green: #003d24;
      --tuaf-gold: #b45309;
    }

    /* Light Theme (TUAF Academic Light - Default) */
    body.theme-light {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --card-border: #e2e8f0;
      --card-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.08);
      --text-main: #0f172a;
      --text-sub: #334155;
      --header-bg: rgba(255, 255, 255, 0.95);
      --header-border: #e2e8f0;
      --slide-title-color: #004d2c;
      --bullet-bg: #ffffff;
      --bullet-border: #e2e8f0;
      --bullet-point: #0f172a;
      --bullet-desc: #334155;
      --btn-sec-bg: #f1f5f9;
      --btn-sec-color: #1e293b;
      --btn-sec-border: #cbd5e1;
      --btn-pri-bg: #005a36;
      --btn-pri-hover: #004328;
    }

    /* Dark Theme (Modern Dark) */
    body.theme-dark {
      --bg: #0b1120;
      --card-bg: #1e293b;
      --card-border: #334155;
      --card-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.4);
      --text-main: #f8fafc;
      --text-sub: #cbd5e1;
      --header-bg: rgba(30, 41, 59, 0.9);
      --header-border: #334155;
      --slide-title-color: #ffffff;
      --bullet-bg: rgba(255, 255, 255, 0.03);
      --bullet-border: rgba(255, 255, 255, 0.06);
      --bullet-point: #f1f5f9;
      --bullet-desc: #94a3b8;
      --btn-sec-bg: rgba(255, 255, 255, 0.08);
      --btn-sec-color: #e2e8f0;
      --btn-sec-border: rgba(255, 255, 255, 0.15);
      --btn-pri-bg: #2d6a4f;
      --btn-pri-hover: #1b4332;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    /* Header Bar */
    header {
      background: var(--header-bg);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--header-border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
      transition: background 0.25s ease, border-color 0.25s ease;
    }
    .header-title-wrapper {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .tuaf-header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 8px;
      flex-shrink: 0;
    }
    body.theme-light .tuaf-header-brand {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
    }
    body.theme-dark .tuaf-header-brand {
      background: rgba(45, 106, 79, 0.25);
      border: 1px solid rgba(82, 183, 136, 0.4);
    }
    .tuaf-brand-icon {
      font-size: 1.15rem;
    }
    .tuaf-brand-text {
      display: flex;
      flex-direction: column;
      line-height: 1.1;
    }
    .tuaf-brand-title {
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.5px;
    }
    body.theme-light .tuaf-brand-title { color: #065f46; }
    body.theme-dark .tuaf-brand-title { color: #95d5b2; }

    .tuaf-brand-sub {
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    body.theme-light .tuaf-brand-sub { color: #047857; }
    body.theme-dark .tuaf-brand-sub { color: #74c69d; }

    .tuaf-header-sep {
      width: 1px;
      height: 22px;
      flex-shrink: 0;
    }
    body.theme-light .tuaf-header-sep { background: #cbd5e1; }
    body.theme-dark .tuaf-header-sep { background: rgba(255, 255, 255, 0.15); }

    .header-title {
      font-size: 1.1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .lesson-header-text {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 480px;
    }
    .header-controls {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .theme-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--card-border);
      transition: all 0.2s ease;
    }
    body.theme-light .theme-toggle-btn {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    body.theme-light .theme-toggle-btn:hover {
      background: #ecfdf5;
      border-color: #005a36;
      color: #005a36;
    }
    body.theme-dark .theme-toggle-btn {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      color: #f8fafc;
    }
    body.theme-dark .theme-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .score-badge {
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    body.theme-light .score-badge {
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
    }
    body.theme-dark .score-badge {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
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
      background: rgba(0, 0, 0, 0.08);
      width: 100%;
    }
    body.theme-dark .progress-track {
      background: rgba(255, 255, 255, 0.1);
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #005a36, #10b981);
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

    /* Slide Card Base */
    .slide-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 28px;
      box-shadow: var(--card-shadow);
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-height: 520px;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .slide-body-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      width: 100%;
      min-height: 0;
    }
    .slide-body-container.title-slide-body {
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .slide-body-container.title-slide-body .title-slide-hero {
      max-width: 900px;
      margin: 0 auto 16px auto;
    }

    /* TUAF Clean Mode (Maximum presentation area + subtle branding) */
    .mode-tuaf-clean .slide-card {
      border-top: 4px solid #005a36;
    }

    body.theme-light.mode-tuaf-clean .slide-card.is-title-slide {
      background: radial-gradient(circle at 90% 10%, rgba(0, 90, 54, 0.08) 0%, #ffffff 75%);
      border: 1px solid rgba(0, 90, 54, 0.2);
      border-top: 6px solid #005a36;
    }
    body.theme-dark.mode-tuaf-clean .slide-card.is-title-slide {
      background: radial-gradient(circle at 90% 10%, rgba(45, 106, 79, 0.4) 0%, rgba(15, 23, 42, 0.98) 75%);
      border: 1px solid rgba(82, 183, 136, 0.35);
      border-top: 6px solid #52b788;
    }

    /* Title Slide Specific Elements */
    .title-slide-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
    }
    body.theme-light .title-slide-badge {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }
    body.theme-dark .title-slide-badge {
      background: rgba(45, 106, 79, 0.3);
      border: 1px solid rgba(82, 183, 136, 0.4);
      color: #95d5b2;
    }
    .title-slide-badge .badge-sub {
      font-size: 0.72rem;
      font-weight: 500;
      padding-left: 8px;
      margin-left: 4px;
    }
    body.theme-light .title-slide-badge .badge-sub {
      color: #047857;
      border-left: 1px solid #a7f3d0;
    }
    body.theme-dark .title-slide-badge .badge-sub {
      color: rgba(255, 255, 255, 0.6);
      border-left: 1px solid rgba(255, 255, 255, 0.2);
    }
    .title-slide-hero {
      margin-bottom: 20px;
    }
    .title-slide-main-heading {
      font-size: 2.2rem;
      font-weight: 800;
      line-height: 1.25;
      margin-top: 10px;
      margin-bottom: 10px;
    }
    body.theme-light .title-slide-main-heading {
      color: #004d2c;
    }
    body.theme-dark .title-slide-main-heading {
      color: #ffffff;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
    }
    .title-slide-desc {
      font-size: 1.05rem;
      line-height: 1.5;
    }
    body.theme-light .title-slide-desc {
      color: #334155;
    }
    body.theme-dark .title-slide-desc {
      color: #cbd5e1;
    }

    /* Full Image Background Mode */
    body.theme-light.mode-has-image-bg .slide-card.is-title-slide {
      background: url('images/bg_title.png') center / cover no-repeat;
      border: 1px solid rgba(0, 90, 54, 0.2);
    }
    body.theme-light.mode-has-image-bg .slide-card.is-content-slide {
      background: url('images/bg_content.png') center / cover no-repeat;
      border: 1px solid #e2e8f0;
    }
    body.theme-light.mode-has-image-bg .slide-content-grid .bullets-list,
    body.theme-light.mode-has-image-bg .audio-lab-container .bullets-list {
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(8px);
      border-radius: 14px;
      padding: 20px;
      border: 1px solid rgba(0, 90, 54, 0.16);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
    }
    body.theme-light.mode-has-image-bg .title-slide-hero {
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(8px);
      padding: 22px 26px;
      border-radius: 16px;
      border: 1px solid rgba(0, 90, 54, 0.18);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
    }
    body.theme-light.mode-has-image-bg .slide-top-header {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(6px);
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid rgba(0, 90, 54, 0.12);
    }

    body.theme-dark.mode-has-image-bg .slide-card.is-title-slide {
      background: linear-gradient(rgba(15, 23, 42, 0.75), rgba(15, 23, 42, 0.92)), url('images/bg_title.png') center / cover no-repeat;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    body.theme-dark.mode-has-image-bg .slide-card.is-content-slide {
      background: linear-gradient(rgba(30, 41, 59, 0.9), rgba(30, 41, 59, 0.96)), url('images/bg_content.png') center / cover no-repeat;
      border: 1px solid rgba(255, 255, 255, 0.12);
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
      align-items: center;
      width: 100%;
      margin: auto 0;
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
      align-items: center;
      margin: auto 0;
    }
    @media (max-width: 860px) {
      .slide-content-grid.layout-split-reversed { grid-template-columns: 1fr; }
    }

    /* Layout when slide has no image (Center text block gracefully) */
    .slide-content-grid.no-media {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      margin: auto 0;
    }
    .slide-content-grid.no-media .bullets-list {
      max-width: 860px;
      width: 100%;
    }

    /* Layout: Comparison 3 Columns (Bento Cards) */
    .layout-comparison-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      width: 100%;
      margin: auto 0;
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
      margin: auto 0;
    }
    .hero-media-box {
      width: 100%;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(15, 23, 42, 0.6);
      max-height: 480px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-media-box img {
      max-width: 100%;
      max-height: 480px;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 14px;
      display: block;
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
      margin: auto 0 auto 20px;
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
      background: rgba(15, 23, 42, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: 480px;
      width: 100%;
    }
    .slide-media-box img {
      max-width: 100%;
      max-height: 480px;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 12px;
      display: block;
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
    .qtype-tag.order { background: rgba(20, 184, 166, 0.2); color: #5eead4; border: 1px solid rgba(20, 184, 166, 0.35); }
    .qtype-tag.cloze { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.35); }

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

    /* ORDER Interactive (Put words in correct order) */
    .order-interactive-wrapper {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 10px;
    }
    .order-sentence-zone {
      min-height: 54px;
      border: 2px dashed rgba(99, 102, 241, 0.4);
      background: rgba(15, 23, 42, 0.4);
      border-radius: 12px;
      padding: 10px 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      transition: all 0.2s ease;
    }
    .order-sentence-zone:empty::before {
      content: attr(data-placeholder);
      color: var(--text-sub);
      font-size: 0.9rem;
      font-style: italic;
    }
    .order-word-pool {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      min-height: 52px;
      align-items: center;
    }
    .word-pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      background: rgba(30, 41, 59, 0.85);
      border: 1.5px solid rgba(99, 102, 241, 0.35);
      color: #f8fafc;
      border-radius: 20px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }
    .word-pill:hover {
      transform: translateY(-2px);
      border-color: #10b981;
      color: #10b981;
    }
    .word-pill.in-zone {
      background: #005a36;
      border-color: #10b981;
      color: #ffffff;
    }
    .word-pill.correct {
      background: #059669 !important;
      border-color: #10b981 !important;
      color: #ffffff !important;
    }
    .word-pill.wrong {
      background: #dc2626 !important;
      border-color: #ef4444 !important;
      color: #ffffff !important;
    }
    .order-actions-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 4px;
    }

    /* CLOZE Interactive (Inline passage/dialogue blanks) */
    .cloze-interactive-wrapper {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 10px;
    }
    .cloze-word-bank {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 0.9rem;
      color: var(--text-sub);
    }
    .cloze-bank-title {
      font-weight: 700;
      margin-right: 6px;
    }
    .cloze-bank-pill {
      display: inline-block;
      padding: 3px 10px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .cloze-passage-box {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 18px 22px;
      font-size: 1.05rem;
      line-height: 2.2;
      color: #f1f5f9;
    }
    .cloze-dialogue-line {
      margin-bottom: 8px;
    }
    .cloze-speaker {
      font-weight: 700;
      color: #34d399;
      margin-right: 8px;
    }
    .cloze-inline-input {
      display: inline-block;
      min-width: 90px;
      max-width: 170px;
      padding: 4px 10px;
      margin: 0 4px;
      background: rgba(15, 23, 42, 0.85);
      border: 1.5px solid rgba(99, 102, 241, 0.4);
      border-radius: 6px;
      color: #ffffff;
      font-size: 1rem;
      font-weight: 600;
      text-align: center;
      outline: none;
      transition: all 0.2s;
    }
    .cloze-inline-input:focus {
      border-color: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25);
    }
    .cloze-inline-input.correct {
      border-color: #10b981 !important;
      background: rgba(16, 185, 129, 0.15) !important;
      color: #6ee7b7 !important;
    }
    .cloze-inline-input.wrong {
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
    /* ========================================================
       LIGHT THEME ACCESSIBLE CONTRAST ENHANCEMENTS (WCAG AAA)
       ======================================================== */
    body.theme-light .slide-title { color: #004d2c; }
    body.theme-light .slide-top-header { border-bottom-color: #e2e8f0; }
    body.theme-light .bullet-item {
      background: #ffffff;
      border: 1.5px solid #e2e8f0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    }
    body.theme-light .bullet-item:hover {
      background: #f0fdf4;
      border-color: #005a36;
    }
    body.theme-light .bullet-point { color: #0f172a; font-weight: 700; }
    body.theme-light .bullet-desc { color: #334155; }
    body.theme-light .speaker-btn {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    body.theme-light .speaker-btn:hover {
      background: #d1fae5;
      border-color: #34d399;
      color: #004d2c;
    }
    body.theme-light .speaker-btn.playing {
      background: #d1fae5;
      border-color: #059669;
      color: #047857;
    }
    body.theme-light .slide-media-box,
    body.theme-light .hero-media-box {
      background: #f8fafc;
      border-color: #e2e8f0;
    }
    body.theme-light .comparison-card {
      background: #ffffff;
      border: 1.5px solid #e2e8f0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    }
    body.theme-light .comparison-card-header {
      color: #0f172a;
      border-bottom-color: #f1f5f9;
    }
    body.theme-light .comparison-card-desc { color: #334155; }
    body.theme-light .process-steps-container { border-left-color: rgba(0, 90, 54, 0.4); }
    body.theme-light .process-step-item {
      background: #ffffff;
      border: 1.5px solid #e2e8f0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    }
    body.theme-light .process-step-item:hover {
      background: #f0fdf4;
      border-color: #005a36;
    }
    body.theme-light .process-step-node {
      background: #005a36;
      color: #ffffff;
      box-shadow: 0 0 0 4px #ffffff;
    }
    body.theme-light .process-step-title { color: #0f172a; }
    body.theme-light .process-step-desc { color: #334155; }
    body.theme-light .sample-audio-card {
      background: #ecfdf5;
      border-color: #a7f3d0;
    }
    body.theme-light .sample-audio-title { color: #065f46; }
    body.theme-light .sample-audio-player { accent-color: #005a36; }
    body.theme-light .interaction-card {
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.05);
    }
    body.theme-light .interaction-header { border-bottom-color: #e2e8f0; }
    body.theme-light .interaction-header-left { color: #005a36; }
    body.theme-light .interaction-instruction { color: #475569; }
    body.theme-light .question-block {
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
    }
    body.theme-light .question-prompt { color: #0f172a; }
    body.theme-light .option-btn {
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      color: #1e293b;
    }
    body.theme-light .option-btn:hover:not(:disabled) {
      background: #f0fdf4;
      border-color: #005a36;
      color: #005a36;
    }
    body.theme-light .option-btn.selected {
      background: #ecfdf5 !important;
      border-color: #005a36 !important;
      color: #065f46 !important;
      box-shadow: 0 0 0 2px rgba(0, 90, 54, 0.25) !important;
    }
    body.theme-light .option-btn.correct {
      background: #d1fae5 !important;
      border-color: #10b981 !important;
      color: #065f46 !important;
    }
    body.theme-light .option-btn.wrong {
      background: #fee2e2 !important;
      border-color: #ef4444 !important;
      color: #991b1b !important;
    }
    body.theme-light .explanation-box {
      background: #f1f5f9;
      border-left-color: #005a36;
      color: #334155;
    }
    body.theme-light .qtype-tag.mc { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    body.theme-light .qtype-tag.tf { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
    body.theme-light .qtype-tag.mr { background: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff; }
    body.theme-light .qtype-tag.fib { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    body.theme-light .qtype-tag.match { background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; }
    body.theme-light .qtype-tag.order { background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc; }
    body.theme-light .qtype-tag.cloze { background: #fdf4ff; color: #a21caf; border: 1px solid #f0abfc; }
    body.theme-light .order-interactive-wrapper,
    body.theme-light .cloze-interactive-wrapper {
      background: #ffffff;
      border-color: #e2e8f0;
    }
    body.theme-light .order-sentence-zone {
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    body.theme-light .order-word-pool {
      background: #f1f5f9;
      border-color: #e2e8f0;
    }
    body.theme-light .word-pill {
      background: #ffffff;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    body.theme-light .word-pill:hover {
      background: #f0fdf4;
      border-color: #005a36;
      color: #005a36;
    }
    body.theme-light .word-pill.in-zone,
    body.theme-light .word-pill.picked {
      background: #005a36;
      border-color: #005a36;
      color: #ffffff;
    }
    body.theme-light .cloze-word-bank {
      background: #f1f5f9;
      border-color: #e2e8f0;
      color: #334155;
    }
    body.theme-light .cloze-bank-pill {
      background: #e2e8f0;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    body.theme-light .cloze-passage-box {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #1e293b;
    }
    body.theme-light .cloze-speaker {
      color: #005a36;
    }
    body.theme-light .cloze-inline-input {
      background: #ffffff;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    body.theme-light .cloze-inline-input:focus {
      border-color: #005a36;
      box-shadow: 0 0 0 2px rgba(0, 90, 54, 0.2);
    }
    body.theme-light .cloze-inline-input.correct {
      border-color: #10b981 !important;
      background: #d1fae5 !important;
      color: #065f46 !important;
    }
    body.theme-light .cloze-inline-input.wrong {
      border-color: #ef4444 !important;
      background: #fee2e2 !important;
      color: #991b1b !important;
    }
    body.theme-light .match-row {
      background: #ffffff;
      border-color: #e2e8f0;
    }
    body.theme-light .match-left { color: #0f172a; }
    body.theme-light .match-arrow { color: #005a36; }
    body.theme-light .match-select {
      background: #ffffff;
      color: #0f172a;
      border-color: #cbd5e1;
    }
    body.theme-light .cb-indicator {
      border-color: #94a3b8;
      background: #f8fafc;
    }
    body.theme-light .option-btn.selected .cb-indicator {
      background: #005a36;
      border-color: #005a36;
      color: #ffffff;
    }
    body.theme-light .fib-input {
      background: #ffffff;
      color: #0f172a;
      border-color: #cbd5e1;
    }
    body.theme-light .fib-input:focus {
      border-color: #005a36;
      box-shadow: 0 0 0 3px rgba(0, 90, 54, 0.2);
    }
    body.theme-light .gate-action-bar {
      background: #f8fafc;
      border-color: #005a36;
    }
    body.theme-light .gate-status-text { color: #334155; }
    body.theme-light .gate-modal-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
    }
    body.theme-light .gate-modal-title { color: #0f172a; }
    body.theme-light .gate-modal-desc { color: #334155; }
    body.theme-light footer {
      background: rgba(255, 255, 255, 0.95);
      border-top-color: #e2e8f0;
    }
    body.theme-light .btn-secondary {
      background: #f1f5f9;
      color: #1e293b;
      border-color: #cbd5e1;
    }
    body.theme-light .btn-secondary:hover:not(:disabled) {
      background: #e2e8f0;
      color: #0f172a;
    }
    body.theme-light .btn-primary {
      background: #005a36;
      color: #ffffff;
    }
    body.theme-light .btn-primary:hover:not(:disabled) {
      background: #004328;
    }
    body.theme-light .slide-counter { color: #475569; }

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
<body class="theme-${initialTheme} ${isTuafClean ? 'mode-tuaf-clean' : ''} ${isImageBg ? 'mode-has-image-bg' : ''} ${isMinimal ? 'mode-minimal' : ''}">

  <!-- Header -->
  <header>
    ${!isMinimal ? `
    <div class="header-title-wrapper">
      <div class="tuaf-header-brand">
        <span class="tuaf-brand-icon">🌿</span>
        <div class="tuaf-brand-text">
          <span class="tuaf-brand-title">ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN</span>
          <span class="tuaf-brand-sub">HỌC LIỆU SỐ TƯƠNG TÁC • TUAF</span>
        </div>
      </div>
      <div class="tuaf-header-sep"></div>
      <div class="header-title">
        <span>📖</span>
        <span class="lesson-header-text">${escapeXml(lessonTitle)}</span>
      </div>
    </div>
    ` : `
    <div class="header-title">
      <span>🎓</span>
      <span class="lesson-header-text">${escapeXml(lessonTitle)}</span>
    </div>
    `}
    <div class="header-controls">
      <button class="theme-toggle-btn" id="themeToggleBtn" onclick="toggleTheme()" title="Chuyển chế độ Sáng / Tối">
        <span id="themeIcon">${initialTheme === 'dark' ? '🌙' : '☀️'}</span>
        <span id="themeLabel">${initialTheme === 'dark' ? 'Tối' : 'Sáng'}</span>
      </button>
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
          } else if (qType === 'ORDER') {
            typeBadgeHtml = '<span class="qtype-tag order">Sắp xếp từ</span>';
          } else if (qType === 'CLOZE') {
            typeBadgeHtml = '<span class="qtype-tag cloze">Điền khuyết hội thoại</span>';
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

          } else if (qType === 'ORDER') {
            // Put words in correct order
            const rawWords = (Array.isArray(q.words) && q.words.length > 0)
              ? q.words
              : (q.correctSentence || '').trim().split(/\\s+/);
            const correctJson = encodeURIComponent(JSON.stringify(q.correctSentence || rawWords.join(' ')));
            const savedSentence = (typeof selectedVal === 'string') ? selectedVal.trim() : '';
            const pickedWords = savedSentence ? savedSentence.split(/\\s+/) : [];

            let tempWords = [...rawWords].sort(() => 0.5 - Math.random());
            let pickedHtml = '';
            let poolHtml = '';

            if (pickedWords.length > 0) {
              pickedHtml = pickedWords.map((w) => {
                return \`<button type="button" class="word-pill in-zone" data-word="\${encodeURIComponent(w)}" onclick="unpickOrderWord('\${qKey}', this, \${isGated ? 1 : 0}, \${idx})">\${w} ✕</button>\`;
              }).join('');
              let remainPool = [...tempWords];
              pickedWords.forEach(pw => {
                const fIdx = remainPool.findIndex(rw => rw.toLowerCase() === pw.toLowerCase());
                if (fIdx > -1) remainPool.splice(fIdx, 1);
              });
              poolHtml = remainPool.map((w) => {
                return \`<button type="button" class="word-pill" data-word="\${encodeURIComponent(w)}" onclick="pickOrderWord('\${qKey}', this, \${isGated ? 1 : 0}, \${idx})">\${w}</button>\`;
              }).join('');
            } else {
              poolHtml = tempWords.map((w) => {
                return \`<button type="button" class="word-pill" data-word="\${encodeURIComponent(w)}" onclick="pickOrderWord('\${qKey}', this, \${isGated ? 1 : 0}, \${idx})">\${w}</button>\`;
              }).join('');
            }

            const practiceCheckBtn = !isGated ? \`
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;" onclick="checkOrderPracticeAnswer('\${qKey}', '\${correctJson}', this, 'expl_\${qKey}')">
                  🔍 Kiểm tra câu sắp xếp
                </button>
              </div>
            \` : '';

            bodyHtml = \`
              <div class="order-interactive-wrapper" id="order_wrap_\${qKey}" data-correct="\${correctJson}">
                <div class="order-zone-label" style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; font-weight: 600;">
                  <span>✏️ Câu bạn sắp xếp (nhấp từ để bỏ ra):</span>
                  <button type="button" class="btn btn-secondary" style="font-size: 0.8rem; padding: 3px 10px;" onclick="resetOrderWords('\${qKey}', \${isGated ? 1 : 0}, \${idx})">🔄 Đặt lại</button>
                </div>
                <div class="order-sentence-zone" id="sentence_zone_\${qKey}" data-placeholder="Nhấp các từ bên dưới theo thứ tự đúng để tạo câu...">
                  \${pickedHtml}
                </div>
                <div class="order-pool-label" style="font-size: 0.9rem; font-weight: 600; margin-top: 4px;">
                  <span>📦 Kho từ ngữ (nhấp từ để ghép vào câu):</span>
                </div>
                <div class="order-word-pool" id="word_pool_\${qKey}">
                  \${poolHtml}
                </div>
              </div>
              \${practiceCheckBtn}
            \`;

          } else if (qType === 'CLOZE') {
            // Dialogue or passage with inline blanks [answer]
            const rawPassage = q.passage || q.questionText || q.question || '';
            const passageLines = rawPassage.split(/\\r?\\n/);
            let blankCounter = 0;
            const hintWords = [];
            const userAnswersObj = (typeof selectedVal === 'object' && selectedVal !== null) ? selectedVal : {};

            const passageHtml = passageLines.map(line => {
              const trimmed = line.trim();
              if (!trimmed) return '<div style="height: 10px;"></div>';

              let speakerPrefix = '';
              let lineContent = line;
              const speakerMatch = line.match(/^([A-Za-z0-9_\\sÀ-ỹ]{1,20}):\\s*(.*)$/);
              if (speakerMatch) {
                speakerPrefix = \`<span class="cloze-speaker">\${speakerMatch[1]}:</span>\`;
                lineContent = speakerMatch[2];
              }

              const formattedLine = lineContent.replace(/\\[([^\\]]+)\\]/g, (match, p1) => {
                const bIdx = blankCounter++;
                const acceptable = p1.split('|').map(s => s.trim());
                acceptable.forEach(w => {
                  if (!hintWords.includes(w)) hintWords.push(w);
                });
                const userVal = userAnswersObj[bIdx] || '';
                const correctAttr = encodeURIComponent(JSON.stringify(acceptable));

                if (isGated) {
                  return \`<input type="text" class="cloze-inline-input" data-blank-idx="\${bIdx}" value="\${userVal}" oninput="recordGateCloze('\${qKey}', \${bIdx}, this.value, \${idx})" placeholder="(\${bIdx + 1})" />\`;
                } else {
                  return \`<input type="text" class="cloze-inline-input" data-blank-idx="\${bIdx}" data-correct="\${correctAttr}" placeholder="(\${bIdx + 1})" />\`;
                }
              });

              return \`
                <div class="cloze-dialogue-line">
                  \${speakerPrefix}
                  <span class="cloze-line-text">\${formattedLine}</span>
                </div>
              \`;
            }).join('');

            const shuffledHints = [...hintWords].sort(() => 0.5 - Math.random());
            const wordBankHtml = shuffledHints.length > 0 ? \`
              <div class="cloze-word-bank">
                <span class="cloze-bank-title">🔤 Từ gợi ý (Word Bank):</span>
                \${shuffledHints.map(h => \`<span class="cloze-bank-pill">\${h}</span>\`).join('')}
              </div>
            \` : '';

            const practiceCheckBtn = !isGated ? \`
              <div style="margin-top: 10px;">
                <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;" onclick="checkClozePracticeAnswer('\${qKey}', this, 'expl_\${qKey}')">
                  🔍 Kiểm tra các chỗ trống
                </button>
              </div>
            \` : '';

            bodyHtml = \`
              <div class="cloze-interactive-wrapper" id="cloze_wrap_\${qKey}">
                \${wordBankHtml}
                <div class="cloze-passage-box">
                  \${passageHtml}
                </div>
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
          <div class="slide-content-grid layout-split-reversed \${!mediaHtml ? 'no-media' : ''}">
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
          <div class="\${bulletsHtml ? 'slide-content-grid' : 'slide-content-grid single-media'} \${!mediaHtml ? 'no-media' : ''}">
            \${bulletsHtml ? \`<div class="bullets-list">\${bulletsHtml}</div>\` : ''}
            \${mediaHtml}
          </div>
          \${sampleAudioHtml}
          \${interactionHtml}
        \`;
      }

      // Construct Slide HTML
      const slideCard = document.getElementById('slideCard');
      slideCard.className = 'slide-card ' + (idx === 0 ? 'is-title-slide' : 'is-content-slide');

      if (idx === 0) {
        slideCard.innerHTML = \`
          <div class="slide-top-header title-slide-top">
            <div class="title-slide-badge">
              <span>🌱 ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN</span>
              <span class="badge-sub">BÀI GIẢNG ĐIỆN TỬ</span>
            </div>
            \${speakerBtnHtml}
          </div>
          <div class="slide-body-container title-slide-body">
            <div class="title-slide-hero">
              <h1 class="title-slide-main-heading">\${slide.title}</h1>
              \${slide.speakerNote ? \`<p class="title-slide-desc">\${slide.speakerNote}</p>\` : ''}
            </div>
            \${layoutBodyHtml}
          </div>
        \`;
      } else {
        slideCard.innerHTML = \`
          <div class="slide-top-header">
            <h2 class="slide-title">\${slide.title}</h2>
            \${speakerBtnHtml}
          </div>
          <div class="slide-body-container">
            \${layoutBodyHtml}
          </div>
        \`;
      }

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

    // ORDER helper functions
    function getSentenceFromZone(qKey) {
      const zone = document.getElementById('sentence_zone_' + qKey);
      if (!zone) return '';
      const pills = zone.querySelectorAll('.word-pill');
      return Array.from(pills).map(p => decodeURIComponent(p.getAttribute('data-word') || '')).join(' ');
    }

    function pickOrderWord(qKey, pillEl, isGated, slideIdx) {
      const zone = document.getElementById('sentence_zone_' + qKey);
      if (!zone) return;
      pillEl.classList.add('in-zone');
      pillEl.innerHTML = decodeURIComponent(pillEl.getAttribute('data-word') || '') + ' ✕';
      pillEl.onclick = function() { unpickOrderWord(qKey, pillEl, isGated, slideIdx); };
      zone.appendChild(pillEl);
      zone.classList.remove('correct', 'wrong');

      const assembled = getSentenceFromZone(qKey);
      if (isGated) {
        if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
        userGateAnswers[slideIdx][qKey] = assembled;
      }
    }

    function unpickOrderWord(qKey, pillEl, isGated, slideIdx) {
      const pool = document.getElementById('word_pool_' + qKey);
      const zone = document.getElementById('sentence_zone_' + qKey);
      if (!pool) return;
      pillEl.classList.remove('in-zone');
      pillEl.innerHTML = decodeURIComponent(pillEl.getAttribute('data-word') || '');
      pillEl.onclick = function() { pickOrderWord(qKey, pillEl, isGated, slideIdx); };
      pool.appendChild(pillEl);
      if (zone) zone.classList.remove('correct', 'wrong');

      const assembled = getSentenceFromZone(qKey);
      if (isGated) {
        if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
        userGateAnswers[slideIdx][qKey] = assembled;
      }
    }

    function resetOrderWords(qKey, isGated, slideIdx) {
      const zone = document.getElementById('sentence_zone_' + qKey);
      const pool = document.getElementById('word_pool_' + qKey);
      if (!zone || !pool) return;
      const pills = Array.from(zone.querySelectorAll('.word-pill'));
      pills.forEach(pillEl => {
        pillEl.classList.remove('in-zone');
        pillEl.innerHTML = decodeURIComponent(pillEl.getAttribute('data-word') || '');
        pillEl.onclick = function() { pickOrderWord(qKey, pillEl, isGated, slideIdx); };
        pool.appendChild(pillEl);
      });
      zone.classList.remove('correct', 'wrong');
      if (isGated && userGateAnswers[slideIdx]) {
        userGateAnswers[slideIdx][qKey] = '';
      }
    }

    function checkOrderPracticeAnswer(qKey, correctJson, btnEl, explId) {
      const correctSentence = JSON.parse(decodeURIComponent(correctJson));
      const userSentence = getSentenceFromZone(qKey);
      const norm = function(s) {
        return (s || '').trim().toLowerCase().replace(/[.,!?;:]+$/, '').replace(/\\s+/g, ' ');
      };
      const isMatch = norm(userSentence) === norm(correctSentence);
      studentScores[qKey] = isMatch;

      const zone = document.getElementById('sentence_zone_' + qKey);
      if (zone) {
        zone.classList.remove('correct', 'wrong');
        zone.classList.add(isMatch ? 'correct' : 'wrong');
      }

      const expl = document.getElementById(explId);
      if (expl) expl.classList.add('show');
      updateSCORMScore();
    }

    // CLOZE helper functions
    function recordGateCloze(qKey, bIdx, val, slideIdx) {
      if (!userGateAnswers[slideIdx]) userGateAnswers[slideIdx] = {};
      if (!userGateAnswers[slideIdx][qKey] || typeof userGateAnswers[slideIdx][qKey] !== 'object') {
        userGateAnswers[slideIdx][qKey] = {};
      }
      userGateAnswers[slideIdx][qKey][bIdx] = val;
    }

    function checkClozePracticeAnswer(qKey, btnEl, explId) {
      const container = document.getElementById('cloze_wrap_' + qKey);
      if (!container) return;
      const inputs = container.querySelectorAll('.cloze-inline-input');
      let allCorrect = true;
      inputs.forEach(inp => {
        const correctList = JSON.parse(decodeURIComponent(inp.getAttribute('data-correct') || '[]'));
        const userVal = (inp.value || '').trim().toLowerCase();
        const acceptable = correctList.map(c => (c || '').trim().toLowerCase());
        inp.classList.remove('correct', 'wrong');
        if (acceptable.includes(userVal)) {
          inp.classList.add('correct');
        } else {
          inp.classList.add('wrong');
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
        } else if (qType === 'ORDER') {
          const rawWords = (Array.isArray(q.words) && q.words.length > 0)
            ? q.words
            : (q.correctSentence || '').trim().split(/\\s+/);
          const norm = function(s) {
            return (s || '').trim().toLowerCase().replace(/[.,!?;:]+$/, '').replace(/\\s+/g, ' ');
          };
          const expected = norm(q.correctSentence || rawWords.join(' '));
          if (typeof ans === 'string' && ans.trim() !== '') {
            answeredCount++;
            const isMatch = norm(ans) === expected;
            studentScores[qKey] = isMatch;
            if (isMatch) correctCount++;
          }
        } else if (qType === 'CLOZE') {
          const rawPassage = q.passage || q.questionText || q.question || '';
          const matches = [...rawPassage.matchAll(/\\[([^\\]]+)\\]/g)];
          const totalBlanks = matches.length;
          const userBlanks = (typeof ans === 'object' && ans !== null) ? ans : {};
          const filledCount = Object.keys(userBlanks).filter(k => (userBlanks[k] || '').trim() !== '').length;
          if (totalBlanks > 0 && filledCount >= totalBlanks) {
            answeredCount++;
            let allCorrect = true;
            matches.forEach((m, bIdx) => {
              const acceptable = m[1].split('|').map(s => s.trim().toLowerCase());
              const userVal = (userBlanks[bIdx] || '').trim().toLowerCase();
              if (!acceptable.includes(userVal)) {
                allCorrect = false;
              }
            });
            studentScores[qKey] = allCorrect;
            if (allCorrect) correctCount++;
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

      // Theme Switch Logic
      const defaultTheme = '${initialTheme}';
      let currentTheme = defaultTheme;
      try {
        const saved = sessionStorage.getItem('scorm_theme_override');
        if (saved === 'light' || saved === 'dark') {
          currentTheme = saved;
        }
      } catch (e) {}

      window.applyTheme = function(theme) {
        currentTheme = theme;
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        if (theme === 'dark') {
          document.body.classList.remove('theme-light');
          document.body.classList.add('theme-dark');
          if (icon) icon.innerText = '🌙';
          if (label) label.innerText = 'Tối';
        } else {
          document.body.classList.remove('theme-dark');
          document.body.classList.add('theme-light');
          if (icon) icon.innerText = '☀️';
          if (label) label.innerText = 'Sáng';
        }
      };

      window.toggleTheme = function() {
        const next = currentTheme === 'light' ? 'dark' : 'light';
        window.applyTheme(next);
        try {
          sessionStorage.setItem('scorm_theme_override', next);
        } catch (e) {}
      };

      window.applyTheme(currentTheme);

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

export async function packageScormZip(
    lessonTitle: string, 
    lessonId: string, 
    slides: any[], 
    outputStream: any,
    options?: ScormExportOptions
): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(outputStream);

    const assetFiles: string[] = ['index.html'];
    const packagedSlides = slides.map(s => ({ ...s }));
    const opts: ScormExportOptions = { ...(options || {}) };

    // Pack background images if full image mode or custom template requested
    if (opts.bgOption === 'tuaf_full' || (opts.bgOption === 'custom' && (opts.titleBgUrl || opts.contentBgUrl))) {
        if (opts.titleBgUrl) {
            const resolvedTitleBg = resolveLocalMediaFile(opts.titleBgUrl);
            if (resolvedTitleBg && fs.existsSync(resolvedTitleBg)) {
                archive.file(resolvedTitleBg, { name: 'images/bg_title.png' });
                assetFiles.push('images/bg_title.png');
                opts.hasTitleBg = true;
            }
        }
        if (opts.contentBgUrl) {
            const resolvedContentBg = resolveLocalMediaFile(opts.contentBgUrl);
            if (resolvedContentBg && fs.existsSync(resolvedContentBg)) {
                archive.file(resolvedContentBg, { name: 'images/bg_content.png' });
                assetFiles.push('images/bg_content.png');
                opts.hasContentBg = true;
            }
        }
    }

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

    const playerHtml = generateScormPlayerHtml(lessonTitle, packagedSlides, opts);
    archive.append(playerHtml, { name: 'index.html' });

    await archive.finalize();
}
