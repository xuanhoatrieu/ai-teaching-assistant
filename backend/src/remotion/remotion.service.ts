import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { TTSService } from '../tts/tts.service';
import { ImagenService } from '../ai/imagen.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import {
  CreateRemotionVideoDto,
  UpdateRemotionVideoDto,
} from './dto/create-remotion-video.dto';

@Injectable()
export class RemotionService {
  private readonly logger = new Logger(RemotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelConfigService: ModelConfigService,
    private readonly aiProvider: AiProviderService,
    private readonly ttsService: TTSService,
    private readonly imagenService: ImagenService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * Helper to clean JSON markdown blocks from AI responses
   */
  private cleanJsonResponse(raw: string): string {
    let clean = raw.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return clean.trim();
  }

  /**
   * Verify subject ownership
   */
  private async verifySubject(subjectId: string, userId: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, userId },
    });
    if (!subject) {
      throw new ForbiddenException('Subject not found or access denied');
    }
    return subject;
  }

  /**
   * List Remotion videos for a subject
   */
  async listVideos(subjectId: string, userId: string) {
    await this.verifySubject(subjectId, userId);
    return this.prisma.remotionVideo.findMany({
      where: { subjectId, userId },
      orderBy: { createdAt: 'desc' },
      include: {
        lesson: {
          select: { id: true, title: true },
        },
      },
    });
  }

  /**
   * Get a single Remotion video
   */
  async getVideo(videoId: string, userId: string) {
    const video = await this.prisma.remotionVideo.findUnique({
      where: { id: videoId },
      include: {
        lesson: {
          select: { id: true, title: true },
        },
        subject: {
          select: { id: true, name: true, majorName: true },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }
    if (video.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return video;
  }

  /**
   * Create a new Remotion video (from Slide, AI topic, or Manual)
   */
  async createVideo(subjectId: string, userId: string, dto: CreateRemotionVideoDto) {
    const subject = await this.verifySubject(subjectId, userId);

    let title = dto.title || 'Video mới';
    let scenes: any[] = dto.scenes || [];
    const templateType = dto.templateType || 'explainer';
    const aspectRatio = dto.aspectRatio || '9:16';
    const targetDuration = dto.targetDuration || 30;
    const fps = 30;

    // ── Mode 1: Import directly from an existing Slide ──
    if (dto.inputType === 'slide' && dto.lessonId && dto.sourceSlideIdx !== undefined) {
      const slide = await this.prisma.slide.findUnique({
        where: {
          lessonId_slideIndex: {
            lessonId: dto.lessonId,
            slideIndex: dto.sourceSlideIdx,
          },
        },
      });

      if (slide) {
        title = `Giải thích: ${slide.title}`;

        // Get slide audio if available from Step 4
        const slideAudio = await this.prisma.slideAudio.findUnique({
          where: {
            lessonId_slideIndex: {
              lessonId: dto.lessonId,
              slideIndex: dto.sourceSlideIdx,
            },
          },
        });

        const narrationText =
          slideAudio?.speakerNote ||
          slide.content ||
          `Trong bài giảng hôm nay, chúng ta cùng tìm hiểu về ${slide.title}.`;

        const audioUrl = slideAudio?.audioUrl || undefined;
        const audioDuration = slideAudio?.audioDuration || (targetDuration || 30);
        const durationFrames = Math.max(90, Math.round(audioDuration * fps) + 3);

        scenes = [
          {
            id: 'scene-1',
            sceneIndex: 1,
            sceneType: 'hook',
            title: slide.title,
            narration: narrationText,
            audioUrl,
            audioDuration,
            durationInFrames: durationFrames,
            visualType: slide.imageUrl ? 'image' : 'definition',
            visualProps: slide.imageUrl
              ? { imageUrl: slide.imageUrl, caption: slide.title }
              : {
                  term: slide.title,
                  category: subject.name,
                  definition: slide.content || narrationText,
                },
          },
        ];
      }
    }

    // If no scenes yet, create initial default skeleton scenes
    if (scenes.length === 0) {
      scenes = [
        {
          id: 'scene-1',
          sceneIndex: 1,
          sceneType: 'hook',
          title: title,
          narration: `Bạn đã hiểu rõ về ${title} chưa? Hãy cùng khám phá ngay sau đây.`,
          durationInFrames: 150, // 5s
          visualType: 'definition',
          visualProps: {
            term: title,
            category: subject.name,
            definition: 'Khái niệm trọng tâm cần nắm vững trong bài học này.',
          },
        },
        {
          id: 'scene-2',
          sceneIndex: 2,
          sceneType: 'concept',
          title: 'Điểm cốt lõi',
          narration: 'Điểm quan trọng nhất cần ghi nhớ là nguyên lý hoạt động và ứng dụng thực tế.',
          durationInFrames: 450, // 15s
          visualType: 'comparison',
          visualProps: {
            title: 'So sánh & Đối chiếu',
            itemA: {
              title: 'Trước đây',
              points: ['Thủ công, tốn thời gian', 'Dễ phát sinh lỗi'],
            },
            itemB: {
              title: 'Giải pháp mới',
              points: ['Tự động hóa 10x', 'Độ chính xác cao'],
              isWinner: true,
            },
            verdict: 'Giải pháp tối ưu cho ứng dụng thực tế',
          },
        },
        {
          id: 'scene-3',
          sceneIndex: 3,
          sceneType: 'takeaway',
          title: 'Tổng kết',
          narration: 'Hãy lưu lại bài giảng này để ôn tập và áp dụng ngay hôm nay nhé!',
          durationInFrames: 300, // 10s
          visualType: 'stat_counter',
          visualProps: {
            number: 100,
            suffix: '%',
            label: 'Nắm vững kiến thức trọng tâm',
            subtext: subject.name,
          },
        },
      ];
    }

    const totalFrames = scenes.reduce((sum, s) => sum + (s.durationInFrames || 150), 0);

    return this.prisma.remotionVideo.create({
      data: {
        subjectId,
        lessonId: dto.lessonId || null,
        userId,
        title,
        inputType: dto.inputType || 'slide',
        sourceSlideIdx: dto.sourceSlideIdx ?? null,
        templateType,
        aspectRatio,
        targetDuration,
        fps,
        totalFrames,
        scriptContent: dto.scriptContent || null,
        scenesJson: scenes,
        status: 'draft',
      },
    });
  }

  /**
   * Update video details / scenes
   */
  async updateVideo(videoId: string, userId: string, dto: UpdateRemotionVideoDto) {
    const video = await this.getVideo(videoId, userId);

    let totalFrames = video.totalFrames;
    if (dto.scenes && Array.isArray(dto.scenes)) {
      totalFrames = dto.scenes.reduce((sum: number, s: any) => sum + (s.durationInFrames || 150), 0);
    }

    return this.prisma.remotionVideo.update({
      where: { id: videoId },
      data: {
        title: dto.title ?? video.title,
        templateType: dto.templateType ?? video.templateType,
        aspectRatio: dto.aspectRatio ?? video.aspectRatio,
        targetDuration: dto.targetDuration ?? video.targetDuration,
        scenesJson: (dto.scenes ?? video.scenesJson) as any,
        totalFrames,
      },
    });
  }

  /**
   * Delete video
   */
  async deleteVideo(videoId: string, userId: string) {
    await this.getVideo(videoId, userId);
    await this.prisma.remotionVideo.delete({
      where: { id: videoId },
    });
    return { success: true, message: 'Video deleted' };
  }

  /**
   * AI Micro-Topic Extractor: Scan lesson and suggest 3-5 short 30s-60s topics
   */
  async suggestTopics(subjectId: string, lessonId: string, userId: string) {
    await this.verifySubject(subjectId, userId);

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        slides: {
          orderBy: { slideIndex: 'asc' },
          select: { slideIndex: true, title: true, content: true },
        },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    const modelConfig = await this.modelConfigService.getModelForTask(userId, 'VIDEO_SCRIPT');

    const slidesSummary = lesson.slides
      .map((s) => `Slide ${s.slideIndex}: ${s.title} — ${s.content || ''}`)
      .join('\n');

    const prompt = `Bạn là chuyên gia sư phạm và biên kịch video micro-learning (TikTok, YouTube Shorts, Reels giáo dục).
Nhiệm vụ của bạn là phân tích bài giảng dưới đây và đề xuất 3 đến 5 chủ đề video ngắn (thời lượng lý tưởng từ 30 giây đến 60 giây).

THÔNG TIN BÀI HỌC:
- Tiêu đề: "${lesson.title}"
- Dàn ý / Slides:
${slidesSummary}

QUY TẮC ĐỀ XUẤT:
1. Mỗi chủ đề chỉ tập trung vào ĐÚNG 1 khái niệm, 1 bài toán, hoặc 1 sự so sánh cụ thể.
2. Gợi ý 1 trong 4 loại template học thuật phù hợp nhất:
   - "explainer" (Giải thích bản chất khái niệm)
   - "comparison" (So sánh 2 công nghệ/thuật ngữ đối lập: A vs B)
   - "pipeline" (Quy trình 3-4 bước tuần tự)
   - "quiz" (Câu hỏi đố nhanh trắc nghiệm)
3. Đặt câu hỏi Hook giật tít, tò mò, kích thích người học xem tiếp.

ĐỊNH DẠNG ĐẦU RA (CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG KÈM TEXT GIẢI THÍCH):
{
  "topics": [
    {
      "id": "topic-1",
      "title": "Tên chủ đề ngắn gọn (dưới 10 từ)",
      "targetDurationSec": 30,
      "recommendedTemplate": "explainer",
      "hookQuestion": "Câu hỏi giật tít mở đầu video?",
      "coreConcept": "Khái niệm cốt lõi cần giải thích",
      "sourceSlideIndex": 2
    }
  ]
}`;

    this.logger.log(`Suggesting micro-topics for lesson ${lessonId} via model ${modelConfig.modelName}`);

    try {
      const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId, {
        maxTokens: 4096,
      });

      const cleaned = this.cleanJsonResponse(aiResult.content);
      const parsed = JSON.parse(cleaned);
      return parsed.topics || parsed;
    } catch (err: any) {
      this.logger.error(`Failed to suggest topics: ${err.message}`);
      throw new BadRequestException('Không thể tạo danh sách chủ đề bằng AI. Vui lòng thử lại.');
    }
  }

  /**
   * AI Script Generator: Generate structured scenes with visualType & visualProps
   */
  async generateScript(videoId: string, userId: string, customPrompt?: string) {
    const video = await this.getVideo(videoId, userId);
    const modelConfig = await this.modelConfigService.getModelForTask(userId, 'VIDEO_SCRIPT');

    const prompt = `Bạn là đạo diễn và chuyên gia hoạt họa Remotion cho video giáo dục/học thuật.
Hãy viết kịch bản chi tiết cho video với các thông tin sau:
- Chủ đề: "${video.title}"
- Template mong muốn: "${video.templateType}"
- Thời lượng mục tiêu: ${video.targetDuration || 30} giây (khoảng 3 đến 4 phân cảnh, tốc độ đọc 55-80 từ tiếng Việt toàn bài).
${customPrompt ? `- Yêu cầu thêm từ giáo viên: "${customPrompt}"` : ''}

QUY TẮC CỐT LÕI CHO REMOTION ACADEMIC VISUALS:
1. Mỗi phân cảnh BẮT BUỘC chỉ định một 'visualType' trong số các loại sau:
   - "formula": Cho công thức Toán, Lý, Hóa (visualProps: { formula: "LaTeX string", label: "Tên công thức", explanation: "Ý nghĩa" })
   - "code": Cho lập trình, thuật toán (visualProps: { code: "mã nguồn ngắn gọn 5-8 dòng", language: "python|typescript|java", filename: "main.py", activeLines: [2, 3] })
   - "comparison": Cho so sánh A vs B (visualProps: { title: "A vs B", itemA: { title: "...", points: ["...", "..."] }, itemB: { title: "...", points: ["...", "..."], isWinner: true }, verdict: "..." })
   - "step_rail": Cho quy trình từng bước (visualProps: { title: "Quy trình", activeStep: 1, steps: [{ number: 1, label: "Bước 1", desc: "..." }, { number: 2, label: "Bước 2", desc: "..." }] })
   - "definition": Cho giải thích định nghĩa (visualProps: { term: "...", category: "...", definition: "...", keyPoints: ["...", "..."] })
   - "stat_counter": Cho số liệu ấn tượng (visualProps: { number: 99, suffix: "%", label: "...", subtext: "..." })
   - "image": Cho ảnh minh họa trực quan (visualProps: { caption: "..." })
   - "quiz": Cho câu hỏi trắc nghiệm (visualProps: { question: "...", options: [{ key: "A", text: "..." }, { key: "B", text: "..." }], correctKey: "A", explanation: "..." })

2. Lời thoại (narration):
   - Ngắn gọn, súc tích, văn phong tự nhiên, không rườm rà.
   - Nhịp điệu dồn dập, chuyển cảnh nhanh.
   - Ước tính durationInFrames ở 30fps (ví dụ lời thoại 10 từ ~ 2.5s = 75-90 frames, 20 từ ~ 5s = 150-180 frames).

ĐỊNH DẠNG ĐẦU RA (CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG CHỨA BẤT KỲ TEXT NGOÀI NÀO):
{
  "scenes": [
    {
      "id": "scene-1",
      "sceneIndex": 1,
      "sceneType": "hook",
      "title": "...",
      "narration": "...",
      "durationInFrames": 150,
      "visualType": "definition",
      "visualProps": { ... }
    }
  ]
}`;

    this.logger.log(`Generating video script for ${videoId} via model ${modelConfig.modelName}`);

    try {
      const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId, {
        maxTokens: 8192,
      });

      const cleaned = this.cleanJsonResponse(aiResult.content);
      const parsed = JSON.parse(cleaned);
      const scenes = parsed.scenes || parsed;

      const totalFrames = scenes.reduce((sum: number, s: any) => sum + (s.durationInFrames || 150), 0);

      // Save to DB
      const updated = await this.prisma.remotionVideo.update({
        where: { id: videoId },
        data: {
          scenesJson: scenes,
          totalFrames,
        },
      });

      return updated;
    } catch (err: any) {
      this.logger.error(`Failed to generate video script: ${err.message}`);
      throw new BadRequestException('Không thể sinh kịch bản video bằng AI. Vui lòng thử lại.');
    }
  }

  /**
   * Generate Audio for a specific scene using TTSService (aligned with Step 4)
   */
  async generateSceneAudio(
    videoId: string,
    sceneIndex: number,
    userId: string,
    voiceId?: string,
    options?: {
      multilingualMode?: string;
      vittsEngine?: string;
      vittsMode?: string;
      vittsDesignInstruct?: string;
      vittsNormalize?: boolean;
    },
  ) {
    const video = await this.getVideo(videoId, userId);
    const scenes = (video.scenesJson as any[]) || [];
    const scene = scenes.find((s) => s.sceneIndex === sceneIndex);

    if (!scene) {
      throw new NotFoundException(`Scene ${sceneIndex} not found in video`);
    }

    if (!scene.narration || !scene.narration.trim()) {
      throw new BadRequestException('Scene narration text is empty');
    }

    this.logger.log(`Generating TTS audio for scene ${sceneIndex} of video ${videoId}`);

    try {
      // Get TTS model config configured by user in TTSSelector
      const modelConfig = await this.modelConfigService.getModelForTask(userId, 'TTS');

      let provider = modelConfig.provider || 'GEMINI';
      let voiceName = 'Puck';
      let activeEngine = options?.vittsEngine;
      let vittsMode = options?.vittsMode;
      const defaultTTSConfig = await this.modelConfigService.getDefaultForTask('TTS');
      let modelName = defaultTTSConfig.modelName;

      // Active voice config priority: explicit voiceId passed -> user modelConfig.modelName
      const activeVoiceConfig = voiceId || modelConfig.modelName;

      if (activeVoiceConfig?.startsWith('gemini-voice:')) {
        voiceName = activeVoiceConfig.split(':')[1];
        if (modelConfig.provider === 'CLIPROXY') {
          provider = 'CLIPROXY';
          const cliproxyTTSConfig = await this.prisma.systemConfig.findUnique({
            where: { key: 'cliproxy.defaultTTSModel' },
          });
          if (cliproxyTTSConfig?.value) {
            modelName = cliproxyTTSConfig.value;
          }
        } else {
          provider = 'GEMINI';
        }
      } else if (activeVoiceConfig?.startsWith('vbee:')) {
        provider = 'VBEE';
        voiceName = activeVoiceConfig.split(':')[1];
        modelName = 'vbee-tts';
      } else if (
        activeVoiceConfig?.startsWith('vitts:') ||
        activeVoiceConfig?.includes('vieneu:') ||
        activeVoiceConfig?.includes('omnivoice:')
      ) {
        provider = 'VITTS';
        voiceName = activeVoiceConfig;
        modelName = 'vitts';
        const isVieNeu =
          activeVoiceConfig.includes(':vieneu:') || activeVoiceConfig.startsWith('vieneu:');
        if (!activeEngine) {
          activeEngine = isVieNeu ? 'vieneu' : 'omnivoice';
        }
        if (activeVoiceConfig.includes(':ref:')) {
          vittsMode = 'clone';
        } else if (isVieNeu) {
          vittsMode = 'preset';
        } else if (activeVoiceConfig.endsWith(':design')) {
          vittsMode = 'design';
        } else if (activeVoiceConfig.endsWith(':auto')) {
          vittsMode = 'auto';
        } else if (!vittsMode) {
          vittsMode = 'auto';
        }
      } else if (activeVoiceConfig) {
        voiceName = activeVoiceConfig;
      }

      const audioResult = await this.ttsService.generateAudio(userId, {
        text: scene.narration.trim(),
        voiceId: voiceName,
        model: modelName,
        provider,
        multilingualMode: options?.multilingualMode,
        vittsMode,
        vittsDesignInstruct: options?.vittsDesignInstruct,
        vittsNormalize: options?.vittsNormalize,
        vittsEngine: activeEngine,
        speed: 1.05,
      });

      const audioFormat = audioResult.format || 'mp3';
      const fileName = `remotion_audio_${videoId}_scene_${sceneIndex}_${Date.now()}.${audioFormat}`;
      const uploadResult = await this.fileStorageService.uploadBuffer(
        audioResult.audio,
        fileName,
        audioFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      );
      const audioUrl = typeof uploadResult === 'string' ? uploadResult : (uploadResult as any).url;
      const audioDuration = audioResult.durationMs ? audioResult.durationMs / 1000 : 5;

      scene.audioUrl = audioUrl;
      scene.audioDuration = audioDuration;
      // Frame count = audioDuration * fps + snappy buffer of 3 frames (~0.1s)
      scene.durationInFrames = Math.max(45, Math.round(audioDuration * video.fps) + 3);

      const totalFrames = scenes.reduce((sum, s) => sum + (s.durationInFrames || 150), 0);

      const updated = await this.prisma.remotionVideo.update({
        where: { id: videoId },
        data: {
          scenesJson: scenes as any,
          totalFrames,
        },
      });

      return {
        success: true,
        audioUrl,
        audioDuration,
        durationInFrames: scene.durationInFrames,
        video: updated,
      };
    } catch (err: any) {
      this.logger.error(`Failed to generate TTS audio for scene ${sceneIndex}: ${err.message}`);
      throw new BadRequestException(`Lỗi sinh giọng đọc TTS: ${err.message}`);
    }
  }

  /**
   * Generate AI image for a specific scene
   */
  async generateSceneImage(videoId: string, sceneIndex: number, userId: string, customPrompt?: string) {
    const video = await this.getVideo(videoId, userId);
    const scenes = (video.scenesJson as any[]) || [];
    const scene = scenes.find((s) => s.sceneIndex === sceneIndex);

    if (!scene) {
      throw new NotFoundException(`Scene ${sceneIndex} not found in video`);
    }

    const imagePrompt =
      customPrompt ||
      scene.visualProps?.caption ||
      `Educational illustration for "${scene.title}". Modern clean digital art, high quality, suitable for academic slide.`;

    this.logger.log(`Generating AI image for scene ${sceneIndex}: "${imagePrompt}"`);

    try {
      const modelConfig = await this.modelConfigService.getModelForTask(userId, 'IMAGE');
      const apiKey = process.env.GEMINI_API_KEY || '';

      const generated = await this.imagenService.generateImage(
        imagePrompt,
        video.aspectRatio === '9:16' ? '9:16' : '16:9',
        modelConfig.modelName,
        apiKey,
        userId,
      );

      if (!generated || !generated.base64) {
        throw new Error('Image generation did not return valid data');
      }

      const imgBuffer = Buffer.from(generated.base64, 'base64');
      const fileName = generated.filename || `remotion_img_${Date.now()}.png`;
      const uploadResult = await this.fileStorageService.uploadBuffer(
        imgBuffer,
        fileName,
        generated.mimeType || 'image/png',
      );
      const imageUrl = typeof uploadResult === 'string' ? uploadResult : (uploadResult as any).url;

      if (scene.visualType !== 'image') {
        scene.visualType = 'image';
      }
      scene.visualProps = {
        ...(scene.visualProps || {}),
        imageUrl,
        caption: scene.title,
      };

      const updated = await this.prisma.remotionVideo.update({
        where: { id: videoId },
        data: {
          scenesJson: scenes as any,
        },
      });

      return {
        success: true,
        imageUrl,
        video: updated,
      };
    } catch (err: any) {
      this.logger.error(`Failed to generate AI image for scene ${sceneIndex}: ${err.message}`);
      throw new BadRequestException(`Lỗi sinh hình ảnh AI: ${err.message}`);
    }
  }
}
