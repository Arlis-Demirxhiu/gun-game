// Weapon stats loosely follow CS 1.6 (damage, fire rate, magazine, price, armor penetration).
// Units: meters, seconds, radians. `kick` is degrees of view punch per shot.
// Optional: `zoom` lists the field of view for each zoom level (right click cycles them);
// `scope` = sniper scope overlay, inaccurate unscoped; `bolt` = bolt action, unzooms after each shot;
// `pellets` + `pelletSpread` = shotgun; `shells` = reloads one shell at a time (`reload` per shell).

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, melee: true, dmg: 35, dmg2: 65, rate: 0.4, rate2: 1.0,
    range: 1.9, pen: 0.85, speed: 6.35,
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, price: 400, dmg: 25, rate: 0.15, mag: 20, reserve: 120,
    reload: 2.2, pen: 0.5, rangeMod: 0.75, auto: false, kick: 1.0, speed: 6.35, sound: 'pistol',
    spread: { base: 0.008, move: 0.03, air: 0.15, shot: 0.02, max: 0.06, recover: 0.25 },
  },
  usp: {
    id: 'usp', name: 'USP .45', slot: 2, price: 500, dmg: 34, rate: 0.15, mag: 12, reserve: 100,
    reload: 2.7, pen: 0.5, rangeMod: 0.79, auto: false, kick: 1.3, speed: 6.35, sound: 'pistol',
    spread: { base: 0.007, move: 0.03, air: 0.15, shot: 0.02, max: 0.06, recover: 0.25 },
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, price: 650, dmg: 54, rate: 0.25, mag: 7, reserve: 35,
    reload: 2.2, pen: 0.75, rangeMod: 0.81, auto: false, kick: 3.2, speed: 6.35, sound: 'deagle',
    spread: { base: 0.009, move: 0.05, air: 0.2, shot: 0.045, max: 0.09, recover: 0.4 },
  },
  mp5: {
    id: 'mp5', name: 'MP5 Navy', slot: 1, price: 1500, dmg: 26, rate: 0.075, mag: 30, reserve: 120,
    reload: 2.6, pen: 0.5, rangeMod: 0.84, auto: true, kick: 0.45, sideKick: 0.25, speed: 6.35, sound: 'smg',
    spread: { base: 0.012, move: 0.02, air: 0.12, shot: 0.006, max: 0.06, recover: 0.3 },
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, price: 2500, team: 'T', dmg: 36, rate: 0.0955, mag: 30, reserve: 90,
    reload: 2.45, pen: 0.775, rangeMod: 0.98, auto: true, kick: 0.95, sideKick: 0.5, speed: 5.6, sound: 'rifle',
    spread: { base: 0.004, move: 0.07, air: 0.25, shot: 0.008, max: 0.09, recover: 0.35 },
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 1, price: 3100, team: 'CT', dmg: 33, rate: 0.09, mag: 30, reserve: 90,
    reload: 3.05, pen: 0.7, rangeMod: 0.97, auto: true, kick: 0.75, sideKick: 0.4, speed: 5.85, sound: 'rifle2',
    spread: { base: 0.003, move: 0.06, air: 0.22, shot: 0.007, max: 0.08, recover: 0.35 },
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, price: 4750, dmg: 115, rate: 1.45, mag: 10, reserve: 30,
    reload: 2.9, pen: 0.97, rangeMod: 0.99, auto: false, scope: true, bolt: true, zoom: [30, 8], kick: 3.5, speed: 5.3, scopedSpeed: 3.8,
    sound: 'awp',
    spread: { base: 0.0015, unscoped: 0.09, move: 0.15, air: 0.4, shot: 0, max: 0.0001, recover: 1 },
  },

  // ----- pistols -----
  p228: {
    id: 'p228', name: 'P228', slot: 2, price: 600, dmg: 32, rate: 0.15, mag: 13, reserve: 52,
    reload: 2.7, pen: 0.5, rangeMod: 0.8, auto: false, kick: 1.2, speed: 6.35, sound: 'pistol',
    spread: { base: 0.008, move: 0.03, air: 0.15, shot: 0.022, max: 0.065, recover: 0.25 },
  },
  fiveseven: {
    id: 'fiveseven', name: 'Five-SeveN', slot: 2, price: 750, team: 'CT', dmg: 20, rate: 0.15, mag: 20, reserve: 100,
    reload: 2.7, pen: 0.75, rangeMod: 0.885, auto: false, kick: 0.9, speed: 6.35, sound: 'pistol',
    spread: { base: 0.007, move: 0.028, air: 0.15, shot: 0.016, max: 0.055, recover: 0.25 },
  },

  // ----- shotguns -----
  m3: {
    id: 'm3', name: 'M3 Super 90', slot: 1, price: 1700, dmg: 20, pellets: 9, pelletSpread: 0.05, rate: 0.88, mag: 8, reserve: 32,
    reload: 0.48, shells: true, pen: 0.5, rangeMod: 0.7, auto: false, kick: 5, speed: 5.5, sound: 'shotgun',
    spread: { base: 0.004, move: 0.02, air: 0.08, shot: 0, max: 0.01, recover: 0.5 },
  },
  xm1014: {
    id: 'xm1014', name: 'XM1014', slot: 1, price: 3000, dmg: 20, pellets: 6, pelletSpread: 0.05, rate: 0.25, mag: 7, reserve: 32,
    reload: 0.45, shells: true, pen: 0.5, rangeMod: 0.7, auto: true, kick: 3, speed: 6.1, sound: 'shotgun',
    spread: { base: 0.004, move: 0.02, air: 0.08, shot: 0.004, max: 0.02, recover: 0.4 },
  },

  // ----- SMGs -----
  tmp: {
    id: 'tmp', name: 'Steyr TMP', slot: 1, price: 1250, team: 'CT', dmg: 20, rate: 0.07, mag: 30, reserve: 120,
    reload: 2.1, pen: 0.5, rangeMod: 0.85, auto: true, kick: 0.35, sideKick: 0.2, speed: 6.35, sound: 'silenced',
    spread: { base: 0.014, move: 0.02, air: 0.12, shot: 0.006, max: 0.065, recover: 0.3 },
  },
  mac10: {
    id: 'mac10', name: 'MAC-10', slot: 1, price: 1400, team: 'T', dmg: 29, rate: 0.07, mag: 30, reserve: 100,
    reload: 3.15, pen: 0.5, rangeMod: 0.82, auto: true, kick: 0.55, sideKick: 0.35, speed: 6.35, sound: 'smg',
    spread: { base: 0.018, move: 0.025, air: 0.12, shot: 0.008, max: 0.08, recover: 0.3 },
  },
  ump45: {
    id: 'ump45', name: 'UMP45', slot: 1, price: 1700, dmg: 30, rate: 0.105, mag: 25, reserve: 100,
    reload: 3.5, pen: 0.5, rangeMod: 0.82, auto: true, kick: 0.6, sideKick: 0.3, speed: 6.35, sound: 'smg',
    spread: { base: 0.012, move: 0.02, air: 0.12, shot: 0.007, max: 0.065, recover: 0.3 },
  },
  p90: {
    id: 'p90', name: 'ES P90', slot: 1, price: 2350, dmg: 26, rate: 0.066, mag: 50, reserve: 100,
    reload: 3.4, pen: 0.65, rangeMod: 0.885, auto: true, kick: 0.45, sideKick: 0.3, speed: 6.1, sound: 'smg',
    spread: { base: 0.012, move: 0.022, air: 0.12, shot: 0.006, max: 0.07, recover: 0.3 },
  },

  // ----- rifles -----
  galil: {
    id: 'galil', name: 'Galil', slot: 1, price: 2000, team: 'T', dmg: 30, rate: 0.0875, mag: 35, reserve: 90,
    reload: 2.45, pen: 0.775, rangeMod: 0.98, auto: true, kick: 0.8, sideKick: 0.45, speed: 6.0, sound: 'rifle2',
    spread: { base: 0.005, move: 0.07, air: 0.25, shot: 0.008, max: 0.09, recover: 0.35 },
  },
  famas: {
    id: 'famas', name: 'FAMAS', slot: 1, price: 2250, team: 'CT', dmg: 30, rate: 0.0825, mag: 25, reserve: 90,
    reload: 3.3, pen: 0.7, rangeMod: 0.96, auto: true, kick: 0.7, sideKick: 0.4, speed: 6.1, sound: 'rifle2',
    spread: { base: 0.004, move: 0.065, air: 0.24, shot: 0.0075, max: 0.085, recover: 0.35 },
  },
  sg552: {
    id: 'sg552', name: 'SG 552', slot: 1, price: 3500, team: 'T', dmg: 33, rate: 0.0825, mag: 30, reserve: 90,
    reload: 3.0, pen: 0.7, rangeMod: 0.955, auto: true, zoom: [55], kick: 0.8, sideKick: 0.4, speed: 5.95, scopedSpeed: 5.3, sound: 'rifle',
    spread: { base: 0.0035, move: 0.065, air: 0.24, shot: 0.007, max: 0.08, recover: 0.35 },
  },
  aug: {
    id: 'aug', name: 'AUG', slot: 1, price: 3500, team: 'CT', dmg: 32, rate: 0.0825, mag: 30, reserve: 90,
    reload: 3.3, pen: 0.7, rangeMod: 0.96, auto: true, zoom: [55], kick: 0.65, sideKick: 0.35, speed: 5.97, scopedSpeed: 5.3, sound: 'rifle2',
    spread: { base: 0.003, move: 0.06, air: 0.22, shot: 0.0065, max: 0.075, recover: 0.35 },
  },

  // ----- snipers -----
  scout: {
    id: 'scout', name: 'Scout', slot: 1, price: 2750, dmg: 75, rate: 1.25, mag: 10, reserve: 90,
    reload: 2.0, pen: 0.85, rangeMod: 0.98, auto: false, scope: true, bolt: true, zoom: [40, 15], kick: 2.5, speed: 6.6, scopedSpeed: 5.5,
    sound: 'scout',
    spread: { base: 0.002, unscoped: 0.06, move: 0.08, air: 0.12, shot: 0, max: 0.0001, recover: 1 },
  },
  g3sg1: {
    id: 'g3sg1', name: 'G3SG1', slot: 1, price: 5000, team: 'T', dmg: 80, rate: 0.25, mag: 20, reserve: 90,
    reload: 3.5, pen: 0.825, rangeMod: 0.98, auto: false, scope: true, zoom: [40, 15], kick: 2.2, speed: 5.5, scopedSpeed: 4.5,
    sound: 'sniper',
    spread: { base: 0.0025, unscoped: 0.08, move: 0.12, air: 0.3, shot: 0.012, max: 0.03, recover: 0.4 },
  },
  sg550: {
    id: 'sg550', name: 'SG 550', slot: 1, price: 4200, team: 'CT', dmg: 70, rate: 0.25, mag: 30, reserve: 90,
    reload: 3.35, pen: 0.85, rangeMod: 0.98, auto: false, scope: true, zoom: [40, 15], kick: 2.0, speed: 5.5, scopedSpeed: 4.5,
    sound: 'sniper',
    spread: { base: 0.0025, unscoped: 0.08, move: 0.12, air: 0.3, shot: 0.011, max: 0.03, recover: 0.4 },
  },

  // ----- machine gun -----
  m249: {
    id: 'm249', name: 'M249', slot: 1, price: 5750, dmg: 32, rate: 0.08, mag: 100, reserve: 200,
    reload: 4.7, pen: 0.75, rangeMod: 0.97, auto: true, kick: 0.9, sideKick: 0.55, speed: 5.5, sound: 'mg',
    spread: { base: 0.007, move: 0.09, air: 0.3, shot: 0.0075, max: 0.1, recover: 0.4 },
  },
};

