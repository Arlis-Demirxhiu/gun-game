import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMap, preloadMap, MAPS } from './map.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { Graphics } from './graphics.js';
import { ViewModel } from './viewmodel.js';
import { gunInstance } from './guns.js';
import { Player } from './player.js';
import { loadHumans, createBody } from './humans.js';
import { GameCore } from './core.js';
import { NetClient } from './net/netclient.js';
import { weaponName } from './net/protocol.js';

// The browser side: rendering, audio, HUD, input and menus.
// It shows a "world" — either a local GameCore (offline vs bots) or a NetClient mirror of the
// server (online). Both report what happens through the same events, handled in onEvent().

const DEG = Math.PI / 180;
const v1 = new THREE.Vector3();

function makeBombMesh() {
  const g = new THREE.Group();
  const lm = (c) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.22), lm(0x3b4a2a));
  body.position.y = 0.05;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), lm(0x111111));
  pad.position.set(-0.05, 0.11, 0);
  const wire1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.015), lm(0xaa2020));
  wire1.position.set(0, 0.105, 0.07);
  const wire2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.015), lm(0x2040aa));
  wire2.position.set(0, 0.105, -0.07);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: 0x400000 }));
  led.position.set(0.1, 0.11, 0);
  g.add(body, pad, wire1, wire2, led);
  g.userData.led = led;
  g.traverse((m) => { m.castShadow = true; });
  g.visible = false;
  return g;
}

