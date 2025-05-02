import json
import logging

import aiohttp
import requests
from fastapi import HTTPException

from config import ollama_tags_url, ollama_url

ollama_models = []


def list_ollama_models():
    """List available models from the Ollama server."""
    global ollama_models

    try:
        response = requests.get(ollama_tags_url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            models = data.get("models", [])
            ollama_models = models
            logging.info("Fetched models: %s", ollama_models)
        return []
    except Exception as e:
        logging.error(e)
        pass


async def ask_ollama_stream(model: str, chat_history):
    """Send a request to the Ollama server and stream the response."""

    if not chat_history:
        raise HTTPException(
            status_code=400, detail="Chat history is required for Ollama request."
        )
    if not model:
        logging.error("Model is not provided.")
        raise HTTPException(status_code=500)

    payload = {"model": model, "stream": True, "messages": chat_history}

    async with aiohttp.ClientSession() as session:
        async with session.post(ollama_url, json=payload) as response:
            if response.status == 200:
                async for line in response.content:
                    try:
                        line = line.decode("utf-8").strip()
                        if not line:
                            continue
                        chunk = json.loads(line)
                        yield chunk
                    except json.JSONDecodeError as e:
                        logging.error(f"JSONDecodeError: {e} - Line: {line}")
                    except Exception as e:
                        logging.error(f"Unexpected error: {e}")
            else:
                logging.error(
                    f"Failed to get response from Ollama. Status code: {response.status}"
                )
                logging.error(f"Response content: {await response.text()}")
                yield "Failed to get response from Ollama"


def does_model_exist(model_name: str) -> bool:
    global ollama_models
    for model in ollama_models:
        if model["name"] == model_name:
            return True
    return False


try:
    list_ollama_models()
except Exception as e:
    logging.error("An error occured while fetching ollama models: %s", e)
