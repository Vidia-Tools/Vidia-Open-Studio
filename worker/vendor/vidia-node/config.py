"""
Centralized configuration for the Vidia custom ComfyUI node.
Loads environment variables via python-dotenv and exposes all config constants.
"""

import os

# Load .env file using python-dotenv (handles quotes, comments, multiline properly)
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(env_path)
except ImportError:
    # Fallback: if python-dotenv is not installed, env vars must be set by the host
    print("[VidiaNode] WARNING: python-dotenv not installed. Environment variables must be set externally.")

# API endpoint for remote logging
VIDIA_API_ENDPOINT = os.getenv("VIDIA_API_ENDPOINT")

# Backend URL for video-ready callback (no hardcoded production fallback)
VIDIA_BACKEND_URL = os.getenv("VIDIA_BACKEND_URL", "")
if not VIDIA_BACKEND_URL:
    print("[VidiaNode] WARNING: VIDIA_BACKEND_URL not set. Backend notifications will fail.")

# Public URL prefix for exported videos (no hardcoded domain)
S3_PUBLIC_URL_PREFIX = os.getenv("S3_PUBLIC_URL_PREFIX", "")
if not S3_PUBLIC_URL_PREFIX:
    print("[VidiaNode] WARNING: S3_PUBLIC_URL_PREFIX not set. Upload URLs will be empty.")

# Callback secret for authenticating with the backend
RUNPOD_CALLBACK_SECRET = os.getenv("RUNPOD_CALLBACK_SECRET", "")
if not RUNPOD_CALLBACK_SECRET:
    print("[VidiaNode] WARNING: RUNPOD_CALLBACK_SECRET not set. Backend callbacks will be rejected.")

# S3/R2 Configuration for Cloudflare
# These values are read from environment variables set in the .env file
S3_CONFIG = {
    'endpoint_url': os.getenv("S3_ENDPOINT_URL"),
    'aws_access_key_id': os.getenv("S3_ACCESS_KEY_ID"),
    'aws_secret_access_key': os.getenv("S3_SECRET_ACCESS_KEY"),
    'bucket_name': os.getenv("S3_BUCKET_NAME"),
    'region_name': os.getenv("S3_REGION_NAME"),
}

# Check for boto3 availability
try:
    import boto3  # noqa: F401 -- import only to check availability
    HAS_BOTO3 = True
except ImportError:
    print("[VidiaNode] boto3 not found. S3 upload will not be available. "
          "Install via: pip install -r requirements.txt")
    HAS_BOTO3 = False