// Grenades live in slot 4. `max` is how many of that type you can carry; `fuse` is seconds after the throw.
export const GRENADES = ['hegrenade', 'flashbang', 'smokegrenade'];
Object.assign(WEAPONS, {
  hegrenade: { id: 'hegrenade', name: 'HE Grenade', short: 'HE', slot: 4, nade: 'he', price: 300, max: 1, fuse: 1.6, pen: 0.5, speed: 6.35, dmg: 98, radius: 9 },
  flashbang: { id: 'flashbang', name: 'Flashbang', short: 'FB', slot: 4, nade: 'flash', price: 200, max: 2, fuse: 1.5, speed: 6.35 },
  smokegrenade: { id: 'smokegrenade', name: 'Smoke Grenade', short: 'SG', slot: 4, nade: 'smoke', price: 300, max: 1, fuse: 1.8, speed: 6.35, duration: 18, radius: 4.6 },
});

export const EQUIPMENT = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650 },
  helmet: { id: 'helmet', name: 'Kevlar + Helmet', price: 1000 },
  defuse: { id: 'defuse', name: 'Defuse Kit', price: 200, team: 'CT' },
};

export const BUY_ORDER = [
  'p228', 'deagle', 'fiveseven', 'm3', 'xm1014', 'mp5', 'tmp', 'mac10', 'ump45', 'p90',
  'galil', 'famas', 'ak47', 'm4a1', 'sg552', 'aug', 'scout', 'awp', 'g3sg1', 'sg550', 'm249',
  'kevlar', 'helmet', 'defuse', 'hegrenade', 'flashbang', 'smokegrenade',
];

