"""
Video Generation Worker — Orchestrator
Main pipeline coordinator: Script → Scenes → Render → TTS → Compose → Upload.
API config comes from JobConfig (passed by NestJS backend).
"""
import os
import json
import shutil
import logging
import time
from typing import Dict, Any, List, Optional, Callable
from config import TEMP_DIR, MAX_SCENE_RETRY, get_resolution, JobConfig
from script_gen import generate_video_script
from manim_gen import generate_manim_code
from tts_client import TTSClient
from compositor import compose_scene, concat_scenes, generate_srt, extract_thumbnail, get_duration, get_file_size
from storage import StorageClient
from renderers import render_manim, render_playwright, render_static, render_imagen

logger = logging.getLogger(__name__)


REDIS_SCRIPT_READY_PREFIX = "video-gen:script-ready:"


class VideoOrchestrator:
    """Orchestrates the full video generation pipeline."""

    def __init__(self, progress_callback: Optional[Callable] = None,
                 redis_client=None):
        """
        Args:
            progress_callback: Function(job_id, status, progress, message, scene_updates)
            redis_client: Redis client for publishing script-ready events
        """
        self.progress_cb = progress_callback or (lambda *a, **kw: None)
        self.redis = redis_client

    def process(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """
        Full video generation pipeline.

        Args:
            job: Job payload from Redis queue (contains apiKeys from NestJS backend)

        Returns:
            Result dict with video URL, subtitle URL, duration, file size
        """
        job_id = job.get("jobId", "unknown")
        config = job.get("config", {})
        input_data = job.get("input", {})
        mode = job.get("mode", "render")  # 'render' or 'script-only'

        # ── Parse API config from job payload ──
        job_config = JobConfig.from_job_payload(job)
        text_api = job_config.effective_text_api
        image_api = job_config.effective_image_api

        logger.info(f"Job {job_id}: text={text_api['provider']}, image={image_api['provider']}")
        logger.info(f"Job {job_id}: viTTS={job_config.vitts_base_url}, MinIO={job_config.minio_endpoint}")

        # Initialize TTS with system config
        tts = TTSClient(
            base_url=job_config.vitts_base_url,
            api_key=job_config.vitts_api_key,
        )

        # Create job working directory
        work_dir = os.path.join(TEMP_DIR, f"job_{job_id}")
        os.makedirs(work_dir, exist_ok=True)

        try:
            # ── Check if pre-built script is provided (render mode with edited script) ──
            pre_script = job.get("script")
            if pre_script and isinstance(pre_script, list) and len(pre_script) > 0:
                logger.info(f"Using pre-built script: {len(pre_script)} scenes")
                scenes = pre_script
            else:
                # ── STEP 1: Generate Video Script ──
                self._report(job_id, "script", 5, "Đang tạo kịch bản video...")

                # Map new payload format to old fields
                outline = input_data.get("inputText", "") or input_data.get("detailedOutline", "")
                slide_script = input_data.get("slideScript", "")

                scenes = generate_video_script(
                    outline=outline,
                    slide_script=slide_script,
                    lang=config.get("narrationLang", "vi"),
                    job_config=job_config,
                    forced_approach=config.get("forcedApproach") or config.get("approach"),
                )
                logger.info(f"Script generated: {len(scenes)} scenes")

                # ── Publish scene data to Redis so NestJS creates VideoScene records ──
                self._publish_script_ready(job_id, scenes)

            # ── Script-only mode: stop here ──
            if mode == "script-only":
                logger.info(f"Script-only mode — returning script for job {job_id}")
                self._report(job_id, "done", 100, "Kịch bản đã sẵn sàng!")
                return {
                    "videoScript": scenes,
                    "totalScenes": len(scenes),
                    "doneScenes": 0,
                }

            # ── Audio-only mode (Step 2.5): generate TTS and upload ──
            if mode == "audio-only":
                logger.info(f"Audio-only mode — generating TTS for {len(scenes)} scenes")
                # tts is already initialized at the top of process()
                storage = None
                user_id = job.get("userId", "default")
                
                try:
                    storage = StorageClient(
                        endpoint=job_config.minio_endpoint,
                        port=job_config.minio_port,
                        access_key=job_config.minio_access_key,
                        secret_key=job_config.minio_secret_key,
                        bucket=job_config.minio_bucket,
                        secure=job_config.minio_secure,
                    )
                except Exception as e:
                    logger.warning(f"Could not init MinIO client for audio upload: {e}")

                for i, scene in enumerate(scenes):
                    self._report(
                        job_id, "tts", int(100 * i / len(scenes)),
                        f"Đang tạo audio scene {i+1}/{len(scenes)}",
                        [{"sceneIndex": i, "status": "tts"}]
                    )
                    try:
                        narration_key = f"narration_{config.get('narrationLang', 'vi')}"
                        narration_text = scene.get(narration_key, scene.get("narration_vi", ""))
                        
                        if narration_text.strip():
                            audio_path, audio_duration = tts.synthesize(
                                text=narration_text,
                                lang=config.get("narrationLang", "vi"),
                                speed=config.get("narrationSpeed", 1.0),
                                voice=job_config.vitts_voice or job_config.cliproxy_tts_model or "vitts:auto",
                                output_path=os.path.join(work_dir, f"audio_{i:03d}.wav"),
                            )
                            scene["duration"] = audio_duration
                            
                            if storage:
                                audio_url = storage.upload_audio(
                                    audio_path, user_id, job_id, f"scene_{i:03d}.wav"
                                )
                                scene["audioUrl"] = audio_url
                    except Exception as e:
                        logger.error(f"TTS failed for scene {i}: {e}")

                self._report(job_id, "done", 100, "Tạo audio hoàn tất!")
                # Don't publish script-ready here — it would trigger onScriptReady
                # which deletes and recreates scenes WITHOUT audioUrl.
                # The done channel will trigger onAudioReady instead.
                return {
                    "videoScript": scenes,
                    "totalScenes": len(scenes),
                    "doneScenes": len(scenes),
                }

            # ── Render-scene mode: render ONE specific scene ──
            if mode == "render-scene":
                scene_idx = job.get("sceneIndex", 0)
                scene = next((s for s in scenes if s.get("index") == scene_idx), None)
                if not scene and scene_idx < len(scenes):
                    scene = scenes[scene_idx]
                if not scene:
                    raise ValueError(f"Scene {scene_idx} not found in script")
                
                logger.info(f"Render-scene mode: rendering scene {scene_idx} '{scene.get('title')}'")
                self._report(job_id, "rendering", 20, f"Đang render scene {scene_idx}...",
                             [{"sceneIndex": scene_idx, "status": "rendering"}])
                
                # Generate Manim code if needed
                if scene.get("approach") == "manim" and not scene.get("manim_code"):
                    logger.info(f"No existing code for scene {scene_idx}, generating via AI...")
                    code = generate_manim_code(scene, job_config=job_config)
                    if code:
                        scene["manim_code"] = code
                elif scene.get("manim_code"):
                    logger.info(f"Using existing/user-edited code for scene {scene_idx} ({len(scene['manim_code'])} chars)")
                
                # Render the scene clip
                clip_path = self._render_scene(scene, config, work_dir, scene_idx, job_config)
                
                # Upload clip to MinIO
                user_id = job.get("userId", "default")
                clip_url = None
                clip_duration = get_duration(clip_path)
                try:
                    storage = StorageClient(
                        endpoint=job_config.minio_endpoint,
                        port=job_config.minio_port,
                        access_key=job_config.minio_access_key,
                        secret_key=job_config.minio_secret_key,
                        bucket=job_config.minio_bucket,
                        secure=job_config.minio_secure,
                    )
                    clip_url = storage.upload_clip(clip_path, user_id, job_id, f"scene_{scene_idx:03d}.mp4")
                    logger.info(f"Scene {scene_idx} clip uploaded: {clip_url}")
                except Exception as e:
                    logger.warning(f"Clip upload failed: {e}")
                
                self._report(job_id, "done", 100, f"Scene {scene_idx} render hoàn tất!",
                             [{"sceneIndex": scene_idx, "status": "done", "clipUrl": clip_url, "duration": clip_duration, "manimCode": scene.get("manim_code")}])
                return {
                    "sceneIndex": scene_idx,
                    "clipUrl": clip_url,
                    "duration": clip_duration,
                    "manimCode": scene.get("manim_code"),
                }

            # ── Regenerate-code mode: AI regenerate Manim code for ONE scene ──
            if mode == "regenerate-code":
                scene_idx = job.get("sceneIndex", 0)
                scene = next((s for s in scenes if s.get("index") == scene_idx), None)
                if not scene and scene_idx < len(scenes):
                    scene = scenes[scene_idx]
                if not scene:
                    raise ValueError(f"Scene {scene_idx} not found in script")
                
                logger.info(f"Regenerate-code mode: scene {scene_idx} '{scene.get('title')}'")
                self._report(job_id, "rendering", 20, f"AI đang tạo lại code scene {scene_idx}...",
                             [{"sceneIndex": scene_idx, "status": "rendering"}])
                
                # Force regeneration (clear existing code)
                scene["manim_code"] = None
                code = generate_manim_code(scene, job_config=job_config, max_retries=2)
                
                self._report(job_id, "done", 100, f"Code scene {scene_idx} đã tạo lại!",
                             [{"sceneIndex": scene_idx, "status": "pending", "manimCode": code}])
                return {
                    "sceneIndex": scene_idx,
                    "manimCode": code,
                }

            # ── Compose-only mode: merge existing clips into final video ──
            if mode == "compose-only":
                logger.info(f"Compose-only mode: composing {len(scenes)} scene clips")
                self._report(job_id, "composing", 75, "Đang ghép video từ các scene đã render...")
                
                user_id = job.get("userId", "default")
                storage = StorageClient(
                    endpoint=job_config.minio_endpoint,
                    port=job_config.minio_port,
                    access_key=job_config.minio_access_key,
                    secret_key=job_config.minio_secret_key,
                    bucket=job_config.minio_bucket,
                    secure=job_config.minio_secure,
                )
                
                # Download all scene clips + audios from MinIO
                composed_scenes = []
                for i, scene in enumerate(scenes):
                    clip_url = scene.get("clipUrl") or scene.get("clip_url")
                    audio_url = scene.get("audioUrl") or scene.get("audio_url")
                    
                    if not clip_url:
                        logger.warning(f"Scene {i} has no clipUrl, skipping")
                        continue
                    
                    # Download clip
                    clip_path = os.path.join(work_dir, f"dl_clip_{i:03d}.mp4")
                    obj_name = clip_url
                    if obj_name.startswith(f"/{storage.bucket}/"):
                        obj_name = obj_name[len(f"/{storage.bucket}/"):]
                    try:
                        storage.client.fget_object(storage.bucket, obj_name, clip_path)
                    except Exception as e:
                        logger.error(f"Failed to download clip for scene {i}: {e}")
                        continue
                    
                    # Download audio if available
                    if audio_url:
                        audio_path = os.path.join(work_dir, f"dl_audio_{i:03d}.wav")
                        obj_name = audio_url
                        if obj_name.startswith(f"/{storage.bucket}/"):
                            obj_name = obj_name[len(f"/{storage.bucket}/"):]
                        try:
                            storage.client.fget_object(storage.bucket, obj_name, audio_path)
                            # Compose clip + audio
                            composed_path = compose_scene(
                                clip_path=clip_path,
                                audio_path=audio_path,
                                resolution=config.get("resolution", "1080p"),
                                format=config.get("format", "horizontal"),
                                output_path=os.path.join(work_dir, f"composed_{i:03d}.mp4"),
                            )
                            composed_scenes.append(composed_path)
                        except Exception as e:
                            logger.warning(f"Failed to compose audio for scene {i}: {e}")
                            composed_scenes.append(clip_path)
                    else:
                        composed_scenes.append(clip_path)
                
                if not composed_scenes:
                    raise RuntimeError("No scene clips available for composition")
                
                # Concatenate
                final_path = concat_scenes(composed_scenes, output_path=os.path.join(work_dir, "final.mp4"))
                
                # Subtitles
                srt_path = None
                subtitle_lang = config.get("subtitleLang", "vi")
                if subtitle_lang != "none":
                    srt_path = generate_srt(
                        scenes, lang=subtitle_lang,
                        output_path=os.path.join(work_dir, f"subtitle_{subtitle_lang}.srt"),
                    )
                
                # Thumbnail
                thumb_path = extract_thumbnail(final_path, at_seconds=3.0, output_path=os.path.join(work_dir, "thumbnail.jpg"))
                
                # Upload
                self._report(job_id, "uploading", 90, "Đang upload video...")
                result = {
                    "videoPath": final_path,
                    "subtitlePath": srt_path,
                    "thumbnailPath": thumb_path,
                    "duration": get_duration(final_path),
                    "fileSize": get_file_size(final_path),
                    "totalScenes": len(scenes),
                    "doneScenes": len(composed_scenes),
                    "videoScript": scenes,
                }
                
                result["videoUrl"] = storage.upload_video(final_path, user_id, job_id)
                if srt_path:
                    result["subtitleUrl"] = storage.upload_subtitle(srt_path, user_id, job_id, subtitle_lang)
                result["thumbnailUrl"] = storage.upload_thumbnail(thumb_path, user_id, job_id)
                
                self._report(job_id, "done", 100, "Video hoàn thành!")
                return result

            # ── STEP 2: AI Code Generation for Manim scenes ──
            manim_scenes_to_gen = [s for s in scenes if s.get("approach") == "manim" and not s.get("manim_code")]
            total_manim_to_gen = len(manim_scenes_to_gen)
            generated_count = 0
            
            for scene in scenes:
                if scene.get("approach") == "manim" and not scene.get("manim_code"):
                    template = scene.get("manim_template")
                    code_hint = scene.get("manim_code_hint", "")
                    
                    progress_val = int(5 + (generated_count / max(1, total_manim_to_gen)) * 5)
                    self._report(
                        job_id, "rendering", progress_val,
                        f"AI đang viết code cho cảnh: {scene.get('title')}"
                    )
                    
                    # If no template or there's a custom code hint, generate via AI
                    if not template or code_hint:
                        logger.info(f"Generating Manim code for scene '{scene.get('title')}'")
                        code = generate_manim_code(scene, job_config=job_config)
                        if code:
                            scene["manim_code"] = code
                            logger.info(f"  → Generated {len(code)} chars of Manim code")
                            
                    generated_count += 1

            # ── STEP 3: Render Each Scene ──
            total = len(scenes)
            scene_clips = []
            scene_audios = []

            for i, scene in enumerate(scenes):
                self._report(
                    job_id, "rendering", 10 + int(60 * i / total),
                    f"Đang render scene {i+1}/{total}: {scene['title']}",
                    [{"sceneIndex": i, "status": "rendering"}]
                )

                try:
                    # ── STEP A: Generate TTS audio FIRST (3b1b workflow) ──
                    # We need the exact audio duration BEFORE rendering video
                    # so animations can be timed to match the narration.
                    narration_key = f"narration_{config.get('narrationLang', 'vi')}"
                    narration_text = scene.get(narration_key, scene.get("narration_vi", ""))
                    
                    audio_path = None
                    audio_duration = scene.get("duration", 0)

                    # Check if audio was already generated in audio-only mode
                    if scene.get("audioUrl"):
                        logger.info(f"Using pre-generated audio for scene {i}")
                        try:
                            # Download from MinIO (StorageClient imported at module level)
                            storage = StorageClient(
                                endpoint=job_config.minio_endpoint,
                                port=job_config.minio_port,
                                access_key=job_config.minio_access_key,
                                secret_key=job_config.minio_secret_key,
                                bucket=job_config.minio_bucket,
                                secure=job_config.minio_secure,
                            )
                            # Remove bucket name from URL if present
                            obj_name = scene["audioUrl"]
                            if obj_name.startswith(f"/{storage.bucket}/"):
                                obj_name = obj_name[len(f"/{storage.bucket}/"):]
                            
                            audio_path = os.path.join(work_dir, f"audio_dl_{i:03d}.wav")
                            storage.client.fget_object(storage.bucket, obj_name, audio_path)
                            
                            if not audio_duration:
                                audio_duration = get_duration(audio_path)
                        except Exception as e:
                            logger.warning(f"Failed to download pre-generated audio: {e}. Will regenerate.")
                            audio_path = None

                    # Generate TTS if not already available
                    if not audio_path:
                        audio_path, audio_duration = tts.synthesize(
                            text=narration_text,
                            lang=config.get("narrationLang", "vi"),
                            speed=config.get("narrationSpeed", 1.0),
                            voice=job_config.vitts_voice or job_config.cliproxy_tts_model or "vitts:auto",
                            output_path=os.path.join(work_dir, f"audio_{i:03d}.wav"),
                        )

                    # ── STEP B: Render video clip with KNOWN audio duration ──
                    # Pass audio_duration so renderers can create clips that match
                    scene["duration"] = audio_duration
                    scene["duration_est"] = audio_duration  # Override estimate with real value
                    clip_path = self._render_scene(scene, config, work_dir, i, job_config)

                    scene["clip_path"] = clip_path
                    scene["audio_path"] = audio_path

                    scene_clips.append(clip_path)
                    scene_audios.append(audio_path)

                    self._report(
                        job_id, "rendering", 10 + int(60 * (i+1) / total),
                        f"Scene {i+1}/{total} xong ({audio_duration:.1f}s)",
                        [{"sceneIndex": i, "status": "done", "duration": audio_duration, "manimCode": scene.get("manim_code")}]
                    )

                except Exception as e:
                    logger.error(f"Scene {i} failed: {e}")
                    self._report(
                        job_id, "rendering", 10 + int(60 * (i+1) / total),
                        f"Scene {i+1}/{total} lỗi, bỏ qua",
                        [{"sceneIndex": i, "status": "error", "error": str(e)}]
                    )

            # ── STEP 4: Compose All Scenes ──
            self._report(job_id, "composing", 75, "Đang ghép video...")

            # Compose each scene (clip + audio)
            composed_scenes = []
            for i, scene in enumerate(scenes):
                if "clip_path" in scene and "audio_path" in scene:
                    composed_path = compose_scene(
                        clip_path=scene["clip_path"],
                        audio_path=scene["audio_path"],
                        resolution=config.get("resolution", "1080p"),
                        format=config.get("format", "horizontal"),
                        output_path=os.path.join(work_dir, f"composed_{i:03d}.mp4"),
                    )
                    composed_scenes.append(composed_path)

            if not composed_scenes:
                raise RuntimeError("No scenes rendered successfully")

            # Concatenate all scenes
            final_path = concat_scenes(
                composed_scenes,
                output_path=os.path.join(work_dir, "final.mp4"),
            )

            # ── STEP 5: Subtitles ──
            self._report(job_id, "composing", 85, "Đang tạo phụ đề...")
            subtitle_lang = config.get("subtitleLang", "vi")
            srt_path = None
            if subtitle_lang != "none":
                srt_path = generate_srt(
                    scenes, lang=subtitle_lang,
                    output_path=os.path.join(work_dir, f"subtitle_{subtitle_lang}.srt"),
                )

            # ── STEP 6: Thumbnail ──
            thumb_path = extract_thumbnail(
                final_path, at_seconds=3.0,
                output_path=os.path.join(work_dir, "thumbnail.jpg"),
            )

            # ── STEP 7: Upload to MinIO ──
            self._report(job_id, "uploading", 90, "Đang upload video...")

            result = {
                "videoPath": final_path,
                "subtitlePath": srt_path,
                "thumbnailPath": thumb_path,
                "duration": get_duration(final_path),
                "fileSize": get_file_size(final_path),
                "totalScenes": total,
                "doneScenes": len(composed_scenes),
                "videoScript": scenes,
            }

            # Upload if MinIO configured
            user_id = job.get("userId", "default")
            try:
                storage = StorageClient(
                    endpoint=job_config.minio_endpoint,
                    port=job_config.minio_port,
                    access_key=job_config.minio_access_key,
                    secret_key=job_config.minio_secret_key,
                    bucket=job_config.minio_bucket,
                    secure=job_config.minio_secure,
                )
                result["videoUrl"] = storage.upload_video(final_path, user_id, job_id)
                if srt_path:
                    result["subtitleUrl"] = storage.upload_subtitle(srt_path, user_id, job_id, subtitle_lang)
                result["thumbnailUrl"] = storage.upload_thumbnail(thumb_path, user_id, job_id)
            except Exception as e:
                logger.warning(f"MinIO upload skipped: {e}")
                # Keep local paths as fallback

            self._report(job_id, "done", 100, "Video hoàn thành!")
            return result

        except Exception as e:
            logger.error(f"Pipeline failed: {e}", exc_info=True)
            self._report(job_id, "error", 0, f"Lỗi: {str(e)}")
            raise

        finally:
            # Cleanup working directory after upload
            try:
                if os.path.exists(work_dir):
                    shutil.rmtree(work_dir, ignore_errors=True)
                    logger.info(f"Cleaned up work dir: {work_dir}")
            except Exception as e:
                logger.warning(f"Cleanup failed: {e}")

    def _publish_script_ready(self, job_id: str, scenes: list):
        """Publish generated scenes to Redis so NestJS creates VideoScene DB records."""
        if not self.redis:
            logger.warning("No Redis client, cannot publish script-ready event")
            return
        try:
            payload = json.dumps({
                "jobId": job_id,
                "scenes": scenes,
            })
            channel = f"{REDIS_SCRIPT_READY_PREFIX}{job_id}"
            self.redis.publish(channel, payload)
            logger.info(f"Published script-ready: {len(scenes)} scenes to {channel}")
        except Exception as e:
            logger.warning(f"Failed to publish script-ready: {e}")

    def _render_scene(
        self, scene: Dict, config: Dict, work_dir: str, index: int,
        job_config: "JobConfig",
    ) -> str:
        """Dispatch to correct renderer based on approach.
        
        When forcedApproach is set, ALL scenes use that approach.
        On failure: uses ManimGL text fallback instead of static gradient.
        """
        forced = config.get("forcedApproach")
        approach = forced or scene.get("approach", "static")
        resolution = config.get("resolution", "1080p")
        fmt = config.get("format", "horizontal")
        output_path = os.path.join(work_dir, f"clip_{index:03d}.mp4")

        for attempt in range(MAX_SCENE_RETRY + 1):
            try:
                if approach == "manim":
                    return render_manim(scene, resolution, fmt, output_path)
                elif approach == "screen_record":
                    return render_playwright(scene, resolution, fmt, output_path)
                elif approach == "imagen":
                    return render_imagen(
                        scene, scene.get("duration_est", 10),
                        resolution, fmt, output_path,
                        job_config=job_config,
                    )
                else:  # static
                    return render_static(
                        scene, scene.get("duration_est", 10),
                        resolution, fmt, output_path,
                    )
            except Exception as e:
                if attempt < MAX_SCENE_RETRY:
                    logger.warning(f"Scene {index} render attempt {attempt+1} failed: {e}, retrying...")
                else:
                    logger.error(f"Scene {index} render failed after retries: {e}")
                    if forced:
                        # Forced mode: use ManimGL text scene as fallback (still Manim, not static gradient)
                        logger.warning(f"Scene {index}: forced={forced}, using ManimGL text fallback instead of static")
                        try:
                            from renderers.manim_renderer import _generate_text_scene
                            fallback_scene = dict(scene)
                            fallback_scene["manim_code"] = _generate_text_scene(scene)
                            return render_manim(fallback_scene, resolution, fmt, output_path)
                        except Exception as e2:
                            logger.error(f"Scene {index} ManimGL text fallback also failed: {e2}")
                            # Last resort: static even in forced mode (better than crash)
                            return render_static(scene, scene.get("duration_est", 10), resolution, fmt, output_path)
                    else:
                        # No forced mode: static placeholder is fine
                        return render_static(scene, scene.get("duration_est", 10), resolution, fmt, output_path)

    def _report(self, job_id: str, status: str, progress: int, message: str,
                scene_updates: list = None):
        """Report progress via callback."""
        self.progress_cb(
            job_id=job_id,
            status=status,
            progress=progress,
            message=message,
            scene_updates=scene_updates or [],
        )