class Client {
  constructor() {
    this.settings = { sens: 1, quality: 'high', name: '', server: '', map: 'dust' };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('dust-strike-settings') || '{}')); } catch { /* ignore */ }
    this.gfx = new Graphics(document.getElementById('game'), this.settings.quality);
    this.renderer = this.gfx.renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc3d0d9, 0.0028);
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 600);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xc4d8f0, 0x96784e, 1.7));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 6.5));
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 220;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.gfx.setupSky(this.scene, sun.position.clone().sub(sun.target.position).normalize());
    this.gfx.setupDust(this.scene);

    this.setMap(MAPS[this.settings.map] ? this.settings.map : 'dust');
    this.effects = new Effects(this.scene);
    this.sound = new Sound();
    this.vm = new ViewModel();
    this.vm.setAspect(innerWidth / innerHeight);
    this.vm.scene.environment = this.gfx.studioEnv;
    this.gfx.buildComposer(this.scene, this.camera, this.vm.scene, this.vm.camera);
    this.gfx.setQuality(this.settings.quality, sun);
    this.hud = new Hud(this);
    this.flashEl = document.getElementById('flashed');
    this.bombMesh = makeBombMesh();
    this.scene.add(this.bombMesh);

    this.state = 'menu';
    this.mode = null; // 'offline' | 'online'
    this.world = null;
    this.core = null;
    this.net = null;
    this.paused = false;
    this.specTarget = null;
    this.shake = 0;
    this.menuAngle = 0;
    this.showVM = false;
    this.hitLog = [];
    this.ledT = 0;
    this.itemMeshes = new Map();
    this.nadeMeshes = new Map();
    this.smokeViz = new Map();
    this.flash = null;

    this.bindInput();
    this.bindMenu();
    addEventListener('resize', () => {
      this.gfx.resize();
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.vm.setAspect(innerWidth / innerHeight);
    });
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------- world view (read by the HUD) ----------

  // Load a map's visuals (and lighting/radar) — used by the menu, offline games and joined rooms.
  setMap(id) {
    if (this.map && this.map.id === id) return;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      if (!this.mapGroup.userData.shared) this.mapGroup.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const t of ['map', 'normalMap']) o.material[t]?.dispose();
        o.material.dispose();
      });
    }
    this.map = createMap(id);
    this.mapGroup = this.map.buildMeshes(this.scene);
    const { x: cx, z: cz } = this.map.center;
    this.sun.position.set(cx - 45, 80, cz + 30);
    this.sun.target.position.set(cx, 0, cz);
    this.hud?.refreshMap();
  }

  get player() { return this.world?.player || null; }
  get actors() { return this.world?.actors || []; }
  get bomb() { return this.world?.bomb || { state: 'none', pos: new THREE.Vector3() }; }
  get phase() { return this.world?.phase || 'freeze'; }
  get phaseT() { return this.world?.phaseT || 0; }
  get roundT() { return this.world?.roundT || 0; }
  get score() { return this.world?.score || { T: 0, CT: 0 }; }
  get round() { return this.world?.round || 0; }
  get time() { return this.world?.time || 0; }
  get ping() { return this.net ? this.net.ping : null; }
  canBuy() { return !!this.world && this.world.canBuy(this.player); }

  addBody(team) {
    const b = createBody(team);
    this.scene.add(b.root);
    return b;
  }
  removeBody(b) { this.scene.remove(b.root); }

  // ---------- input & menus ----------

  bindInput() {
    const inp = (this.input = { keys: {}, pressed: new Set(), mdx: 0, mdy: 0, fire: false, firePressed: false, fire2Pressed: false, wheel: 0 });
    const canvas = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (this.state !== 'playing' || this.paused) return;
      e.preventDefault();
      if (!e.repeat) inp.pressed.add(e.code);
      inp.keys[e.code] = true;
    });
    addEventListener('keyup', (e) => { inp.keys[e.code] = false; });
    addEventListener('blur', () => { inp.keys = {}; inp.fire = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) { inp.mdx += e.movementX; inp.mdy += e.movementY; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (!document.pointerLockElement) { this.lock(); return; }
      if (e.button === 0) { inp.fire = true; inp.firePressed = true; }
      if (e.button === 2) inp.fire2Pressed = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) inp.fire = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (document.pointerLockElement) inp.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.state !== 'playing') return;
      const locked = !!document.pointerLockElement;
      this.paused = !locked;
      document.getElementById('pause').classList.toggle('hidden', locked);
      if (!locked) { inp.fire = false; inp.keys = {}; }
    });
  }

  lock() {
    const c = this.renderer.domElement;
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => c.requestPointerLock());
    } catch {
      c.requestPointerLock();
    }
  }

  saveSettings() {
    try { localStorage.setItem('dust-strike-settings', JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  bindMenu() {
    const seg = (id) => {
      const el = document.getElementById(id);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      });
      return () => el.querySelector('.on').dataset.v;
    };
    const diff = seg('diff-seg');
    const mapSeg = document.getElementById('map-seg');
    const mapId = () => mapSeg.querySelector('.on').dataset.v;
    mapSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.map.id));
    mapSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      mapSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.settings.map = b.dataset.v;
      this.saveSettings();
      if (this.state === 'menu') this.setMap(b.dataset.v); // preview behind the menu
    });
    this.mapId = mapId;
    const gfxSeg = document.getElementById('gfx-seg');
    gfxSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.settings.quality));
    gfxSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      gfxSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.settings.quality = b.dataset.v;
      this.gfx.setQuality(b.dataset.v, this.sun);
      this.saveSettings();
    });
    const sens = document.getElementById('sens');
    const sensVal = document.getElementById('sens-val');
    sens.value = this.settings.sens;
    sensVal.textContent = Number(this.settings.sens).toFixed(2);
    sens.addEventListener('input', () => {
      this.settings.sens = Number(sens.value);
      sensVal.textContent = this.settings.sens.toFixed(2);
      this.saveSettings();
    });

    const nameEl = document.getElementById('mp-name');
    const serverEl = document.getElementById('mp-server');
    nameEl.value = this.settings.name || '';
    // When the page is served by the game server, default to joining that same server.
    serverEl.value = this.settings.server || (location.protocol.startsWith('http') && location.port !== '8123' ? location.host : 'localhost:8080');

    // ----- online: create / join rooms -----
    const sizeSeg = seg('size-seg');
    const botsEl = document.getElementById('mp-bots');
    const botsVal = document.getElementById('bots-val');
    const botsNote = document.getElementById('bots-note');
    const codeEl = document.getElementById('mp-code');
    const updateBots = () => {
      const size = Number(sizeSeg());
      botsEl.max = size * 2 - 1;
      if (Number(botsEl.value) > size * 2 - 1) botsEl.value = size * 2 - 1;
      const humans = size * 2 - Number(botsEl.value);
      botsVal.textContent = botsEl.value;
      botsNote.textContent = `(room for ${humans} player${humans === 1 ? '' : 's'})`;
    };
    document.getElementById('size-seg').addEventListener('click', () => setTimeout(updateBots));
    botsEl.addEventListener('input', updateBots);
    updateBots();
    const params = new URLSearchParams(location.search);
    if (params.get('room')) codeEl.value = params.get('room').toUpperCase().slice(0, 4);
    codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    const startBtn = document.getElementById('btn-start');
    const onlineBtns = ['btn-join', 'btn-create'].map((id) => document.getElementById(id));
    for (const b of [startBtn, ...onlineBtns]) b.disabled = true;
    startBtn.textContent = 'LOADING…';
    this.humansReady = loadHumans().then(() => {
      for (const b of [startBtn, ...onlineBtns]) b.disabled = false;
      startBtn.textContent = 'PLAY VS BOTS';
    });
    startBtn.addEventListener('click', () => {
      this.sound.init();
      // Like joining a CS server: the map shows behind a team selection screen.
      const size = MAPS[mapId()].teamSize || 5, d = diff();
      this.openTeamMenu({
        sub: `${MAPS[mapId()].name} · ${size}v${size} vs ${d} bots`,
        counts: { T: `${size} bots`, CT: `${size} bots` },
        onPick: (t) => { this.startOffline(t, d); this.lock(); },
      });
    });
    const saveOnline = () => {
      this.settings.name = nameEl.value.trim().slice(0, 16);
      this.settings.server = serverEl.value.trim();
      this.saveSettings();
    };
    document.getElementById('btn-create').addEventListener('click', () => {
      saveOnline();
      const size = Number(sizeSeg()), map = mapId(), bots = Math.min(Number(botsEl.value), size * 2 - 1), d = diff();
      this.openTeamMenu({
        sub: `New room · ${size}v${size} · ${MAPS[map].name} · ${bots} bots`,
        counts: { T: `0/${size} players`, CT: `0/${size} players` },
        onPick: (t) => this.onlineAction({ kind: 'create', team: t, teamSize: size, bots, diff: d, map }),
      });
    });
    const join = (code) => {
      saveOnline();
      if (!/^[A-Z0-9]{4}$/.test(code)) { this.setStatus('Enter the 4-letter room code'); return; }
      // Show who is on each side (from the room list) so a full team can't be picked.
      const r = (this.roomCache || []).find((x) => x.code === code);
      const full = r ? { T: r.humansT >= r.teamSize, CT: r.humansCT >= r.teamSize } : {};
      this.openTeamMenu({
        sub: r ? `Room ${code} · ${r.teamSize}v${r.teamSize} · ${MAPS[r.map]?.name || r.map}` : `Room ${code}`,
        counts: r ? { T: `${r.humansT}/${r.teamSize} players`, CT: `${r.humansCT}/${r.teamSize} players` } : { T: '', CT: '' },
        humans: r ? { T: r.humansT, CT: r.humansCT } : null,
        full,
        onPick: (t) => this.onlineAction({ kind: 'join', team: t, code }),
      });
    };
    document.getElementById('btn-join').addEventListener('click', () => join(codeEl.value));
    codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(codeEl.value); });
    document.getElementById('mp-rooms').addEventListener('click', (e) => {
      const row = e.target.closest('.mp-room');
      if (!row) return;
      codeEl.value = row.dataset.code;
      join(row.dataset.code);
    });
    document.getElementById('btn-refresh').addEventListener('click', () => { saveOnline(); this.refreshRooms(false); });
    serverEl.addEventListener('change', () => { saveOnline(); this.dropLobby(); this.refreshRooms(true); });
    this.serverEl = serverEl;
    this.nameEl = nameEl;
    setInterval(() => { if (this.state === 'menu') this.refreshRooms(true); }, 4000);
    this.humansReady.then(() => this.refreshRooms(true));

    // Team menu before a game starts: click a side or use the number keys like CS (1 T, 2 CT, 5 auto, 0 cancel).
    document.getElementById('teammenu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (b && !b.disabled) this.pickTeam(b.dataset.t);
    });
    addEventListener('keydown', (e) => {
      if (!this.teamMenu || this.teamMenu.ingame) return;
      const t = { Digit1: 'T', Numpad1: 'T', Digit2: 'CT', Numpad2: 'CT', Digit5: 'auto', Numpad5: 'auto', Digit0: 'cancel', Numpad0: 'cancel', Escape: 'cancel' }[e.code];
      if (t) { e.preventDefault(); this.pickTeam(t); }
    });

    document.getElementById('pause').addEventListener('click', (e) => {
      if (e.target.id === 'btn-quit' || e.target.closest('#pause-room')) return;
      this.lock();
    });
    document.getElementById('btn-quit').addEventListener('click', () => this.toMenu(''));
  }

  // ---------- team selection (CS "chooseteam") ----------

  // opts: { sub, counts: {T, CT}, humans?: {T, CT}, full?: {T, CT}, cur?, onPick(team), onCancel?, ingame? }
  openTeamMenu(opts) {
    const el = document.getElementById('teammenu');
    document.getElementById('tm-sub').textContent = opts.sub || '';
    opts.full = opts.full || {};
    for (const t of ['T', 'CT']) {
      const b = el.querySelector(`.tm-team.${t}`);
      b.disabled = !!opts.full[t];
      b.classList.toggle('cur', opts.cur === t);
      document.getElementById('tm-count-' + t).textContent = (opts.counts[t] || '') + (opts.full[t] ? ' · full' : '');
    }
    this.teamMenu = opts;
    this.hud.closeBuy();
    if (!opts.ingame) document.getElementById('menu').classList.add('hidden');
    el.classList.remove('hidden');
  }

  closeTeamMenu() {
    document.getElementById('teammenu').classList.add('hidden');
    this.teamMenu = null;
  }

  pickTeam(t) {
    const tm = this.teamMenu;
    if (!tm) return;
    this.closeTeamMenu();
    if (!tm.ingame) document.getElementById('menu').classList.remove('hidden'); // shows join status / errors
    if (t === 'cancel') { tm.onCancel?.(); return; }
    if (t === 'auto') {
      // The side with fewer players (random when even), skipping a full one.
      const h = tm.humans || { T: 0, CT: 0 };
      const open = ['T', 'CT'].filter((x) => !tm.full[x]);
      t = open.length === 1 ? open[0] : h.T === h.CT ? (Math.random() < 0.5 ? 'T' : 'CT') : h.T < h.CT ? 'T' : 'CT';
    }
    if (tm.full[t]) { this.openTeamMenu(tm); return; }
    tm.onPick(t);
  }

  // M in game: switch sides. You die if alive and play for the new team from the next round.
  openIngameTeamMenu() {
    const me = this.player;
    if (!me) return;
    const size = this.mode === 'offline' ? this.core.teamSize : this.net?.room?.teamSize || 5;
    const humans = { T: 0, CT: 0 }, bots = { T: 0, CT: 0 };
    for (const a of this.actors) {
      if (a === me) continue;
      if (a.isBot) bots[a.team]++; else humans[a.team]++;
    }
    const label = (t) => `${humans[t] + (me.team === t ? 1 : 0)}/${size} players${bots[t] ? ` · ${bots[t]} bots` : ''}`;
    this.openTeamMenu({
      ingame: true,
      sub: 'Press 1, 2 or 5 · 0 to cancel',
      cur: me.team,
      counts: { T: label('T'), CT: label('CT') },
      humans,
      full: { T: me.team !== 'T' && humans.T >= size, CT: me.team !== 'CT' && humans.CT >= size },
      onPick: (t) => {
        if (t === me.team) { this.hud.sub(`You are already a ${t === 'T' ? 'Terrorist' : 'Counter-Terrorist'}`, 2); return; }
        if (this.mode === 'offline') {
          if (this.core.changeTeam(me, t) === 'full') this.hud.sub('That team is full', 2);
        } else this.net?.switchTeam(t);
      },
    });
  }

  setStatus(text) {
    document.getElementById('mp-status').textContent = text || '';
  }

  toMenu(result) {
    if (this.net) { this.net.close(); this.net = null; }
    this.closeTeamMenu();
    this.state = 'menu';
    this.mode = null;
    this.paused = false;
    this.clearWorld();
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('menu-result').innerHTML = result;
    this.hud.show(false);
    this.hud.closeBuy();
    this.pendingAction = null;
    this.refreshRooms(true);
  }

  clearWorld() {
    for (const a of this.actors) if (a.body) this.removeBody(a.body);
    for (const m of this.itemMeshes.values()) this.scene.remove(m);
    this.itemMeshes.clear();
    for (const m of this.nadeMeshes.values()) this.scene.remove(m);
    this.nadeMeshes.clear();
    for (const g of this.smokeViz.values()) this.effects.removeSmoke(g);
    this.smokeViz.clear();
    this.flash = null;
    this.bombMesh.visible = false;
    this.effects.clear();
    this.world = null;
    this.core = null;
  }

  enterGame(mode) {
    this.mode = mode;
    this.state = 'playing';
    this.paused = false;
    this.specTarget = null;
    this.hitLog = [];
    document.getElementById('menu').classList.add('hidden');
    this.hud.show(true);
    this.hud.clearKillfeed();
    this.hud.lastMoney = null;
    this.hud.deathReport(null);
  }

  // ---------- offline: local simulation vs bots ----------

  startOffline(team, diffKey) {
    this.dropLobby();
    this.clearWorld();
    this.setMap(this.mapId());
    const core = new GameCore({ makeBody: (t) => this.addBody(t), removeBody: (b) => this.removeBody(b), diff: diffKey, mapId: this.map.id });
    core.on((type, d) => this.onEvent(type, d));
    const player = core.addActor(new Player(core, team, 'You'));
    core.player = player;
    this.core = core;
    this.world = core;
    this.enterGame('offline');
    core.balanceBots(); // fills both teams and starts the match
  }

  // ---------- online: lobby, rooms, authoritative server ----------

  serverUrl() {
    let url = (this.serverEl.value || '').trim();
    if (!url) return null;
    if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url.replace(/^https?:\/\//, '');
    if (!/\/ws$/.test(url)) url = url.replace(/\/$/, '') + '/ws';
    return url;
  }

  // One lobby connection is kept open in the menu for listing, creating and joining rooms.
  getLobby() {
    const url = this.serverUrl();
    if (!url) return null;
    if (this.lobby && !this.lobby.closed && this.lobby.url === url) return this.lobby;
    this.dropLobby();
    let net;
    try { net = new NetClient(this, url); } catch { return null; }
    this.lobby = net;
    net.onRooms = (rooms) => this.renderRooms(rooms);
    net.onStatus = (status, msg) => {
      if (status === 'error') {
        this.setStatus(msg);
      } else if (status === 'joined') {
        this.lobby = null;
        this.net = net;
        this.world = net.world;
        this.setStatus('');
        this.enterGame('online');
        this.lock();
      } else if (status === 'closed') {
        if (this.net === net) {
          this.net = null;
          this.toMenu(`<div class="lost">DISCONNECTED</div><div>${msg}</div>`);
          this.setStatus(msg);
        } else if (this.lobby === net) {
          this.lobby = null;
          if (this.pendingAction) this.setStatus(msg);
          this.renderRooms(null);
        }
      }
    };
    return net;
  }

  dropLobby() {
    if (this.lobby) { this.lobby.close(); this.lobby = null; }
  }

  async refreshRooms(silent) {
    const lobby = this.getLobby();
    if (!lobby) return;
    if (await lobby.ready) lobby.list();
    else if (!silent) this.setStatus('Could not connect to server');
  }

  renderRooms(rooms) {
    const el = document.getElementById('mp-rooms');
    if (!rooms) { el.innerHTML = '<div class="mp-note">Server not reachable</div>'; return; }
    this.roomCache = rooms;
    const bots = (n) => (n === 0 ? 'no bots' : `${n} bot${n === 1 ? '' : 's'}`);
    el.innerHTML = rooms.map((r) => `<div class="mp-room" data-code="${r.code}">
        <b>${r.code}</b><span class="meta">${MAPS[r.map]?.name || r.map} · ${r.teamSize}v${r.teamSize} · ${bots(r.bots)} · ${r.diff} · ${r.humans}/${r.teamSize * 2} players</span>
        <span class="state ${r.playing ? '' : 'wait'}">${r.playing ? 'LIVE' : 'WAITING'}</span></div>`).join('');
  }

  async onlineAction(a) {
    this.sound.init();
    const lobby = this.getLobby();
    if (!lobby) { this.setStatus('Enter a server address'); return; }
    this.pendingAction = a;
    this.setStatus('Connecting…');
    if (!(await lobby.ready)) return;
    this.setStatus(a.kind === 'create' ? 'Creating room…' : `Joining ${a.code}…`);
    const name = this.settings.name || 'Player';
    if (a.kind === 'create') lobby.create(name, a.team, a.teamSize, a.bots, a.diff, a.map);
    else lobby.join(name, a.team, a.code);
  }

  get roomInfo() { return this.mode === 'online' && this.net ? this.net.room : null; }

  // ---------- events (from the local core or the server) ----------

  onEvent(type, d) {
    const me = this.player;
    switch (type) {
      case 'vm':
        if (d.to !== me) return;
        if (d.op === 'set') this.vm.set(me.weapon.def.id, me.team);
        else if (d.op === 'throw') this.vm.throw();
        else if (d.op === 'fire') this.vm.fire(d.def);
        else this.vm.swing(d.stab);
        return;
      case 'shot': {
        const local = d.src === me;
        this.sound.shot(d.def.sound, local ? null : d.from);
        this.effects.flash(d.from);
        if (d.tracer) this.effects.tracer(d.from, d.to);
        return;
      }
      case 'melee':
        if (d.src === me) this.sound.knife(d.result);
        else if (d.pos && this.camera.position.distanceTo(d.pos) < 12) this.sound.knife(d.result);
        return;
      case 'sound': {
        if (d.to && d.to !== me) return;
        const local = d.src === me || (d.to === me && !d.pos);
        const pos = local ? null : d.pos;
        switch (d.name) {
          case 'step':
            if (pos && this.camera.position.distanceTo(pos) > 30) return;
            this.sound.step(pos, local ? 0.3 : 0.55);
            return;
          case 'land': if (local) this.sound.land(); return;
          case 'reload': this.sound.reload(d.arg); return;
          case 'beep': this.sound.beep(pos); this.ledT = 0.07; return;
          case 'throw': if (local) this.sound.throw(); return;
          case 'bounce': this.sound.bounce(d.pos); return;
          default: this.sound[d.name]?.();
        }
        return;
      }
      case 'impact':
        if (!d.noHole) this.effects.hole(d.pos, d.normal);
        this.effects.impact(d.pos, d.normal);
        return;
      case 'blood': this.effects.blood(d.pos, d.dir); return;
      case 'helmet': this.sound.headshot(d.pos); return;
      case 'hitmark': if (d.to === me) this.sound.hit(); return;
      case 'hurt':
        if (d.to !== me) return;
        this.hud.damage();
        this.sound.hurt();
        this.hitLog.push({ from: d.from ? d.from.name : null, team: d.from ? d.from.team : null, weapon: d.def.name, region: d.region, hp: d.hp, armor: d.armor, dist: d.dist });
        return;
      case 'kill':
        this.hud.killfeed(d.killer, d.victim, d.def, d.hs);
        if (d.hs) this.sound.headshot(d.pos);
        if (d.victim && d.victim === me) {
          this.hud.deathReport(this.hitLog, d.killer, d.def, d.hs);
          this.hud.closeBuy();
        }
        return;
      case 'nade': {
        const near = this.camera.position.distanceTo(d.pos);
        if (d.type === 'he') {
          this.effects.explosion(d.pos, 0.45);
          this.sound.heBlast(d.pos);
          if (near < 14) this.shake = Math.max(this.shake, 0.6 * (1 - near / 14));
        } else if (d.type === 'flash') {
          this.effects.flashPop(d.pos);
          this.sound.flashPop(d.pos);
        } else this.sound.smokePop(d.pos);
        return;
      }
      case 'flashed':
        if (d.to !== me) return;
        // Full white for a moment, then a slow fade; stronger flashes last longer.
        this.flash = { t: 0, hold: 0.2 + 1.4 * d.amount, fade: 0.6 + 3 * d.amount, amount: Math.min(1, 0.4 + d.amount) };
        this.sound.ring(d.amount);
        return;
      case 'explosion':
        this.effects.explosion(d.pos);
        this.sound.explosion(d.pos);
        if (this.camera.position.distanceTo(d.pos) < 60) this.shake = 1.2;
        return;
      case 'announce':
        this.hud.center(d.text, d.dur, d.cls || '');
        if (d.sub) this.hud.sub(d.sub, d.dur);
        return;
      case 'notify': if (!d.to || d.to === me) this.hud.sub(d.text, d.dur); return;
      case 'say': this.sound.say(d.text); return;
      case 'roundStart':
        this.effects.clear();
        this.hud.closeBuy();
        this.hud.deathReport(null);
        this.hitLog = [];
        this.specTarget = null;
        return;
      case 'matchEnd': {
        const label = d.winner === 'T' ? 'Terrorists' : 'Counter-Terrorists';
        const score = `${Math.max(d.score.T, d.score.CT)} – ${Math.min(d.score.T, d.score.CT)}`;
        if (this.mode === 'offline') {
          const won = d.winner === me.team;
          this.toMenu(`<div class="${won ? 'won' : 'lost'}">${won ? 'VICTORY' : 'DEFEAT'}</div>
            <div>${label} win the match ${score}</div>
            <div class="kd">Your score: ${me.kills} kills / ${me.deaths} deaths</div>`);
        } else {
          this.hud.center(`${label} win the match ${score}`, 9, d.winner);
          this.hud.sub('A new match starts in 10 seconds', 9);
        }
        return;
      }
      default:
    }
  }

  // ---------- buying & UI keys ----------

  buy(id) {
    if (this.mode === 'offline') this.core.buyItem(this.player, id);
    else if (this.net) this.net.buy(id);
    // Like CS: picking a weapon or equipment closes the menu; ammo can be bought box after box.
    if (id === 'ammo1' || id === 'ammo2') {
      this.hud.renderBuy();
      if (this.net) setTimeout(() => this.hud.buyOpen && this.hud.renderBuy(), 150);
    } else this.hud.closeBuy();
  }

  handleUiKeys(inp) {
    const hud = this.hud, me = this.player;
    if (!me) return;
    if (inp.pressed.has('KeyM')) {
      if (this.teamMenu) this.pickTeam('cancel');
      else this.openIngameTeamMenu();
    }
    if (this.teamMenu) {
      // The team menu owns the number keys while it is open.
      for (const [code, t] of [['Digit1', 'T'], ['Digit2', 'CT'], ['Digit5', 'auto'], ['Digit0', 'cancel']]) {
        if (inp.pressed.has(code)) { inp.pressed.delete(code); this.pickTeam(t); }
      }
      for (let i = 0; i <= 9; i++) inp.pressed.delete('Digit' + i);
      return;
    }
    if (inp.pressed.has('KeyB')) {
      if (hud.buyOpen) hud.closeBuy();
      else if (this.canBuy()) hud.openBuy();
      else if (me.alive) hud.sub(this.world.buyTimeLeft() <= 0 ? 'Buy time has expired' : 'You are not in a buy zone', 2);
    }
    if (hud.buyOpen) {
      if (!this.canBuy()) hud.closeBuy();
      for (let i = 0; i <= 9; i++) {
        const code = 'Digit' + i;
        if (!inp.pressed.has(code)) continue;
        inp.pressed.delete(code);
        const id = hud.buyPick(i);
        if (id) this.buy(id);
      }
      // The mouse belongs to the menu: click buttons, don't shoot.
      if (inp.firePressed && hud.buyOpen) {
        const id = hud.buyClick();
        if (id) this.buy(id);
      }
      inp.fire = inp.firePressed = inp.fire2Pressed = false;
      inp.wheel = 0;
    }
    if (!me.alive && inp.firePressed) this.pickSpec(true);
  }

  // ---------- HUD helpers ----------

  aimTarget() {
    const p = this.player;
    const eye = p.eye(new THREE.Vector3());
    const dir = p.aimDir(p.yaw + p.punchY, p.pitch + p.punchP, 0);
    const wall = this.map.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 80);
    let maxT = wall ? wall.t : 80, best = null;
    for (const a of this.actors) {
      if (a === p || !a.alive || a.netVisible === false) continue;
      const h = a.hitTest(eye, dir, maxT);
      if (h) { maxT = h.t; best = a; }
    }
    return best;
  }

  crosshairGap() {
    const p = this.player, def = p.weapon.def;
    if (def.melee) return 5;
    const s = p.currentSpread(Math.hypot(p.vel.x, p.vel.z));
    const px = (Math.tan(s) / Math.tan((this.camera.fov * Math.PI) / 360)) * (innerHeight / 2);
    return Math.min(90, 4 + px);
  }

  hintText() {
    const p = this.player, b = this.bomb;
    if (this.phase === 'warmup') return `Warmup — waiting for players${this.roomInfo ? ` · room code ${this.roomInfo.code}` : ''}`;
    if (!p || !p.alive || this.phase === 'post' || this.phase === 'over') return '';
    if (this.phase === 'freeze') return 'Freeze time — press B to buy';
    if (p.hasBomb && this.map.siteAt(p.pos.x, p.pos.z) && !p.task) return 'Hold E to plant the bomb';
    if (p.team === 'CT' && b.state === 'planted' && !p.task && p.canDefuse()) return 'Hold E to defuse the bomb';
    if (this.canBuy() && !this.hud.buyOpen) return 'Press B to buy';
    return '';
  }

  // ---------- camera ----------

  pickSpec(cycle) {
    const me = this.player;
    const mates = this.actors.filter((a) => a !== me && a.alive && a.team === me.team && a.netVisible !== false);
    if (!mates.length) { this.specTarget = null; return false; }
    if (cycle || !this.specTarget || !this.specTarget.alive || this.specTarget.team !== me.team) {
      const i = mates.indexOf(this.specTarget);
      this.specTarget = mates[(i + 1) % mates.length];
    }
    return true;
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    let fov = 74;
    this.showVM = false;
    if (p.alive) {
      this.specTarget = null;
      if (this.net) this.net.eye(cam.position); else p.eye(cam.position);
      // Smooth the camera over stair steps instead of snapping up/down 0.5 m.
      const dy = p.pos.y - (this.prevFootY ?? p.pos.y);
      if (p.onGround && Math.abs(dy) > 0.05 && Math.abs(dy) < 0.6) this.stepOff = (this.stepOff || 0) - dy;
      this.prevFootY = p.pos.y;
      this.stepOff = (this.stepOff || 0) * Math.exp(-dt * 14);
      cam.position.y += this.stepOff;
      cam.rotation.set(p.pitch + p.punchP, p.yaw + p.punchY, 0);
      const zoomFov = p.scope ? p.weapon.def.zoom?.[p.scope - 1] : null;
      if (zoomFov) fov = zoomFov;
      this.showVM = !zoomFov;
    } else if (p.deathT < 2.2 || !this.pickSpec(false)) {
      this.specTarget = null;
      const k = Math.min(1, p.deathT / 0.6);
      cam.position.set(p.pos.x, p.pos.y + 1.64 - 1.3 * k, p.pos.z);
      cam.rotation.set(p.pitch * (1 - k) + 0.25 * k, p.yaw, 0.5 * k);
    } else {
      const s = this.specTarget;
      s.eye(cam.position);
      cam.rotation.set(s.aimPitch, s.aimYaw, 0);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.06;
      cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.06;
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  menuCam(dt) {
    this.menuAngle += dt * 0.05;
    const { x: cx, z: cz } = this.map.center;
    const r = Math.max(this.map.width, this.map.depth) * 0.68;
    this.camera.position.set(cx + Math.cos(this.menuAngle) * r, r * 0.72, cz + Math.sin(this.menuAngle) * r * 0.87);
    this.camera.lookAt(cx, 0, cz);
    if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
    this.showVM = false;
  }

  // ---------- world presentation ----------

  syncWorldVisuals(dt) {
    for (const a of this.actors) {
      if (!a.body) continue;
      a.body.root.visible = a !== this.specTarget && a.netVisible !== false;
    }
    // Dropped weapons.
    const live = new Set();
    for (const it of this.world.items) {
      live.add(it.id);
      if (this.itemMeshes.has(it.id)) continue;
      const id = it.w ? it.w.def.id : weaponName(it.weapon);
      if (!id) continue;
      const mesh = gunInstance(id);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.set(0, it.rot, Math.PI / 2);
      mesh.position.set(it.x, it.y + 0.04, it.z);
      this.scene.add(mesh);
      this.itemMeshes.set(it.id, mesh);
    }
    for (const [id, m] of this.itemMeshes) if (!live.has(id)) { this.scene.remove(m); this.itemMeshes.delete(id); }
    // Grenades in flight (offline: core entries; online: snapshot entries).
    const NADE_ID = { he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade' };
    const flying = new Set();
    for (const n of this.world.nades || []) {
      flying.add(n.id);
      let mesh = this.nadeMeshes.get(n.id);
      if (!mesh) {
        mesh = gunInstance(NADE_ID[n.type] || n.type);
        this.scene.add(mesh);
        this.nadeMeshes.set(n.id, mesh);
      }
      mesh.position.set(n.pos.x, n.pos.y - 0.04, n.pos.z);
      if (!n.rest) { mesh.rotation.x += dt * 9; mesh.rotation.z += dt * 5; }
    }
    for (const [id, m] of this.nadeMeshes) if (!flying.has(id)) { this.scene.remove(m); this.nadeMeshes.delete(id); }
    // Smoke clouds.
    const clouds = new Set();
    for (const sm of this.world.smokes || []) {
      clouds.add(sm.id);
      let g = this.smokeViz.get(sm.id);
      if (!g) { g = this.effects.makeSmoke(); this.smokeViz.set(sm.id, g); }
      g.position.set(sm.pos.x, sm.pos.y + 0.6, sm.pos.z);
      const radius = sm.radius ?? this.core.smokeRadius(sm);
      this.effects.updateSmoke(g, radius, sm.r ?? 4.6, performance.now() / 1000);
    }
    for (const [id, g] of this.smokeViz) if (!clouds.has(id)) { this.effects.removeSmoke(g); this.smokeViz.delete(id); }
    // Flashbang white-out.
    let white = 0;
    if (this.flash) {
      const f = this.flash;
      f.t += dt;
      white = f.t < f.hold ? f.amount : f.amount * Math.max(0, 1 - (f.t - f.hold) / f.fade);
      if (f.t > f.hold + f.fade) this.flash = null;
    }
    if (this.flashEl.__o !== white) { this.flashEl.style.opacity = white; this.flashEl.__o = white; }
    // Bomb on the ground.
    const b = this.bomb;
    this.bombMesh.visible = b.state === 'dropped' || b.state === 'planted';
    if (this.bombMesh.visible) this.bombMesh.position.copy(b.pos);
    this.ledT -= dt;
    this.bombMesh.userData.led.material.color.setHex(this.ledT > 0 ? 0xff2020 : 0x400000);
  }

  // ---------- loop ----------

  applyMouse(inp) {
    const p = this.player;
    if (this.hud.buyOpen && !this.paused) { this.hud.moveCursor(inp.mdx, inp.mdy); return; }
    if (!p || !p.alive || this.paused) return;
    const zoomFov = p.scope ? p.weapon.def.zoom?.[p.scope - 1] : null;
    const zoom = zoomFov ? Math.tan((zoomFov * Math.PI) / 360) / Math.tan((74 * Math.PI) / 360) : 1;
    const s = this.settings.sens * 0.0022 * zoom;
    p.yaw -= inp.mdx * s;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - inp.mdy * s));
  }

  playerInput(inp) {
    const p = this.player;
    return { ...inp, yaw: p.yaw, pitch: p.pitch };
  }

  update(dt) {
    const inp = this.input;
    this.applyMouse(inp);
    if (!this.paused) this.handleUiKeys(inp);
    if (this.mode === 'offline') {
      this.core.step(dt, (d) => this.player.update(d, this.playerInput(inp)));
    } else if (this.net) {
      if (!this.paused) this.net.collect(inp, this.hud.buyOpen || !!this.teamMenu);
      this.net.update(dt, inp, this.paused);
    }
    if (!this.player) return;
    this.effects.update(dt);
    this.syncWorldVisuals(dt);
    const p = this.player;
    this.vm.update(dt, {
      speed: Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 6),
      onGround: p.onGround, mdx: inp.mdx, mdy: inp.mdy, crouch: p.crouchAmt,
      reload: p.reloading ? p.reloadT / p.weapon.def.reload : -1,
    });
    this.updateCamera(dt);
    this.camera.getWorldDirection(v1);
    this.sound.listener(this.camera.position, v1);
    this.hud.update(dt);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    // Online play keeps running while paused (the server doesn't stop); offline pauses.
    if (this.state === 'playing' && (!this.paused || this.mode === 'online')) this.update(dt);
    else if (this.state === 'menu') this.menuCam(dt);
    this.gfx.updateDust(dt, this.camera.position);
    this.gfx.render(dt, this.showVM && this.state === 'playing');
    const inp = this.input;
    inp.pressed.clear();
    inp.mdx = inp.mdy = 0;
    inp.fire2Pressed = false;
    inp.firePressed = false;
    inp.wheel = 0;
  }
}