// The CS 1.6 buy menu: categories in order, items per team in CS's order.
export const BUY_MENU = [
  { name: 'Handgun', items: { T: ['glock', 'usp', 'p228', 'deagle'], CT: ['glock', 'usp', 'p228', 'deagle', 'fiveseven'] } },
  { name: 'Shotgun', items: { T: ['m3', 'xm1014'], CT: ['m3', 'xm1014'] } },
  { name: 'Sub-Machine Gun', items: { T: ['mac10', 'mp5', 'ump45', 'p90'], CT: ['tmp', 'mp5', 'ump45', 'p90'] } },
  { name: 'Rifle', items: { T: ['galil', 'ak47', 'scout', 'sg552', 'awp', 'g3sg1'], CT: ['famas', 'scout', 'm4a1', 'aug', 'sg550', 'awp'] } },
  { name: 'Machine Gun', items: { T: ['m249'], CT: ['m249'] } },
  { name: 'Primary Ammo', buy: 'ammo1' },
  { name: 'Secondary Ammo', buy: 'ammo2' },
  { name: 'Equipment', items: { T: ['kevlar', 'helmet', 'flashbang', 'hegrenade', 'smokegrenade'], CT: ['kevlar', 'helmet', 'flashbang', 'hegrenade', 'smokegrenade', 'defuse'] } },
];

