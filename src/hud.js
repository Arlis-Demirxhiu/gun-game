import { CELL, FLOOR, WALL } from './map.js';
import { WEAPONS, EQUIPMENT, GRENADES, BUY_MENU, AMMO, WEAPON_INFO, EQUIP_INFO } from './weapons.js';
import { gunIcon } from './gunicons.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.g = game;
    this.el = {
      hud: $('hud'), hp: $('hp-val'), hpBox: $('hp'), armor: $('armor-val'), money: $('money-val'), moneyDelta: $('money-delta'),
      mag: $('ammo-mag'), res: $('ammo-res'), ammo: $('ammo'), timer: $('timer'), c4planted: $('c4-planted'),
      scoreCT: $('score-ct'), scoreT: $('score-t'), aliveCT: $('alive-ct'), aliveT: $('alive-t'), roundNum: $('round-num'),
      kill: $('killfeed'), center: $('center-msg'), sub: $('sub-msg'), hint: $('hint'), aim: $('aim-name'), spec: $('spectate'),
      prog: $('progress'), progBar: $('progress-bar'), progLabel: $('progress-label'),
      cross: $('crosshair'), scope: $('scope'), dmg: $('damage'), buy: $('buymenu'), board: $('scoreboard'),
      c4: $('c4'), weapon: $('weapon-name'), radar: $('radar'), report: $('death-report'), roomTag: $('room-tag'), pauseRoom: $('pause-room'), nades: $('nades'),
    };
    this.radarCtx = this.el.radar.getContext('2d');
    this.mapImg = this.renderRadarMap();
    this.buyOpen = false;
    this.buyCat = null;
    this.cursor = { x: 0, y: 0 };
    this.centerT = 0;
    this.subT = 0;
    this.dmgA = 0;
    this.lastMoney = null;
    this.moneyT = 0;
    this.boardT = 0;
    this.cache = {};
  }

  set(key, el, val) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    el.textContent = val;
  }

  toggle(key, el, show) {
    if (this.cache[key] === show) return;
    this.cache[key] = show;
    el.classList.toggle('hidden', !show);
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  // Returns { canvas, x0, z0, w, d }: the picture and the world rectangle it covers.
  renderRadarMap() {
    if (this.g.map.isMesh) return this.g.map.radar();
    const g = this.g.map, S = 8;
    const c = document.createElement('canvas');
    c.width = g.w * S;
    c.height = g.h * S;
    const x = c.getContext('2d');
    for (let gz = 0; gz < g.h; gz++) {
      for (let gx = 0; gx < g.w; gx++) {
        const t = g.type(gx, gz);
        if (t === WALL) continue;
        x.fillStyle = t === FLOOR ? 'rgba(205,185,145,0.6)' : 'rgba(120,95,60,0.85)';
        x.fillRect(gx * S, gz * S, S, S);
      }
    }
    x.font = 'bold 40px Arial';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(220,40,30,0.9)';
    for (const [letter, cx, cz] of g.def.decals) x.fillText(letter, cx * S, cz * S);
    return { canvas: c, x0: 0, z0: 0, w: g.w * CELL, d: g.h * CELL };
  }

  // Called when the client switches maps.
  refreshMap() { this.mapImg = this.renderRadarMap(); }

  center(text, dur = 3, cls = '') {
    this.el.center.textContent = text;
    this.el.center.className = cls;
    this.el.center.style.opacity = 1;
    this.centerT = dur;
  }

  sub(text, dur = 3) {
    this.el.sub.textContent = text;
    this.el.sub.style.opacity = 1;
    this.subT = dur;
  }

  progress(frac, label) {
    if (frac === null || frac === undefined) {
      this.toggle('prog', this.el.prog, false);
      return;
    }
    this.toggle('prog', this.el.prog, true);
    this.el.progBar.style.width = `${Math.min(100, frac * 100).toFixed(1)}%`;
    this.set('progLabel', this.el.progLabel, label);
  }

  damage() {
    this.dmgA = Math.min(0.7, this.dmgA + 0.35);
  }

  killfeed(attacker, victim, def, hs) {
    const row = document.createElement('div');
    const me = (attacker && attacker.isPlayer) || victim.isPlayer;
    row.className = 'kf' + (me ? ' me' : '');
    row.innerHTML =
      (attacker && attacker !== victim ? `<span class="${attacker.team}">${esc(attacker.name)}</span> ` : '') +
      `<span class="kw">${esc(def.name)}</span>` +
      (hs ? ' <span class="hs">HS</span>' : '') +
      ` <span class="${victim.team}">${esc(victim.name)}</span>`;
    this.el.kill.appendChild(row);
    while (this.el.kill.children.length > 6) this.el.kill.firstChild.remove();
    setTimeout(() => row.remove(), 7000);
  }

  // Shown on death: every hit you took this life, who dealt it, where it landed and how much it did.
  deathReport(log, killer, def, hs) {
    const el = this.el.report;
    if (!log) { el.classList.add('hidden'); return; }
    const REG = { head: 'Head', chest: 'Chest', stomach: 'Stomach', legs: 'Legs' };
    const rows = log.map((h, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td class="${h.team || ''}">${h.from ? esc(h.from) : '—'}</td>
        <td>${esc(h.weapon)}</td>
        <td class="reg ${h.region}">${REG[h.region] || esc(h.region)}</td>
        <td class="dmg">-${h.hp}</td>
        <td class="arm">${h.armor > 0 ? '-' + Math.round(h.armor) : ''}</td>
        <td class="dist">${h.dist !== null ? Math.round(h.dist) + 'm' : ''}</td></tr>`).join('');
    const total = log.reduce((a, h) => a + h.hp, 0);
    const byRegion = {};
    for (const h of log) byRegion[h.region] = (byRegion[h.region] || 0) + 1;
    const summary = Object.entries(byRegion).map(([r, n]) => `${n}× ${REG[r] || r}`).join(' · ');
    const who = killer ? `<span class="${killer.team}">${esc(killer.name)}</span> with ${esc(def.name)}${hs ? ' <span class="hs">(headshot)</span>' : ''}` : esc(def.name);
    el.innerHTML = `<div class="dr-head">KILLED BY ${who}</div>
      <div class="dr-sub">${log.length} hit${log.length === 1 ? '' : 's'} taken · ${total} damage${summary ? ' · ' + summary : ''}</div>
      <table><tr><th>#</th><th>From</th><th>Weapon</th><th>Hit</th><th>HP</th><th>Armor</th><th>Range</th></tr>${rows}</table>`;
    el.classList.remove('hidden');
  }

  clearKillfeed() {
    this.el.kill.innerHTML = '';
  }

  // ---------- buy menu (CS 1.6 VGUI style) ----------
  // Number keys or the mouse pick a category, then an item. The mouse drives a menu cursor instead of
  // the view while it's open.

  openBuy() {
    this.buyOpen = true;
    this.buyCat = null;
    this.buyHover = null;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.renderBuy();
    this.el.buy.classList.remove('hidden');
    this.moveCursor(0, 0);
  }

  closeBuy() {
    this.buyOpen = false;
    this.buyCat = null;
    this.el.buy.classList.add('hidden');
  }

  // Entries of the current page: categories, or the items of the open category for this team.
  buyEntries() {
    if (this.buyCat === null) return BUY_MENU;
    return BUY_MENU[this.buyCat].items[this.g.player.team];
  }

  // Number key (or click) n: opens a category, or returns the id to buy ('ammo1'/'ammo2' straight away).
  buyPick(n) {
    if (n === 0) { this.buyBack(); return null; }
    const e = this.buyEntries()[n - 1];
    if (!e) return null;
    if (this.buyCat === null) {
      if (e.buy) return e.buy;
      this.buyCat = n - 1;
      this.buyHover = null;
      this.renderBuy();
      return null;
    }
    return e;
  }

  // 0: back to the categories, or close from the top.
  buyBack() {
    if (this.buyCat === null) this.closeBuy();
    else { this.buyCat = null; this.buyHover = null; this.renderBuy(); }
  }

  // Mouse movement while the menu is open (pointer lock gives deltas only).
  moveCursor(dx, dy) {
    const c = this.cursor;
    c.x = Math.max(0, Math.min(innerWidth - 2, c.x + dx));
    c.y = Math.max(0, Math.min(innerHeight - 2, c.y + dy));
    const cur = this.el.buy.querySelector('.bm-cursor');
    if (cur) cur.style.transform = `translate(${c.x}px, ${c.y}px)`;
    const btn = this.buttonAtCursor();
    const n = btn ? Number(btn.dataset.n) : null;
    if (n !== this.buyHover) {
      this.buyHover = n;
      this.el.buy.querySelectorAll('.bm-btn').forEach((b) => b.classList.toggle('hover', Number(b.dataset.n) === n));
      this.renderBuyInfo();
    }
  }

  buttonAtCursor() {
    const cur = this.el.buy.querySelector('.bm-cursor');
    if (cur) cur.style.display = 'none'; // so it isn't the element under itself
    const el = document.elementFromPoint(this.cursor.x, this.cursor.y);
    if (cur) cur.style.display = '';
    return el ? el.closest('.bm-btn') : null;
  }

  // Left click in the menu: same as pressing that button's number.
  buyClick() {
    const btn = this.buttonAtCursor();
    return btn && !btn.disabled ? this.buyPick(Number(btn.dataset.n)) : null;
  }

  // What you already have of an item (so it shows as owned).
  owns(p, id) {
    const item = WEAPONS[id] || EQUIPMENT[id];
    if (item.nade) return p.nades[id] >= item.max;
    if (WEAPONS[id]) return Object.values(p.inv).some((w) => w && w.def.id === id);
    return (id === 'kevlar' && p.armor >= 100) || (id === 'helmet' && p.helmet && p.armor >= 100) || (id === 'defuse' && p.hasKit);
  }

  ammoFor(p, slot) {
    const w = p.inv[slot];
    const pack = w && AMMO[WEAPON_INFO[w.def.id]?.ammo];
    return pack ? { w, pack } : null;
  }

  renderBuy() {
    const p = this.g.player;
    if (!p) return;
    const cat = this.buyCat === null ? null : BUY_MENU[this.buyCat];
    const row = (n, name, price, cls = '') => `<button class="bm-btn ${cls}${this.buyHover === n ? ' hover' : ''}" data-n="${n}">
      <span class="bm-k">${n}</span><span class="bm-name">${esc(name)}</span>${price !== null ? `<span class="bm-price">$${price}</span>` : ''}</button>`;
    let rows;
    if (!cat) {
      rows = BUY_MENU.map((c, i) => {
        if (!c.buy) return row(i + 1, c.name, null);
        const a = this.ammoFor(p, c.buy === 'ammo1' ? 1 : 2);
        return row(i + 1, c.name, a ? a.pack.price : null, !a || a.w.reserve >= a.w.def.reserve ? 'dis' : p.money < a.pack.price ? 'poor' : '');
      });
    } else {
      rows = cat.items[p.team].map((id, i) => {
        const item = WEAPONS[id] || EQUIPMENT[id];
        let price = item.price;
        if (id === 'helmet' && p.armor >= 100 && !p.helmet) price = 350;
        return row(i + 1, item.name, price, this.owns(p, id) ? 'owned' : p.money < price ? 'poor' : '');
      });
    }
    this.el.buy.innerHTML = `<div class="bm-panel">
        <div class="bm-head"><span class="bm-title">${cat ? esc(cat.name) : 'Buy Item'}</span><span class="bm-money">$${p.money}</span></div>
        <div class="bm-body">
          <div class="bm-list">${rows.join('')}<div class="bm-gap"></div>${row(0, cat ? 'Back' : 'Cancel', null, 'bm-cancel')}</div>
          <div class="bm-info"></div>
        </div>
      </div><div class="bm-cursor"></div>`;
    this.moveCursor(0, 0);
    this.renderBuyInfo();
  }

  // Right-hand panel: picture and facts for the hovered item (or what's in the hovered category).
  renderBuyInfo() {
    const info = this.el.buy.querySelector('.bm-info');
    if (!info) return;
    const p = this.g.player, n = this.buyHover;
    const line = (k, v) => `<div class="bm-row"><span>${k}</span><b>${v}</b></div>`;
    if (!n) {
      info.innerHTML = `<div class="bm-hint">${this.buyCat === null ? 'Select a category' : 'Select an item'}<br><small>number keys or click · B closes</small></div>`;
      return;
    }
    const e = this.buyEntries()[n - 1];
    if (!e) { info.innerHTML = ''; return; }
    if (this.buyCat === null) {
      if (e.buy) {
        const a = this.ammoFor(p, e.buy === 'ammo1' ? 1 : 2);
        info.innerHTML = a
          ? `<div class="bm-iname">${esc(a.pack.name)} ammo</div>${line('Price', '$' + a.pack.price)}${line('Rounds per box', a.pack.rounds)}${line('For', esc(a.w.def.name))}${line('Reserve', `${a.w.reserve} / ${a.w.def.reserve}`)}`
          : `<div class="bm-hint">You don't have a ${e.buy === 'ammo1' ? 'primary' : 'secondary'} weapon</div>`;
      } else {
        info.innerHTML = `<div class="bm-iname">${esc(e.name)}</div>` + e.items[p.team].map((id) => {
          const it = WEAPONS[id] || EQUIPMENT[id];
          return line(esc(it.name), '$' + it.price);
        }).join('');
      }
      return;
    }
    const id = e, W = WEAPONS[id], item = W || EQUIPMENT[id], fx = WEAPON_INFO[id];
    const img = W ? gunIcon(id) : null;
    let html = `${img ? `<img class="bm-img" src="${img}" alt="">` : ''}<div class="bm-iname">${esc(item.name)}</div>`;
    html += line('Price', '$' + item.price);
    if (fx) {
      html += line('Country of origin', fx.origin) + line('Caliber', fx.caliber) + line('Clip capacity', `${W.mag} rounds`)
        + line('Rate of fire', `${Math.round(60 / W.rate)} RPM`) + line('Weight (loaded)', `${fx.weight.toFixed(1)} kg`)
        + line('Damage', W.pellets ? `${W.dmg} x ${W.pellets} pellets` : W.dmg) + line('Armor penetration', `${Math.round(W.pen * 100)}%`)
        + line('Movement speed', `${Math.round((W.speed / 6.35) * 100)}%`);
    } else if (EQUIP_INFO[id]) html += `<div class="bm-desc">${EQUIP_INFO[id]}</div>`;
    if (item.team) html += line('Team', item.team === 'T' ? 'Terrorists only' : 'Counter-Terrorists only');
    if (this.owns(p, id)) html += '<div class="bm-owned">You already have this</div>';
    info.innerHTML = html;
  }

  renderBoard() {
    const g = this.g;
    const mine = g.player.team;
    const section = (team, title) => {
      const rows = g.actors
        .filter((a) => a.team === team)
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((a) => `<tr class="${a.alive ? '' : 'dead'} ${a.isPlayer ? 'me' : ''}">
          <td>${esc(a.name)}${a.hasBomb && team === mine ? ' <i class="bomb">BOMB</i>' : ''}</td>
          <td>${team === mine ? '$' + a.money : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.alive ? '' : 'DEAD'}</td></tr>`)
        .join('');
      return `<div class="sb-team ${team}"><div class="sb-head"><span>${title}</span><span>${g.score[team]}</span></div>
        <table><tr><th>Name</th><th>Money</th><th>K</th><th>D</th><th></th></tr>${rows}</table></div>`;
    };
    const net = g.ping !== null && g.ping !== undefined ? `<div class="sb-net">Online · ping ${g.ping} ms</div>` : '';
    this.el.board.innerHTML = section('CT', 'Counter-Terrorists') + section('T', 'Terrorists') + net;
  }

  drawRadar() {
    const g = this.g, p = g.player;
    const subject = p.alive ? p : g.specTarget || p;
    const ctx = this.radarCtx, R = 100, k = 2.0;
    const yaw = subject.isBot ? subject.aimYaw : subject.yaw;
    ctx.clearRect(0, 0, 200, 200);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 200, 200);
    ctx.translate(R, R);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.translate(-subject.pos.x, -subject.pos.z);
    const m = this.mapImg;
    ctx.drawImage(m.canvas, m.x0, m.z0, m.w, m.d);
    for (const a of g.actors) {
      if (!a.alive || a === subject || a.team !== p.team) continue;
      ctx.fillStyle = a.team === 'CT' ? '#6fa8ff' : '#ffb04a';
      ctx.beginPath();
      ctx.arc(a.pos.x, a.pos.z, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const b = g.bomb;
    const bombVisible = (b.state === 'dropped' && p.team === 'T') || b.state === 'planted' ||
      (b.state === 'carried' && p.team === 'T');
    if (bombVisible && (b.state !== 'planted' || Math.sin(g.time * 10) > 0)) {
      const bp = b.state === 'carried' ? b.carrier.pos : b.pos;
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(bp.x - 1.5, bp.z - 1.5, 3, 3);
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R - 4, R + 4);
    ctx.lineTo(R + 4, R + 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  update(dt) {
    const g = this.g, p = g.player, e = this.el;
    const subject = p.alive ? p : g.specTarget || p;

    const hp = Math.max(0, Math.ceil(subject.health));
    this.set('hp', e.hp, hp);
    e.hpBox.classList.toggle('low', hp <= 25);
    this.set('armor', e.armor, Math.ceil(subject.armor));
    this.set('money', e.money, p.money);
    if (this.lastMoney !== null && p.money !== this.lastMoney) {
      const d = p.money - this.lastMoney;
      e.moneyDelta.textContent = (d > 0 ? '+' : '-') + Math.abs(d);
      e.moneyDelta.className = d > 0 ? 'up' : 'down';
      this.moneyT = 2;
    }
    this.lastMoney = p.money;
    this.moneyT -= dt;
    e.moneyDelta.style.opacity = Math.max(0, Math.min(1, this.moneyT));

    const w = subject.weapon;
    this.set('wname', e.weapon, w.def.name);
    this.toggle('ammo', e.ammo, !w.def.melee);
    e.ammo.classList.toggle('nade', !!w.def.nade);
    if (w.def.nade) this.set('mag', e.mag, `×${w.mag}`);
    else if (!w.def.melee) {
      this.set('mag', e.mag, w.mag);
      this.set('res', e.res, w.reserve);
    }
    // Grenades carried, e.g. "HE · FB×2 · SG" (selected one highlighted).
    const nades = subject.nades ? GRENADES.filter((t) => subject.nades[t] > 0)
      .map((t) => `<span class="${t === subject.nadeSel ? 'sel' : ''}">${WEAPONS[t].short}${subject.nades[t] > 1 ? '×' + subject.nades[t] : ''}</span>`).join(' · ') : '';
    if (this.cache.nades !== nades) { this.cache.nades = nades; e.nades.innerHTML = nades; }

    const planted = g.bomb.state === 'planted';
    const t = Math.max(0, Math.ceil(g.phase === 'freeze' ? g.phaseT : g.roundT));
    const warmup = g.phase === 'warmup';
    this.set('timer', e.timer, warmup ? 'WARMUP' : planted ? '' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.toggle('c4p', e.c4planted, planted);
    this.set('sct', e.scoreCT, g.score.CT);
    this.set('st', e.scoreT, g.score.T);
    this.set('rn', e.roundNum, g.round);
    const room = g.roomInfo;
    this.set('room', e.roomTag, room ? `· ${room.code} · ${room.teamSize}v${room.teamSize} · ${g.map.def.name}` : '');
    if (this.cache.roomPause !== (room && room.code)) {
      this.cache.roomPause = room && room.code;
      const link = room && location.protocol.startsWith('http') ? `${location.origin}/?room=${room.code}` : '';
      e.pauseRoom.innerHTML = room ? `Room code <b>${room.code}</b> · ${room.teamSize}v${room.teamSize}${link ? `<div class="link">Invite link: ${link}</div>` : ''}` : '';
    }
    const dots = (team) => g.actors.filter((a) => a.team === team).map((a) => (a.alive ? '●' : '○')).join('');
    this.set('act', e.aliveCT, dots('CT'));
    this.set('at', e.aliveT, dots('T'));
    this.toggle('c4', e.c4, p.alive && p.hasBomb);
    if (p.alive && p.hasBomb) e.c4.classList.toggle('blink', !!g.map.siteAt(p.pos.x, p.pos.z));

    // Sniper rifles get the black scope overlay and no crosshair; the AUG/SG 552 zoom keeps the crosshair.
    const scoped = p.alive && p.scope > 0 && !!w.def.scope;
    this.toggle('scope', e.scope, scoped);
    const showCross = p.alive && !w.def.scope;
    this.toggle('cross', e.cross, showCross);
    if (showCross) {
      const gap = Math.round(g.crosshairGap());
      if (this.cache.gap !== gap) {
        this.cache.gap = gap;
        e.cross.style.setProperty('--gap', `${gap}px`);
      }
    }

    this.centerT -= dt;
    if (this.centerT < 0.6) e.center.style.opacity = Math.max(0, this.centerT / 0.6);
    this.subT -= dt;
    if (this.subT < 0.6) e.sub.style.opacity = Math.max(0, this.subT / 0.6);
    this.dmgA = Math.max(0, this.dmgA - dt * 1.2);
    e.dmg.style.opacity = this.dmgA;

    const task = p.alive && p.task && p.task.dur ? p.task : null;
    if (task) this.progress(task.t / task.dur, task.label);
    else this.progress(null);
    this.set('hint', e.hint, g.hintText());
    const aim = p.alive ? g.aimTarget() : null;
    if (aim) {
      const friend = aim.team === p.team;
      this.set('aim', e.aim, friend ? `Friend: ${aim.name}  Health: ${Math.ceil(aim.health)}%` : `Enemy: ${aim.name}`);
      e.aim.className = friend ? 'friend' : 'enemy';
    } else this.set('aim', e.aim, '');

    const spec = !p.alive && g.specTarget;
    this.toggle('spec', e.spec, !!spec);
    if (spec) this.set('specn', e.spec, `Spectating: ${g.specTarget.name}  —  click to switch`);

    if (this.buyOpen) {
      this.buyT = (this.buyT || 0) - dt;
      if (this.buyT <= 0) { this.buyT = 0.3; this.renderBuy(); } // money / owned items change
    }
    const tab = !!g.input.keys.Tab;
    this.toggle('board', e.board, tab);
    if (tab) {
      this.boardT -= dt;
      if (this.boardT <= 0) { this.boardT = 0.3; this.renderBoard(); }
    }
    this.drawRadar();
  }
}
