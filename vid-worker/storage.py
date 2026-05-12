"""
Video Generation Worker — MinIO Storage
Upload/download video files to MinIO (S3-compatible).
API config comes from JobConfig (passed by NestJS backend).
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class StorageClient:
    """MinIO storage client for video files."""

    def __init__(
        self,
        endpoint: str = "localhost",
        port: int = 9000,
        access_key: str = "",
        secret_key: str = "",
        bucket: str = "ai-teaching",
        secure: bool = False,
    ):
        from minio import Minio
        self.bucket = bucket
        endpoint_with_port = f"{endpoint}:{port}" if port else endpoint
        self.client = Minio(
            endpoint_with_port,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        self._ensure_bucket()

    def _ensure_bucket(self):
        """Create bucket if it doesn't exist."""
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
                logger.info(f"Created bucket: {self.bucket}")
        except Exception as e:
            logger.error(f"Bucket check failed: {e}")

    def upload_video(
        self,
        file_path: str,
        user_id: str,
        video_gen_id: str,
        filename: str = "final.mp4",
    ) -> str:
        """Upload video to MinIO, return object path."""
        object_name = f"videos/{user_id}/{video_gen_id}/{filename}"
        content_type = "video/mp4"

        self.client.fput_object(
            self.bucket,
            object_name,
            file_path,
            content_type=content_type,
        )
        logger.info(f"Uploaded video: {object_name} ({os.path.getsize(file_path)} bytes)")
        return object_name

    def upload_audio(
        self,
        file_path: str,
        user_id: str,
        video_gen_id: str,
        filename: str,
    ) -> str:
        """Upload audio file."""
        object_name = f"videos/{user_id}/{video_gen_id}/audio/{filename}"
        self.client.fput_object(
            self.bucket,
            object_name,
            file_path,
            content_type="audio/wav",
        )
        logger.info(f"Uploaded audio: {object_name}")
        return object_name

    def upload_subtitle(
        self,
        file_path: str,
        user_id: str,
        video_gen_id: str,
        lang: str = "vi",
    ) -> str:
        """Upload SRT subtitle file."""
        object_name = f"videos/{user_id}/{video_gen_id}/subtitle_{lang}.srt"
        self.client.fput_object(
            self.bucket,
            object_name,
            file_path,
            content_type="text/plain",
        )
        logger.info(f"Uploaded subtitle: {object_name}")
        return object_name

    def upload_thumbnail(
        self,
        file_path: str,
        user_id: str,
        video_gen_id: str,
    ) -> str:
        """Upload thumbnail image."""
        object_name = f"videos/{user_id}/{video_gen_id}/thumbnail.jpg"
        self.client.fput_object(
            self.bucket,
            object_name,
            file_path,
            content_type="image/jpeg",
        )
        return object_name

    def upload_clip(
        self,
        file_path: str,
        user_id: str,
        video_gen_id: str,
        filename: str = "clip.mp4",
    ) -> str:
        """Upload a scene clip preview to MinIO."""
        object_name = f"videos/{user_id}/{video_gen_id}/clips/{filename}"
        self.client.fput_object(
            self.bucket,
            object_name,
            file_path,
            content_type="video/mp4",
        )
        logger.info(f"Uploaded clip: {object_name} ({os.path.getsize(file_path)} bytes)")
        return object_name

    def get_presigned_url(self, object_name: str, expires_hours: int = 24) -> str:
        """Get presigned URL for downloading."""
        from datetime import timedelta
        url = self.client.presigned_get_object(
            self.bucket,
            object_name,
            expires=timedelta(hours=expires_hours),
        )
        return url

    def delete_video(self, user_id: str, video_gen_id: str) -> None:
        """Delete all files for a video generation."""
        prefix = f"videos/{user_id}/{video_gen_id}/"
        objects = self.client.list_objects(self.bucket, prefix=prefix, recursive=True)
        for obj in objects:
            self.client.remove_object(self.bucket, obj.object_name)
            logger.info(f"Deleted: {obj.object_name}")
