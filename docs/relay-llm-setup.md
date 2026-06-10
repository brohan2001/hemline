# RelayFreeLLM Setup

RelayFreeLLM is a local OpenAI-compatible gateway by MSMarkGu that routes requests to Google Gemini, Groq, or Cerebras with automatic failover on rate limits.

## Prerequisites

- Python 3.11+
- API keys for at least one provider (Gemini recommended as primary)

## Clone and install

```bash
git clone https://github.com/MSMarkGu/RelayFreeLLM.git ~/Documents/RelayFreeLLM
cd ~/Documents/RelayFreeLLM
pip install -r requirements.txt
```

## Configure API keys

Create a `.env` file inside the RelayFreeLLM directory (not the JSeek project):

```
GOOGLE_API_KEY=your-google-ai-studio-key
GROQ_API_KEY=your-groq-key
CEREBRAS_API_KEY=your-cerebras-key
```

Gemini keys are free via [Google AI Studio](https://aistudio.google.com). At least one key is required; the relay falls back automatically when one hits a rate limit.

## Manual launch (optional)

The JSeek server auto-spawns the relay on startup. To run it manually:

```bash
cd ~/Documents/RelayFreeLLM
python3 -m src.server
```

The relay listens on `http://localhost:8000` by default.

## JSeek .env configuration

```
LLM_PROVIDER=relay
RELAY_URL=http://localhost:8000/v1/chat/completions
RELAY_MODEL=gemini-2.5-pro
RELAY_DIR=/Users/rohanbalasubramanian/Documents/RelayFreeLLM
```

`RELAY_MODEL` accepts any model the relay supports:
- `gemini-2.5-pro` — highest quality, best for resume tailoring
- `gemini-2.5-flash` — faster, good for cold messages
- `llama-3.3-70b-versatile` — fully local via Groq inference

## Auto-spawn behavior

When `LLM_PROVIDER=relay`, `server.js` performs a TCP probe on port 8000 at startup:

- **Port occupied** → logs "RelayFreeLLM is already running on port 8000. Connecting safely." and skips spawning.
- **Port free** → spawns `python3 -m src.server` with `cwd: RELAY_DIR`, stdout/stderr piped to the terminal.

The relay process is a child of the Node server; it terminates when the server is stopped.

## Switch back to Claude CLI

```
LLM_PROVIDER=claude
```