// Maps made from 3D models: fetch once, index the triangles for collision and keep the model for rendering.
async function loadMeshMaps() {
  const status = document.querySelector('#menu .tag');
  const was = status.textContent;
  for (const [id, def] of Object.entries(MAPS)) {
    if (!def.mesh) continue;
    status.textContent = `loading ${def.name}…`;
    try {
      const buf = await (await fetch(def.mesh)).arrayBuffer();
      const data = await preloadMap(id, async () => buf);
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      // Drop the file's own root transform and apply ours (same as the collision mesh).
      gltf.scene.traverse((o) => {
        if (o !== gltf.scene) { o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); }
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        const m = o.material;
        if (m.map) { m.map.anisotropy = 8; m.map.colorSpace = THREE.SRGBColorSpace; }
        m.roughness = 0.95;
        m.metalness = 0;
      });
      const { scale, flip, offset } = data.transform;
      const root = new THREE.Group();
      root.add(gltf.scene);
      gltf.scene.scale.set(scale, scale * flip, scale * flip);
      root.position.set(offset.x, offset.y, offset.z);
      data.visual = root;
    } catch (e) {
      console.error('map load failed', id, e);
      delete MAPS[id];
      document.querySelector(`#map-seg [data-v="${id}"]`)?.remove();
    }
  }
  status.textContent = was;
}

loadMeshMaps().then(() => { window.game = new Client(); });
