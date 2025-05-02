"""This module handles AI chat requests"""

import json
import logging
import os
import time
import uuid
from typing import AsyncGenerator

import langid
from fastapi import HTTPException

from chat import chat_storage_manager
from ollama import ask_ollama_stream
from speech import process_audio_file_common, save_speak_file


def process_audio_file(file):
    """
    Process the audio file synchronously.
    """
    return process_audio_file_common(file, is_async=False)


async def process_audio_file_async(file):
    """
    Process the audio file asynchronously.
    """
    return await process_audio_file_common(file, is_async=True)


async def extract_user_input_async(file, text):
    """
    Asynchronously extract user input from either an audio file or text input.
    """
    if file:
        return await process_audio_file_async(file)
    elif text:
        return text.strip()
    else:
        raise HTTPException(
            status_code=400, detail="Either an audio file or text input is required."
        )


def detect_language(text: str) -> str:
    """
    Detect the language of the given text using langid.
    Returns the language code (e.g., 'en', 'fr', etc.).
    """
    return langid.classify(text)[0]


async def response_stream_generator(
    channel_id, session_id, user_input, is_file_uploaded, chat_history, model
) -> AsyncGenerator[str, None]:
    audio_request_id = str(uuid.uuid4())
    start_json = "$[[START_JSON]]"
    end_json = "$[[END_JSON]]"

    audio_file_path = os.path.join("static", "audio", f"audio-{audio_request_id}.mp3")
    _start_json = {}
    if is_file_uploaded:
        _start_json["resolved_text"] = user_input

    early_chunk = f"{start_json}{json.dumps(_start_json)}{end_json}\n"

    yield early_chunk

    yield "\n"

    step_start_time = time.time()
    accumulated_response = ""
    logging.info(
        "Sending request to LLM with input: %s history: %s", user_input, chat_history
    )

    try:
        async for chunk in ask_ollama_stream(model, chat_history):
            if isinstance(chunk, dict):
                content_chunk = chunk.get("message", {}).get("content", "")
                if content_chunk:
                    accumulated_response += content_chunk
                    logging.debug("Yielding dict chunk: %s", content_chunk)
                    yield content_chunk
            elif isinstance(chunk, str) and chunk != "":
                accumulated_response += chunk
                logging.debug("Yielding string chunk: %s", chunk)
                yield chunk
    except Exception as e:
        logging.error("Error during response streaming: %s", e)
        yield str(e)

    logging.info("Response from LLM: %s", accumulated_response)

    if not accumulated_response:
        logging.error("No response received from LLM.")
        return

    lang = detect_language(accumulated_response)
    logging.info("Detected language: %s ", lang)
    audio_url = ""
    try:
        await save_speak_file(accumulated_response, lang, audio_request_id)
        logging.info(
            "Generated audio file at %s. Time taken: %.2f seconds",
            audio_file_path,
            time.time() - step_start_time,
        )
        audio_start = "$[[AUDIO_DONE]]"
        audio_end = "$[[AUDIO_DONE]]"
        audio_url = f"/static/audio/audio-{audio_request_id}.mp3"
        audio_json = json.dumps(
            {
                "audio_url": audio_url,
                "channel_id": channel_id,
            }
        )
        audio_chunk = f"\n{audio_start}{audio_json}{audio_end}"
        logging.debug("Yielding AUDIO_DONE chunk")
        yield audio_chunk
    except Exception as e:
        logging.error(f"Audio generation failed: {e}")

    chat_history.append(
        {"role": "ai", "content": accumulated_response.strip(), "audio_url": audio_url}
    )
    chat_storage_manager.save_chat_history(session_id, channel_id, chat_history)
    logging.info(
        "Saved chat history for channel %s. Time taken: %.2f seconds",
        channel_id,
        time.time() - step_start_time,
    )
