# Dust Strike

A browser FPS in the spirit of Counter-Strike 1.6: bomb defusal against bots or friends on three maps: **Dust II** (the real de_dust2 geometry from a 3D model, with exact triangle collision), **Dust** (large, 5v5) and **Outpost** (small, 1v1–3v3).
Built with Three.js. The two player models are free CC0 assets by Quaternius (see `assets/models/CREDITS.md`); weapons, textures and sounds are generated in code.

## Run

**With friends (multiplayer server):** requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:8080 and enter your name, then:

- **Create a room:** pick the map, the size (1v1 to 5v5) and how many bots, then press **CREATE ROOM**. Joining players load the room's map automatically. You get a 4-letter room code. Bot difficulty uses the **Bots** setting.
- **Pick a team:** like CS 1.6, after you press **PLAY VS BOTS**, **CREATE ROOM** or **JOIN** a team screen appears over the map: **1** Terrorists, **2** Counter-Terrorists, **5** auto-select, **0** cancel (or click). Online it shows how many players are on each side and blocks a full team. Press **M** in game to switch sides; you sit out the rest of the round and play for your new team from the next one.
- **Join a room:** type the code and press **JOIN**, or click a room in the list. The pause screen (Esc) shows the code and an invite link like `http://<host>:8080/?room=CODE` that fills in the code.

Bots are capped at the number you chose and step aside when a player needs their slot. A room with nobody on one side waits in **warmup**, where you can walk around, until an opponent joins. Rooms close when everyone leaves.

**Solo vs bots only:** the same page has **PLAY VS BOTS**, which runs entirely in your browser. You can also serve the folder statically (`python3 -m http.server 8123`) and play offline.

## Hosting for friends

- **Same Wi‑Fi / LAN:** find your local IP (`ipconfig getifaddr en0` on macOS). Friends open `http://<that-ip>:8080`; the server address field fills in automatically. Allow Node through the macOS firewall when asked.
- **Over the internet:** forward TCP port 8080 on your router to this machine and share your public IP, or use a tunnel (e.g. Cloudflare Tunnel or ngrok) or run it on a small VPS. Pages served over HTTPS automatically connect with `wss://`.
- **Settings (environment variables):** `PORT` (default 8080) and `MAX_ROOMS` (default 20).

## How the multiplayer works

- **The server is authoritative.** It runs the real simulation (`src/core.js`) at 60 ticks/s. Clients only send inputs: held keys, one-shot presses and aim angles. They never send positions, hits, damage, money or bomb state, so speed hacks, teleporting, fake kills and free money don't work.
- **Anti-wallhack:** each client only receives enemies its team can actually see, plus a short grace period, so a wallhack has nothing to show.
- **Lag compensation:** the server rewinds targets to what the shooter saw, capped at 300 ms so a client can't claim huge latency.
- **Input hardening:** malformed or non-finite packets are rejected, messages are rate-limited and payloads are capped at 1 KB. Names are sanitized, and the HTTP server only exposes game files.
- **Client prediction:** your own movement is predicted locally and reconciled with the server, so controls feel instant. Other players are interpolated 100 ms behind for smoothness.
- **Binary protocol** (`src/net/protocol.js`): compact `ArrayBuffer` messages (quantized positions and angles, bitfield inputs), about 6 KB/s per player. Binary keeps packets small; the security comes from the server authority above, not from the encoding.
- **Not prevented:** like any shooter, an aimbot or triggerbot running in the player's own browser can't be fully stopped server-side. It could only be caught with statistical detection.

## Controls

| Key | Action |
| --- | --- |
| WASD / Mouse | Move / aim, LMB fires |
| RMB | Sniper scope (2 zoom levels) · AUG/SG 552 zoom · knife stab |
| Space · C · Shift | Jump · crouch · walk (silent footsteps) |
| R · 1/2/3 · Q · wheel | Reload · weapon slots · last weapon · cycle |
| 4 | Grenades (press again for the next type) · LMB throw, RMB lob |
| B | Buy menu (in spawn, during buy time), like CS 1.6: 1 Handgun · 2 Shotgun · 3 SMG · 4 Rifle · 5 Machine Gun · 6/7 primary/secondary ammo · 8 Equipment. Number keys or the mouse (point to see the weapon and its stats, click to buy); 0 goes back |
| M | Change team (1 T · 2 CT · 5 auto · 0 cancel) |
| E (hold) | Plant the C4 on a bombsite / defuse |
| G | Drop weapon |
| Tab | Scoreboard |
| Esc | Pause |

