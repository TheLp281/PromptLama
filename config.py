"""Configuration file for the server."""

import os

from dotenv import load_dotenv

load_dotenv()

host = os.getenv("HOST", "http://localhost")
port = os.getenv("PORT", "8000")

ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")

ollama_url = f"{ollama_host}/api/chat"
ollama_tags_url = os.getenv("OLLAMA_TAGS_URL", f"{ollama_host}/api/tags")
