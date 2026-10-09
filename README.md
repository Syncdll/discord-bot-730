# 7 30

A Discord bot that plays a scheduled audio event at **07:30** and **19:30** in every voice channel of a server.

Built by **SYNC**.

## Features

- Scheduled playback at 07:30 and 19:30.
- Independent timezone configuration for each Discord server.
- Automatic first-time setup when the bot joins a server.
- Sequential playback across all voice channels.
- One automatic retry if playback fails in a channel.
- Automatic cleanup of server configuration when the bot is removed.
- Minimal Discord intents and permissions.
- Structured runtime logging.

## Commands

### `/settz`

Selects the timezone used by the server.

Only members with **Manage Server** permission can change it.

### `/showconfig`

Shows the configured timezone and scheduled event times.

## Requirements

- Node.js 22.12.0 or newer
- npm
- A Discord application and bot token

## Discord permissions

The bot requires:

- View Channels
- Send Messages
- Connect
- Speak

Installation scopes:

- `bot`
- `applications.commands`

7 30 does not require privileged intents.

## Installation

Clone the repository and install the exact dependency versions:

```bash
git clone <repository-url>
cd 7-30
npm ci
```

Create the environment file:

```bash
cp .env.example .env
chmod 600 .env
```

Add your Discord bot token:

```env
DISCORD_TOKEN=your_discord_bot_token
```

The default audio file is:

```text
audio/sonido.mp3
```

A different audio file can optionally be configured with:

```env
AUDIO_FILE=/path/to/audio.mp3
```

Start the bot:

```bash
npm start
```

## Runtime data

Per-server configuration is created automatically in:

```text
data/config.json
```

Runtime data is intentionally excluded from Git.

The stored configuration contains the Discord server ID and its selected timezone.

When the bot is removed from a server, its configuration is deleted.

## Project structure

```text
7-30/
├── assets/
├── audio/
│   └── sonido.mp3
├── deploy/
├── .env.example
├── .gitattributes
├── .gitignore
├── index.js
├── package.json
├── package-lock.json
├── README.md
├── PRIVACY.md
├── TERMS.md
└── LICENSE
```

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Terms

See [TERMS.md](TERMS.md).

## License

See [LICENSE](LICENSE).