## What's in it

- **Rounds:** freeze time, 1:55 round timer, a 40-second C4 timer, first to 8 rounds wins.
- **Economy:** $300 per kill, round win/loss bonuses with a loss streak, plant bonus, $16000 cap.
- **Weapons** (the CS 1.6 arsenal, with 1.6-like prices, damage, armor penetration, range falloff, spray recoil, and movement/jump inaccuracy; headshots do 4x damage):
  - Pistols: Glock-18, USP, P228, Desert Eagle, Five-SeveN (CT)
  - Shotguns: M3 (pump) and XM1014 (auto), 9/6 pellets, loaded one shell at a time (fire to stop reloading)
  - SMGs: MP5, TMP (CT, suppressed: quiet to bots), MAC-10 (T), UMP45, P90
  - Rifles: Galil (T), FAMAS (CT), AK-47 (T), M4A1 (CT), SG 552 (T) and AUG (CT) with a zoom
  - Snipers: Scout and AWP (bolt action), G3SG1 (T) and SG 550 (CT) semi-auto
  - Machine gun: M249, 100-round box
  - Kevlar, helmet and defuse kit. Bots buy from the same list, by team and money.
- **Grenades:** HE ($300; damage falls off with distance and is blocked by walls, and it can hurt you), Flashbang ($200, carry 2; blinds anyone with line of sight, more if they face it) and Smoke ($300; an 18 s cloud that blocks vision for players, bots and the server's anti-wallhack). They bounce off walls and floors, and bots buy and use all three.
- **Movement:** GoldSrc-style friction and air acceleration, so air-strafing works.
- **Bots:** A* pathfinding, varied routes to the sites, reaction time and aim error by difficulty, burst fire, strafing, hearing footsteps and gunfire, planting, defusing, and picking up the dropped bomb.
- **HUD:** health, armor, money, ammo, a rotating radar, kill feed, dynamic crosshair, scope overlay, and spectating teammates after you die.
- **Death report:** when you die, a panel lists every hit you took that life: who, which weapon, body part, health and armor lost, and range.
- **Graphics (High):** physical sky, ACES tone mapping, ambient occlusion (GTAO), bloom, normal-mapped surfaces, color grading, and floating dust. **Low** skips the post effects for slower machines; switch it in the menu.

## Code layout

- `src/core.js`: the game simulation (rounds, economy, bomb, combat, bots), shared by offline play and the server
- `src/client.js`: browser side: rendering, HUD, audio, input, menus; offline and online modes
- `src/net/protocol.js`, `src/net/netclient.js`: binary protocol; online client (prediction, interpolation)
- `server/server.js`, `server/room.js`: HTTP + WebSocket server and the authoritative game room
- `src/map.js`: map definitions (Dust II, Dust, Outpost). Dust and Outpost are height grids (raised floors and steps, collision, raycast, pathfinding, mesh building). To add a map, add an entry to `MAPS` (and its id to `MAP_LIST` in `src/net/protocol.js`).
- `src/meshmap.js`: maps made from a 3D model (`mesh: 'file.glb'` in `MAPS`). The GLB's triangles are indexed in a spatial grid for exact box collision (with stair step-up), ray casts for bullets/grenades/line of sight, and a multi-level 1 m navigation grid for bots. The server and the browser load the same file. Model credits: `assets/maps/CREDITS.md`.
- `src/player.js` / `src/bot.js`: the player controller and the bot AI, both built on `src/actor.js`
- `src/weapons.js`: weapon stats
- `src/guns.js`: weapon models, built at real scale from extruded side profiles
- `src/humans.js`: rigged player models: animation (idle, run, strafe, fire, flinch, death), two-handed weapon IK, T/CT outfits
- `src/character.js`, `src/body.js`: procedural fallback soldier, gloved first-person hands, arm IK helper
- `src/viewmodel.js`: first-person weapon, arms and animation
- `src/graphics.js`: renderer, sky, post-processing pipeline, quality setting
- `src/hud.js`, `src/effects.js`, `src/audio.js`, `src/textures.js`
