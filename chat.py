import json
import logging
import os

import nltk
from fastapi import HTTPException
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.sql import func

nltk.download("punkt_tab")

MAX_HISTORY_LENGTH = 10000
MAX_CONTEXT_LENGTH = 3000

Base = declarative_base()

DATABASE_FOLDER = "databases"
DATABASE_FILE = "chat_storage.db"
DATABASE_URL = f"sqlite:///{DATABASE_FOLDER}/{DATABASE_FILE}"

os.makedirs(DATABASE_FOLDER, exist_ok=True)


engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, unique=True, index=True)
    channels = relationship("Channel", back_populates="user")


class Channel(Base):
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(String, unique=True, index=True)
    channel_name = Column(String)
    user_id = Column(Integer, ForeignKey("users.id"))
    history = Column(Text)
    user = relationship("User", back_populates="channels")
    created_at = Column(DateTime, default=func.now())


Base.metadata.create_all(bind=engine)


class ChatStorageManager:
    """
    A class to manage chat storage, including creating users and channels,
    saving and loading chat history, and deleting channels.
    """

    def __init__(self):
        self.db = SessionLocal()

    def create_user(self, user_id: str):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            user = User(user_id=user_id)
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        return user

    def create_channel(self, user_id: str, channel_id: str, text: str):
        user = self.create_user(user_id)
        channel = (
            self.db.query(Channel).filter(Channel.channel_id == channel_id).first()
        )

        if channel:
            raise HTTPException(status_code=400, detail="Channel already exists")

        channel_name = generate_summary_title(text)
        channel = Channel(
            channel_id=channel_id,
            channel_name=channel_name,
            user_id=user.id,
            history="[]",
        )
        self.db.add(channel)
        self.db.commit()
        self.db.refresh(channel)
        return channel

    def get_channels(self, user_id: str):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            return []

        channels = (
            self.db.query(Channel)
            .filter(Channel.user_id == user.id)
            .order_by(Channel.created_at.desc())
            .all()
        )
        return [
            {"id": channel.channel_id, "name": channel.channel_name}
            for channel in channels
        ]

    def does_channel_exist(self, user_id: str, channel_id: str):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            return False

        channel = (
            self.db.query(Channel)
            .filter(Channel.channel_id == channel_id, Channel.user_id == user.id)
            .first()
        )
        return channel is not None

    def save_chat_history(self, user_id: str, channel_id: str, history):
        logging.info(
            f"Saving chat history for channel {channel_id}. {history} for user {user_id}"
        )
        if not isinstance(history, list):
            raise HTTPException(status_code=400, detail="History must be a list")

        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        channel = (
            self.db.query(Channel)
            .filter(Channel.channel_id == channel_id, Channel.user_id == user.id)
            .first()
        )
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        if len(history) > MAX_HISTORY_LENGTH:
            history = history[-MAX_HISTORY_LENGTH:]

        channel.history = json.dumps(history)
        self.db.commit()
        result = self.load_chat_history(user_id, channel_id)
        print(f"Saved chat history: {result}")

    def load_chat_history(
        self, user_id: str, channel_id: str, is_llm_call: bool = False
    ):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            return []

        channel = (
            self.db.query(Channel)
            .filter(Channel.channel_id == channel_id, Channel.user_id == user.id)
            .first()
        )
        if not channel:
            return []

        full_history = json.loads(channel.history)

        if is_llm_call:
            filtered_history = []
            for message in full_history:
                filtered_message = {
                    k: v for k, v in message.items() if k != "audio_url"
                }
                filtered_history.append(filtered_message)
            truncated = self._truncate_history_by_character_length(
                filtered_history, MAX_CONTEXT_LENGTH
            )
            return truncated

        return full_history

    def delete_channel(self, user_id: str, channel_id: str):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        channel = (
            self.db.query(Channel)
            .filter(Channel.channel_id == channel_id, Channel.user_id == user.id)
            .first()
        )
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        self.db.delete(channel)
        self.db.commit()

    def delete_all_channels(self, user_id: str):
        user = self.db.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        self.db.query(Channel).filter(Channel.user_id == user.id).delete()
        self.db.commit()

    def _truncate_history_by_character_length(self, history, max_characters):
        """
        Truncates the chat history to ensure the total character count is within the specified limit.
        """
        total_characters = 0
        truncated_history = []

        for message in reversed(history):
            message_length = len(message)
            if total_characters + message_length > max_characters:
                break
            truncated_history.insert(0, message)
            total_characters += message_length

        return truncated_history


def generate_summary_title(text):
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.parsers.plaintext import PlaintextParser
    from sumy.summarizers.lsa import LsaSummarizer

    parser = PlaintextParser.from_string(text, Tokenizer("english"))
    summarizer = LsaSummarizer()
    summary = summarizer(parser.document, 1)
    return " ".join(str(sentence) for sentence in summary)


chat_storage_manager = ChatStorageManager()
