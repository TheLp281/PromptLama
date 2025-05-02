import logging
import os
import re
import subprocess
import uuid

import edge_tts
import speech_recognition as sr
from fastapi import HTTPException


def clean_text_for_tts(text: str) -> str:
    """Clean the text for TTS processing."""
    return re.sub(r"[^\w\s,.!?'-]", "", text)


async def save_speak_file(text: str, lang: str = "en", request_id: str = None):
    """
    Save the spoken text to an audio file using edge_tts.
    The audio file is saved in the static/audio directory.
    """
    voice_map = {
        "en": "en-US-AriaNeural",
        "fr": "fr-FR-DeniseNeural",
        "de": "de-DE-KatjaNeural",
        "es": "es-ES-ElviraNeural",
        "it": "it-IT-ElsaNeural",
        "pt": "pt-PT-FernandaNeural",
        "ru": "ru-RU-DariyaNeural",
        "zh": "zh-CN-XiaoxiaoNeural",
        "ja": "ja-JP-NanamiNeural",
        "ko": "ko-KR-SunHiNeural",
        "tr": "tr-TR-EmelNeural",
    }

    voice = voice_map.get(lang, "en-US-AriaNeural")
    output_file_path = os.path.join("static", "audio", f"audio-{request_id}.mp3")
    cleaned_text = clean_text_for_tts(text)

    try:
        communicate = edge_tts.Communicate(cleaned_text, voice)
        await communicate.save(output_file_path)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate speech: {str(e)}"
        ) from e

    logging.info(f"Saved speak file: {output_file_path}")
    return output_file_path


def validate_and_convert_audio(input_file):
    try:
        repaired_file = f"{input_file}_repaired.webm"
        temp_wav = f"{input_file}.wav"

        try:
            repair_cmd = ["ffmpeg", "-i", input_file, "-c", "copy", "-y", repaired_file]
            subprocess.run(
                repair_cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )

            if os.path.exists(repaired_file) and os.path.getsize(repaired_file) > 0:
                input_file = repaired_file
                logging.info(f"Successfully repaired WebM file: {repaired_file}")
        except Exception as e:
            logging.warning(f"WebM repair attempt failed: {str(e)}")

        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=index,codec_name,codec_type",
            "-of",
            "json",
            input_file,
        ]
        result = subprocess.run(
            cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        logging.info(f"FFprobe output: {result.stdout.decode()}")

        cmd = [
            "ffmpeg",
            "-i",
            input_file,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "-y",
            temp_wav,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        logging.info(f"File converted to WAV: {temp_wav}")

        if os.path.exists(repaired_file):
            try:
                os.remove(repaired_file)
            except Exception:
                pass

        return temp_wav
    except subprocess.CalledProcessError as e:
        logging.error(f"Error during validation/conversion: {e.stderr.decode()}")

        try:
            logging.info("Trying fallback conversion method...")
            fallback_cmd = [
                "ffmpeg",
                "-i",
                input_file,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-acodec",
                "pcm_s16le",
                "-y",
                "-f",
                "wav",
                "-fflags",
                "+genpts",
                "-ignore_unknown",
                temp_wav,
            ]
            subprocess.run(
                fallback_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            logging.info(f"Fallback conversion succeeded: {temp_wav}")
            return temp_wav
        except subprocess.CalledProcessError as inner_e:
            logging.error(
                f"Fallback conversion also failed: {inner_e.stderr.decode() if hasattr(inner_e, 'stderr') else str(inner_e)}"
            )
            return False
    except Exception as e:
        logging.error(f"Unexpected error in audio validation: {str(e)}")
        return False


def recognize_from_audio(input_file, language="tr"):
    try:
        if not input_file or not os.path.exists(input_file):
            raise Exception(f"Audio file not found: {input_file}")

        logging.info(f"Performing speech recognition on {input_file}...")
        recognizer = sr.Recognizer()

        with sr.AudioFile(input_file) as source:
            audio = recognizer.record(source)
            user_input = recognizer.recognize_google(audio, language=language)

        logging.info(f"Recognition successful: '{user_input}'")
        return user_input
    except Exception as ex:
        e = str(ex)
        if e == "":
            e = "No speech detected in the audio file."
        logging.error(f"Speech recognition error: {e}")
        raise Exception(f"Speech recognition failed: {e}")


async def process_audio_file_common(file, is_async=False):
    temp_files = []
    wav_file = None

    try:
        unique_id = str(uuid.uuid4())
        if is_async:
            file_content = await file.read()
        else:
            file_content = file.file.read()

        if not file_content:
            raise HTTPException(status_code=400, detail="Empty file received")

        logging.info(f"Received file: {file.filename}, size: {len(file_content)} bytes")

        raw_file = f"temp_raw{unique_id}.webm"
        temp_files.append(raw_file)

        with open(raw_file, "wb") as f:
            f.write(file_content)

        wav_file = validate_and_convert_audio(raw_file)

        if not wav_file:
            raise HTTPException(
                status_code=400, detail="Invalid or corrupted audio file"
            )

        temp_files.append(wav_file)

        return recognize_from_audio(wav_file, language="tr")
    except Exception as e:
        logging.error(f"Audio processing error: {str(e)}")
        raise HTTPException(
            status_code=400, detail=f"Audio processing failed: {str(e)}"
        ) from e
    finally:
        for path in temp_files:
            if path and os.path.exists(path):
                try:
                    logging.debug(f"Removed temporary file: {path}")
                except Exception as e:
                    logging.warning(f"Failed to remove temporary file {path}: {str(e)}")
