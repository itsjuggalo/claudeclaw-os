# War Room - ClaudeClaw Voice Meeting Server

Real-time voice conversations with ClaudeClaw's AI agents. Each agent has a distinct voice. You speak, the right agent responds.

## Prerequisites

- Python 3.10+
- A Daily.co account (for WebRTC rooms)
- A Deepgram account (for speech-to-text)
- A Cartesia account (for text-to-speech)
- The ClaudeClaw Node.js project built (`npm run build`)

## Setup

1. Install Python dependencies:

```bash
pip install -r warroom/requirements.txt
```

2. Set your API keys in the project `.env` (or export them):

```
DAILY_API_KEY=your_daily_key
DEEPGRAM_API_KEY=your_deepgram_key
CARTESIA_API_KEY=your_cartesia_key
```

3. (Optional) Configure agent voices in `warroom/voices.json`. The default voice IDs are placeholders. Replace them with Cartesia voice IDs from their public library.

## Running

```bash
python warroom/server.py
```

The server prints a JSON line to stdout with the Daily room URL and token:

```json
{"room_url": "https://your-domain.daily.co/room-name", "token": "...", "status": "ready"}
```

Open the room URL in your browser to join the voice session.

## How it works

The pipeline flows like this:

```
Microphone -> Daily WebRTC -> Deepgram STT -> Agent Router -> Claude Agent Bridge -> Cartesia TTS -> Daily WebRTC -> Speaker
```

- **Agent Router** detects which agent you're addressing by name prefix ("Research, look into X") or broadcasts to all agents ("everyone, status update").
- **Claude Agent Bridge** calls the ClaudeClaw agent via `agent-voice-bridge.js` and switches the TTS voice to match the responding agent.

## Voice Routing

Address agents by name:

- "Main, what's on my schedule?"
- "Hey research, look into competitor pricing"
- "Ops, restart the service"
- "Everyone, give me a status update" (broadcasts to all agents in order)

If no agent name is detected, the message routes to the main agent.

## Customizing Voices

Edit `warroom/voices.json` to map each agent to a Cartesia voice ID. Browse available voices at [play.cartesia.ai](https://play.cartesia.ai).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DAILY_API_KEY` | Yes | Daily.co API key |
| `DEEPGRAM_API_KEY` | Yes | Deepgram API key |
| `CARTESIA_API_KEY` | Yes | Cartesia API key |
| `WARROOM_DAILY_ROOM_URL` | No | Use an existing Daily room instead of creating one |
