# Ollama AI Chat/Voice Frontend


# Features

### Connect to a ollama server and send messages to open source LLMs
### Store message history
### Speech recognition from microphone input
### AI voice generation via EdgeTTS

## Requirements:
### **Ollama server running in your system**
### **FFmpeg installed in your system (for speech recognition)**

<table align="center">
  <tr>
    <td align="center" width="96">
      <img src="https://techstack-generator.vercel.app/python-icon.svg" width="48" height="48" alt="Python" />
      <br>Python FastAPI
    </td>
    <td align="center" width="96">
      <img src="https://ollama.com/public/ollama.png" width="48" height="48" alt="Ollama" />
      <br>Ollama
    </td>
  </tr>
</table>




# Quickstart

### For End Users
Install binary from https://github.com/TheLp281/PromptLama/releases

### For Developers

## To setup virtual env and install:
``` bash
make install
```

## To run server:
``` bash
make run
```

## Configuration options:
Available options for .env:

## HOST
Hostname to bind the server at.

## PORT
Port number to bind the server at.

## OLLAMA_HOST
URL of ollama api. Defaults to http://127.0.0.1:11434



## Todo:

•**Language dropdown to override recognized language**
•**Set temperature of model**
•**Implement model management ui**
•**Export chat history button**
•**Switch to vite/npm**
•**Configure eslint/typescript**
•**Get rid of ffmpeg dependency**
