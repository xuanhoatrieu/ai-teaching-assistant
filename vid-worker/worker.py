"""
Video Generation Worker — Redis Queue Consumer
Listens for jobs on Redis queue, dispatches to orchestrator, reports progress.
"""
import json
import logging
import sys
import os
import signal
import time

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import REDIS_URL, REDIS_JOB_QUEUE, REDIS_PROGRESS_PREFIX, REDIS_DONE_PREFIX
from orchestrator import VideoOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker")

# Graceful shutdown
_shutdown = False
def _signal_handler(sig, frame):
    global _shutdown
    logger.info("Shutdown signal received, finishing current job...")
    _shutdown = True

signal.signal(signal.SIGTERM, _signal_handler)
signal.signal(signal.SIGINT, _signal_handler)


def main():
    """Main worker loop — listen for jobs and process them."""
    import redis

    logger.info(f"🚀 Video Generation Worker starting...")
    logger.info(f"📡 Redis: {REDIS_URL}")
    logger.info(f"📥 Queue: {REDIS_JOB_QUEUE}")

    r = redis.from_url(REDIS_URL, decode_responses=True)

    # Test Redis connection
    try:
        r.ping()
        logger.info("✅ Redis connected")
    except redis.ConnectionError as e:
        logger.error(f"❌ Redis connection failed: {e}")
        sys.exit(1)

    def progress_callback(job_id: str, status: str, progress: int,
                          message: str, scene_updates: list = None):
        """Publish progress updates to Redis."""
        payload = json.dumps({
            "jobId": job_id,
            "status": status,
            "progress": progress,
            "currentStep": message,
            "sceneUpdates": scene_updates or [],
            "timestamp": time.time(),
        })
        r.publish(f"{REDIS_PROGRESS_PREFIX}{job_id}", payload)
        r.set(f"{REDIS_PROGRESS_PREFIX}{job_id}:latest", payload, ex=3600)

    orchestrator = VideoOrchestrator(progress_callback=progress_callback,
                                     redis_client=r)

    logger.info("👂 Waiting for jobs...")

    while not _shutdown:
        try:
            # Blocking pop from queue (timeout 5s to check shutdown flag)
            result = r.blpop(REDIS_JOB_QUEUE, timeout=5)
            if result is None:
                continue

            _, job_data = result
            job = json.loads(job_data)
            job_id = job.get("jobId", "unknown")

            logger.info(f"📬 Received job: {job_id}")
            logger.info(f"   Lesson: {job.get('lessonId', 'N/A')}")
            logger.info(f"   Config: {json.dumps(job.get('config', {}), indent=2)}")

            try:
                result = orchestrator.process(job)

                # Publish completion
                done_payload = {
                    "jobId": job_id,
                    "status": "done",
                    "videoUrl": result.get("videoUrl", result.get("videoPath", "")),
                    "subtitleUrl": result.get("subtitleUrl", result.get("subtitlePath", "")),
                    "thumbnailUrl": result.get("thumbnailUrl", result.get("thumbnailPath", "")),
                    "duration": result.get("duration", 0),
                    "fileSize": result.get("fileSize", 0),
                    "totalScenes": result.get("totalScenes", 0),
                    "doneScenes": result.get("doneScenes", 0),
                    "videoScript": result.get("videoScript", []),
                }
                
                # Include scene-level results for render-scene/regenerate-code
                mode = job.get("mode", "render")
                if mode == "render-scene":
                    done_payload["sceneIndex"] = result.get("sceneIndex", 0)
                    done_payload["sceneUpdates"] = [{
                        "sceneIndex": result.get("sceneIndex", 0),
                        "clipUrl": result.get("clipUrl"),
                        "duration": result.get("duration", 0),
                        "status": "done",
                    }]
                elif mode == "regenerate-code":
                    done_payload["sceneIndex"] = result.get("sceneIndex", 0)
                    done_payload["sceneUpdates"] = [{
                        "sceneIndex": result.get("sceneIndex", 0),
                        "manimCode": result.get("manimCode"),
                        "status": "pending",
                    }]
                
                r.publish(f"{REDIS_DONE_PREFIX}{job_id}", json.dumps(done_payload))
                r.set(f"{REDIS_DONE_PREFIX}{job_id}", json.dumps(done_payload), ex=86400)

                logger.info(f"✅ Job {job_id} completed! Duration: {result.get('duration', 0):.1f}s")

            except Exception as e:
                logger.error(f"❌ Job {job_id} failed: {e}", exc_info=True)
                error_payload = json.dumps({
                    "jobId": job_id,
                    "status": "error",
                    "error": str(e),
                })
                r.publish(f"{REDIS_DONE_PREFIX}{job_id}", error_payload)
                r.set(f"{REDIS_DONE_PREFIX}{job_id}", error_payload, ex=86400)

        except json.JSONDecodeError as e:
            logger.error(f"Invalid job JSON: {e}")
        except Exception as e:
            logger.error(f"Worker loop error: {e}", exc_info=True)
            time.sleep(5)  # Backoff on unexpected errors

    logger.info("👋 Worker shutting down gracefully")


if __name__ == "__main__":
    main()