// Ammo boxes (CS 1.6 prices): one purchase adds `rounds`, up to the weapon's reserve.
export const AMMO = {
  '9mm': { name: '9mm', price: 20, rounds: 30 },
  '45acp': { name: '.45 ACP', price: 25, rounds: 12 },
  '357sig': { name: '.357 SIG', price: 50, rounds: 13 },
  '50ae': { name: '.50 AE', price: 40, rounds: 7 },
  '57mm': { name: '5.7mm', price: 50, rounds: 50 },
  '12g': { name: '12 gauge', price: 65, rounds: 8 },
  '556': { name: '5.56mm', price: 60, rounds: 30 },
  '762': { name: '7.62mm', price: 80, rounds: 30 },
  '338': { name: '.338 Magnum', price: 125, rounds: 10 },
};

// Real-world facts shown in the buy menu's info panel.
export const WEAPON_INFO = {
  glock: { origin: 'Austria', caliber: '9mm Parabellum', ammo: '9mm', weight: 0.9 },
  usp: { origin: 'Germany', caliber: '.45 ACP', ammo: '45acp', weight: 1.0 },
  p228: { origin: 'Switzerland', caliber: '.357 SIG', ammo: '357sig', weight: 1.0 },
  deagle: { origin: 'Israel', caliber: '.50 Action Express', ammo: '50ae', weight: 2.0 },
  fiveseven: { origin: 'Belgium', caliber: '5.7 x 28mm', ammo: '57mm', weight: 0.8 },
  m3: { origin: 'Italy', caliber: '12 gauge', ammo: '12g', weight: 3.5 },
  xm1014: { origin: 'Italy', caliber: '12 gauge', ammo: '12g', weight: 3.9 },
  mac10: { origin: 'United States', caliber: '.45 ACP', ammo: '45acp', weight: 2.8 },
  tmp: { origin: 'Austria', caliber: '9mm Parabellum', ammo: '9mm', weight: 1.5 },
  mp5: { origin: 'Germany', caliber: '9mm Parabellum', ammo: '9mm', weight: 3.0 },
  ump45: { origin: 'Germany', caliber: '.45 ACP', ammo: '45acp', weight: 2.5 },
  p90: { origin: 'Belgium', caliber: '5.7 x 28mm', ammo: '57mm', weight: 3.0 },
  galil: { origin: 'Israel', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 4.4 },
  famas: { origin: 'France', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 3.8 },
  ak47: { origin: 'Russia', caliber: '7.62 x 39mm', ammo: '762', weight: 4.3 },
  m4a1: { origin: 'United States', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 3.4 },
  sg552: { origin: 'Switzerland', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 3.5 },
  aug: { origin: 'Austria', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 3.9 },
  scout: { origin: 'Austria', caliber: '7.62 x 51mm NATO', ammo: '762', weight: 3.3 },
  awp: { origin: 'United Kingdom', caliber: '.338 Lapua Magnum', ammo: '338', weight: 6.5 },
  g3sg1: { origin: 'Germany', caliber: '7.62 x 51mm NATO', ammo: '762', weight: 5.5 },
  sg550: { origin: 'Switzerland', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 7.0 },
  m249: { origin: 'Belgium', caliber: '5.56 x 45mm NATO', ammo: '556', weight: 7.5 },
};

export const EQUIP_INFO = {
  kevlar: 'Body armor: absorbs about half the damage to the chest, stomach and arms.',
  helmet: 'Body armor plus a helmet that also protects your head.',
  flashbang: 'Blinds and deafens anyone looking at it. Carry up to 2.',
  hegrenade: 'High-explosive grenade: heavy damage around where it lands.',
  smokegrenade: 'Thick smoke screen for about 18 seconds. Blocks vision.',
  defuse: 'Cuts the bomb defuse time from 10 to 5 seconds.',
};

export function newWeapon(id) {
  const def = WEAPONS[id];
  return { def, mag: def.mag || 0, reserve: def.reserve || 0 };
}

export function buyListFor(team) {
  return BUY_ORDER.filter((id) => {
    const item = WEAPONS[id] || EQUIPMENT[id];
    return !item.team || item.team === team;
  });
}
