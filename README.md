<div align="center">

# 🛡️ XionShield Bot

**A fast, dependency-free Discord bot for [XionShield AC](https://xionshield.eu), running inside your FiveM server.**

Ban, unban, screenshot, inspect players and manage XionShield permissions straight from Discord: slash commands, buttons and live logs, with no external API.

<sub>by <b>XionShield Support Team</b></sub>

![FiveM](https://img.shields.io/badge/FiveM-resource-f40552?style=flat-square)
![Node](https://img.shields.io/badge/node-16%20%7C%2022-339933?style=flat-square&logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-6366f1?style=flat-square)
![Discord API](https://img.shields.io/badge/Discord%20API-v10-5865F2?style=flat-square&logo=discord&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)

[Features](#-features) • [Commands](#-commands) • [Installation](#-installation) • [Configuration](#%EF%B8%8F-configuration) • [Performance](#-performance) • [FAQ](#-troubleshooting)

</div>

---

## ✨ Features

### 🔨 Moderation
- **`/ban`** bans an online player through XionShield. It can attach an automatic **screenshot as evidence**, finds the new **ban id** and can **DM the player** with an appeal link.
- **`/unban`**, **`/baninfo`** (with a one-click *Unban* button) and **`/banlist`** with search and pagination
- **`/offlineban`** queues a ban for any identifier (`license:`, `discord:`, `steam:`…). XionShield applies it automatically when that player joins.
- **`/kick`** and **`/warn`**: a warning system with in-game notices and automatic **kick or ban thresholds**

### 🛡️ XionShield control
- **`/perms`** gives or removes any of the 40+ XionShield bypass permissions (single, whole category or all) with autocomplete
- **`/xion`** runs XionShield server commands from Discord (version, entity cleanup, event logs, wrapper / anti-trigger / anti-injector install) and replies with the **console output**
- **Ban feed**: every new or removed XionShield ban is posted to a channel, including detections made by the anti-cheat itself
- **Console feed**: mirrors everything XionShield prints to a Discord channel, with optional regex filters

### 👥 Players
- **`/player`** opens a **live control panel** with Refresh, Screenshot, Revive, Kick and Ban buttons (forms for reasons)
- **`/players`** lists everyone online with ping and session time
- **`/lookup`** searches online players, recently seen players, bans, warnings and queued bans at once
- **XionShield Lookup** context menu: right-click any Discord member → *Apps*
- **`/screenshot`**, **`/revive`** (ESX, QBCore or native fallback), **`/dm`** and **`/announce`**

### 🔗 Discord ↔ server integration
- **Role sync**: Discord roles grant XionShield permissions on join and update **live** when roles change (exports or ACE mode)
- **Connection guard**: require Discord, membership of your Discord server or specific roles before joining
- **Maintenance mode**: staff-only server with one command, with an option to kick everyone else
- **Live status panel** message and player count in the bot status
- **Join / leave logs** and a **staff action log** with screenshot evidence

### ⚙️ Server
- **`/status`**: players, uptime, XionShield state and version, ban stats, gateway ping, memory
- **`/resource`**: start, stop, restart, ensure or refresh resources (owner only, the anti-cheat is protected)
- **`/console`**: raw console commands with output (disabled by default)
- **`/help`**: shows only the commands the member can actually use

---

## ⚡ Performance

XionShield Bot is built to stay out of your server's way.

| | |
|---|---|
| 📦 **Zero dependencies** | Its own WebSocket client, Discord gateway and REST client instead of discord.js. Nothing to `npm install`, nothing cached that is never used. |
| 📡 **0 gateway intents** | Discord only sends interactions. Idle traffic is a heartbeat every ~41 s. |
| 🚦 **Rate-limit aware REST** | Per-route queues, bucket tracking, global limit handling and keep-alive sockets |
| 🧺 **Batched logging** | Up to 10 embeds per message, auto-split under Discord's size limits |
| 🔁 **Change-only updates** | The status panel and presence are only edited when something changes. Slash commands are only re-registered when their definitions change. |
| 🧠 **In-memory indexes** | Player identifiers are read once on join. Ban search uses a pre-built index. |
| 💤 **No per-tick work** | No `setTick`, no busy loops. Every timer is optional and cleaned up on resource stop. |
| 🔌 **Resilient gateway** | Session resume, zombie-connection detection, exponential backoff, automatic intent downgrade |

---

## 📋 Commands

| Command | Description | Default level |
|---|---|---|
| `/help` | Commands you can use | everyone |
| `/status` | Server, XionShield and bot status | support |
| `/players` | Online players | support |
| `/player <player>` | Live player panel with action buttons | support |
| `/lookup [query] [user]` | Search players, bans, warnings and queued bans | support |
| `/banlist [search]` | Browse and search bans | support |
| `/baninfo <ban_id>` | Full ban details | support |
| `/kick <player> <reason>` | Kick a player | moderator |
| `/warn add \| list \| remove \| clear` | Warning system | moderator |
| `/screenshot <player>` | Capture the player's screen | moderator |
| `/revive <player>` | Revive a player | moderator |
| `/dm <player> <message>` | Private in-game message | moderator |
| `/announce <message>` | Broadcast to all players | moderator |
| `/ban <player> <reason> [xion_log] [evidence]` | Ban through XionShield | admin |
| `/unban <ban_id> [note]` | Remove a ban | admin |
| `/offlineban add \| list \| remove` | Queue bans for offline identifiers | admin |
| `/perms set \| category \| all \| sync \| catalog` | XionShield bypass permissions | admin |
| `/xion version \| cleanup \| logs \| module` | XionShield server commands | admin / owner |
| `/maintenance <enabled> [reason] [kick]` | Staff-only mode | admin |
| `/resource <action> [name]` | Resource management | owner |
| `/console <command>` | Raw console command (off by default) | owner |

Levels: `everyone` < `support` < `moderator` < `admin` < `owner`. You can override any command or subcommand in `config.json`.

---

## 🚀 Installation

### Requirements
- FXServer with server-side JavaScript (Node 22 is selected automatically; Node 16 builds are supported too)
- [XionShield](https://xionshield.eu)
- Optional: [`screenshot-basic`](https://github.com/citizenfx/screenshot-basic) for screenshots and ban evidence

### 1. Create the bot
1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **Bot** → copy the token.
2. Turn on **Server Members Intent** only if you use `roleSync.live` or `guard.kickOnGuildLeave`.

### 2. Install the resource
```bash
cd resources
git clone https://github.com/polexss/xionshield-bot
```
Or download the ZIP and extract it as `resources/xionshield-bot`.

### 3. Configure
Fill in `config.json`: at least `token`, `guildId` and your staff role ids (see [Configuration](#%EF%B8%8F-configuration)).

### 4. `server.cfg`
```cfg
ensure XionShield
ensure screenshot-basic
ensure xionshield-bot

add_ace resource.xionshield-bot command.xion allow
```

<details>
<summary>Optional ACEs</summary>

For `/resource`:
```cfg
add_ace resource.xionshield-bot command.start allow
add_ace resource.xionshield-bot command.stop allow
add_ace resource.xionshield-bot command.restart allow
add_ace resource.xionshield-bot command.ensure allow
add_ace resource.xionshield-bot command.refresh allow
```

For `roleSync.mode = "ace"`:
```cfg
add_ace resource.xionshield-bot command.add_ace allow
add_ace resource.xionshield-bot command.add_principal allow
add_ace resource.xionshield-bot command.remove_principal allow
```
</details>

### 5. Start
Start the server. If the bot is not in your Discord server yet, the console prints an invite link. Slash commands appear within seconds (press `Ctrl + R` in Discord if they do not).

---

## ⚙️ Configuration

<details open>
<summary><b>Permissions</b></summary>

```json
"permissions": {
  "owners": ["YOUR_USER_ID"],
  "roles": {
    "admin": ["ADMIN_ROLE_ID"],
    "moderator": ["MOD_ROLE_ID"],
    "support": ["SUPPORT_ROLE_ID"]
  },
  "commandLevels": { "ban": "moderator", "xion.version": "support" }
}
```

- `owners` holds **user** ids. `roles` holds **role** ids. A higher level includes every lower one.
- Ids work with or without quotes. After connecting, the bot checks every role and channel id against your Discord server and warns in the console when one is wrong.
</details>

<details>
<summary><b>All options</b></summary>

| Key | Description |
|---|---|
| `token`, `guildId` | Bot token and your Discord server id |
| `xionshieldResource` | `"auto"` reads the `XionShieldName` convar, or set the resource name |
| `debug` | Verbose console output |
| `replies.ephemeral` | Replies are only visible to the staff member who used the command |
| `channels.actions` | Staff action log (bans with evidence, kicks, warnings, permission changes) |
| `channels.bans` | Ban feed |
| `channels.joins` | Join and leave log |
| `channels.console` | XionShield console feed (`consoleFeed.enabled: true`) |
| `channels.status` | Live status panel (`statusPanel.enabled: true`) |
| `presence` | Bot activity. `{online}`, `{max}`. `type`: 0 Playing, 2 Listening, 3 Watching, 5 Competing |
| `ban.xionLogs` | Save bans to XionShield history by default |
| `ban.screenshotEvidence`, `ban.screenshotTimeout` | Screenshot before banning |
| `ban.dmPlayer`, `ban.appealUrl` | DM banned players with `messages.banDm` |
| `banFeed.watchFile`, `banFeed.pollSeconds` | Watch XionShield `bans.json`, poll `listBans()` as fallback |
| `consoleFeed.include`, `consoleFeed.exclude` | Regex filters for mirrored console lines |
| `roleSync.mode` | `"exports"` (`SetPlayerPermissions*`) or `"ace"` (`XionShield.<Permission>` ACEs) |
| `roleSync.roles` | `"roleId": ["*", "Client", "Vehicle:BypassRepairVehicle", "BypassNoclip"]` |
| `roleSync.live` | Re-apply instantly when roles change (needs Server Members Intent) |
| `guard.requireDiscord`, `guard.requireGuild`, `guard.requiredRoles` | Join requirements (staff and `guard.bypassRoles` skip them) |
| `guard.failOpen` | Let players in when Discord is unreachable |
| `guard.kickOnGuildLeave` | Kick players who leave your Discord (needs Server Members Intent) |
| `warnings.kickAt`, `warnings.banAt` | Automatic action after N warnings (`0` = off) |
| `revive.event` | Custom revive client event (empty = ESX → QBCore → native) |
| `chat.event` | Custom client event for messages, receives `(message, title)` (empty = `chat:addMessage`) |
| `console.enabled` | Registers the owner-only `/console` command |
| `privacy.showIp` | Show full IPs to admins |
| `branding` | Embed footer text and color |
| `messages` | Every text players see (kick screen, guard, maintenance, ban DM) |
| `commands.disabled` | Commands that should not be registered |
</details>

---

## 🧩 How it works

```
Discord ──(gateway + REST)──► xionshield-bot (server JS) ──(exports)──► XionShield
                                     │                          ├─ BanPlayer / UnbanPlayer
                                     │                          ├─ getBanInfo / listBans
                                     │                          └─ SetPlayerPermissions*
                                     ├─ FiveM natives (players, kick, resources, console)
                                     └─ screenshot-basic (optional)
```

- Uses only the exports and console commands documented by XionShield. Nothing in XionShield is modified.
- Ban data is normalized from common field names, and unknown fields are shown under **Details**.
- If an export is unavailable, `/ban` and `/unban` fall back to the `xion ban` / `xion unban` console commands.
- Warnings, queued bans and the status panel id are stored in `data/db.json` with atomic writes.

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| `the bot token is invalid` | Reset the token in the Developer Portal and update `config.json` |
| `Server Members Intent is not enabled` | Enable it, or turn off `roleSync.live` and `guard.kickOnGuildLeave` |
| `Command registration failed … 50001` | Re-invite the bot with the link printed in the console (`applications.commands` scope) |
| `… is a channel id, expected a role id` | You pasted the wrong id. Enable Developer Mode in Discord and use *Copy Role ID* or *Copy User ID*. |
| Screenshot button is greyed out | Start `screenshot-basic` |
| `/xion` shows no output | Your FXServer build cannot capture console output; the command still ran. Check the `command.xion` ACE. |

---

## 📄 License

[GPL-3.0](LICENSE) © XionShield Support Team
