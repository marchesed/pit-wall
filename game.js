'use strict';
/* PIT WALL - a Formula 1 deck-building roguelike prototype */

const app = document.getElementById('app');
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const MAX_WEAR = 8;
const HAND_SIZE = 5;
const ENERGY = 3;

/* ---------- Sound (synthesized with WebAudio, no asset files) ---------- */
const Sfx = (() => {
  let ctx = null, muted = false;
  try { muted = localStorage.getItem('pw-mute') === '1'; } catch (e) {}
  const ac = () => {
    if (muted) return null;
    try {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  };
  const tone = (f, f2, t, type = 'sine', v = 0.15, delay = 0) => {
    const c = ac(); if (!c) return;
    const s = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, s);
    if (f2 && f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, s + t);
    g.gain.setValueAtTime(v, s); g.gain.exponentialRampToValueAtTime(0.0001, s + t);
    o.connect(g); g.connect(c.destination); o.start(s); o.stop(s + t + 0.02);
  };
  const noise = (t, v = 0.15, delay = 0, freq = 2000) => {
    const c = ac(); if (!c) return;
    const s = c.currentTime + delay;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * t)), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(v, s); g.gain.exponentialRampToValueAtTime(0.0001, s + t);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(s);
  };
  const vib = p => { try { if (!muted && navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('pw-mute', muted ? '1' : '0'); } catch (e) {} if (!muted) this.tick(); },
    unlock() { ac(); },
    tick()  { tone(900, 700, 0.05, 'square', 0.05); },
    err()   { tone(150, 120, 0.12, 'square', 0.1); },
    hit()   { noise(0.12, 0.25, 0, 3000); tone(220, 60, 0.16, 'sawtooth', 0.18); vib(15); },
    hurt()  { noise(0.22, 0.3, 0, 1500); tone(120, 40, 0.28, 'square', 0.2); vib([40, 30, 40]); },
    block() { tone(700, 1100, 0.08, 'triangle', 0.15); tone(1500, 1500, 0.04, 'square', 0.04, 0.02); },
    heal()  { [523, 659, 784].forEach((f, i) => tone(f, f, 0.18, 'sine', 0.12, i * 0.08)); },
    wear()  { tone(320, 110, 0.3, 'sawtooth', 0.08); },
    pit()   { for (let i = 0; i < 5; i++) { noise(0.05, 0.2, i * 0.07, 4000); tone(180, 180, 0.04, 'square', 0.08, i * 0.07); } tone(400, 900, 0.2, 'sawtooth', 0.1, 0.4); },
    rev()   { tone(70, 420, 0.7, 'sawtooth', 0.1); noise(0.5, 0.05, 0, 600); },
    draw()  { noise(0.06, 0.1, 0, 6000); },
    end()   { tone(400, 200, 0.15, 'triangle', 0.12); },
    ers()   { tone(300, 1200, 0.2, 'sawtooth', 0.1); },
    siren() { tone(700, 900, 0.2, 'sine', 0.12); tone(900, 700, 0.2, 'sine', 0.12, 0.2); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.25, 'triangle', 0.15, i * 0.12)); },
    champ() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.15, i * 0.14)); },
    lose()  { [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.9, 0.3, 'square', 0.1, i * 0.18)); },
  };
})();

/* ---------- Cards ---------- */
// b = battle state; helpers below
const CARDS = {
  overtake:    { name: 'Overtake',     cost: 1, type: 'attack',  icon: '🏎️', text: 'Deal 6.', hits: () => [6], fmt: v => `Deal ${v[0]}.` },
  slipstream:  { name: 'Slipstream',   cost: 1, type: 'attack',  icon: '💨', text: 'Deal 4. Draw 1.', hits: () => [4], after: () => draw(1), fmt: v => `Deal ${v[0]}. Draw 1.` },
  drsblast:    { name: 'DRS Blast',    cost: 1, type: 'attack',  icon: '📡', text: 'Deal 9. +1 wear.', hits: () => [9], after: () => addWear(1), fmt: v => `Deal ${v[0]}. +1 wear.` },
  divebomb:    { name: 'Dive Bomb',    cost: 2, type: 'attack',  icon: '💥', text: 'Deal 15. +2 wear.', hits: () => [15], after: () => addWear(2), fmt: v => `Deal ${v[0]}. +2 wear.` },
  latebraking: { name: 'Late Braking', cost: 2, type: 'attack',  icon: '🛑', text: 'Deal 8 twice.', hits: () => [8, 8], fmt: v => (v[0] === v[1] ? `Deal ${v[0]} twice.` : `Deal ${v[0]} + ${v[1]}.`) },
  defend:      { name: 'Defend Line',  cost: 1, type: 'defence', icon: '🛡️', text: 'Gain 5 block.',                   play: () => block(5) },
  blockpass:   { name: 'Block Pass',   cost: 2, type: 'defence', icon: '🚧', text: 'Gain 12 block.',                  play: () => block(12) },
  liftcoast:   { name: 'Lift & Coast', cost: 0, type: 'defence', icon: '🍃', text: 'Gain 3 block. -1 wear.',          play: () => { block(3); addWear(-1); } },
  kerbhug:     { name: 'Kerb Hug',     cost: 1, type: 'defence', icon: '🛣️', text: 'Gain 8 block. +1 wear.',          play: () => { block(8); addWear(1); } },
  pitstop:     { name: 'Pit Stop',     cost: 1, type: 'skill',   icon: '🔧', text: 'Reset wear to 0. Gain 4 block.',  play: () => { b.wear = 0; block(4); Sfx.pit(); fx('player', 'heal', 'Fresh tyres'); log('Fresh tyres!'); if (hasSp('pitcrew')) { draw(1); run.hp = Math.min(run.maxHp, run.hp + 3); } } },
  radio:       { name: 'Radio Call',   cost: 0, type: 'skill',   icon: '🎧', text: 'Draw 2.',                         play: () => draw(2) },
  freshsofts:  { name: 'Fresh Softs',  cost: 1, type: 'skill',   icon: '🔴', text: 'Next 2 hits +3. +2 wear.',        play: () => { b.softs = 2; addWear(2); } },
  ers:         { name: 'ERS Deploy',   cost: 0, type: 'skill',   icon: '⚡', text: '+2 energy. +1 wear. Exhaust.',    exhaust: true, play: () => { b.energy += 2; addWear(1); Sfx.ers(); fx('player', 'heal', '+2 energy'); } },
  safetycar:   { name: 'Safety Car',   cost: 2, type: 'skill',   icon: '🚨', text: 'Cancel rival move. 8 block. Exhaust.', exhaust: true, play: () => { b.cancel = true; block(8); Sfx.siren(); log('Safety car! Rival move cancelled.'); } },
  groundfx:    { name: 'Ground Effect', cost: 1, type: 'skill',   icon: '⬇️', text: 'All block gained +2 this fight. Exhaust.', exhaust: true, play: () => { b.armor += 2; Sfx.ers(); fx('player', 'heal', 'Block +2'); } },

  // --- more attacks ---
  cutback:     { name: 'Cutback',      cost: 1, type: 'attack',  icon: '↩️', text: 'Deal 5. Deal 11 if rival has block.', hits: () => [b.rival.block > 0 ? 11 : 5], fmt: (v, p) => `Deal ${p(5)}. Deal ${p(11)} if rival has block.` },
  lunge:       { name: 'Lunge',        cost: 0, type: 'attack',  icon: '🦅', text: 'Deal 4. +1 wear.', hits: () => [4], after: () => addWear(1), fmt: v => `Deal ${v[0]}. +1 wear.` },
  fastestlap:  { name: 'Fastest Lap',  cost: 2, type: 'attack',  icon: '⏱️', text: 'Deal 10. Draw 1. +1 wear.', hits: () => [10], after: () => { draw(1); addWear(1); }, fmt: v => `Deal ${v[0]}. Draw 1. +1 wear.` },
  slingshot:   { name: 'Slingshot',    cost: 1, type: 'attack',  icon: '🪃', text: 'Deal 2 per card in your hand.', hits: others => [2 * others], fmt: v => `Deal ${v[0]} (2 per card).` },
  fullsend:    { name: 'Full Send',    cost: 3, type: 'attack',  icon: '🚀', text: 'Deal 26. +3 wear.', hits: () => [26], after: () => addWear(3), fmt: v => `Deal ${v[0]}. +3 wear.` },
  // --- more defence ---
  brakebias:   { name: 'Brake Bias',   cost: 1, type: 'defence', icon: '⚖️', text: 'Gain 6 block. Draw 1.',           play: () => { block(6); draw(1); } },
  wetsetup:    { name: 'Wet Setup',    cost: 2, type: 'defence', icon: '🌧️', text: 'Gain 10 block. -2 wear.',         play: () => { block(10); addWear(-2); } },
  rubberwall:  { name: 'Rubber Wall',  cost: 1, type: 'defence', icon: '🔰', text: 'Block = 2x tyre wear (min 3).',   play: () => block(Math.max(3, 2 * b.wear)) },
  // --- more skills ---
  undercut:    { name: 'Undercut',     cost: 1, type: 'skill',   icon: '✂️', text: 'Draw 2. Next hit +3.',            play: () => { draw(2); b.softs += 1; } },
  aero:        { name: 'Aero Package', cost: 1, type: 'skill',   icon: '🌀', text: 'All hits +2 this fight. Exhaust.', exhaust: true, play: () => { b.boost += 2; Sfx.ers(); fx('player', 'heal', 'Hits +2'); } },
  teamorders:  { name: 'Team Orders',  cost: 0, type: 'skill',   icon: '📻', text: '+1 energy. Draw 1. Exhaust.',     exhaust: true, play: () => { b.energy += 1; draw(1); } },
  redflag:     { name: 'Red Flag',     cost: 2, type: 'skill',   icon: '🚩', text: 'Strip rival block. Wear to 0. Exhaust.', exhaust: true, play: () => { b.rival.block = 0; b.wear = 0; Sfx.siren(); fx('rival', 'blocked', 'Stripped'); log('Red flag! Restart on fresh tyres.'); } },
  repaircrew:  { name: 'Repair Crew',  cost: 2, type: 'skill',   icon: '🧑‍🔧', text: 'Heal 10. Exhaust.',                 exhaust: true, play: () => { run.hp = Math.min(run.maxHp, run.hp + 10); Sfx.heal(); fx('player', 'heal', '+10'); } },
  tyrewarmers: { name: 'Tyre Warmers', cost: 1, type: 'skill',   icon: '♨️', text: '-3 wear. Gain 3 block.',          play: () => { addWear(-3); block(3); } },
  mindgames:   { name: 'Mind Games',   cost: 1, type: 'skill',   icon: '🧠', text: 'Rival attack -2 this fight. Exhaust.', exhaust: true, play: () => { b.rival.str -= 2; Sfx.ers(); fx('rival', 'buff', '-2 atk'); } },
};
/* ---------- Upgrades: id -> improved version stored as "id+" ---------- */
const UPGRADES = {
  overtake:    { text: 'Deal 9.', hits: () => [9] },
  slipstream:  { text: 'Deal 6. Draw 2.', hits: () => [6], after: () => draw(2), fmt: v => `Deal ${v[0]}. Draw 2.` },
  drsblast:    { text: 'Deal 12. +1 wear.', hits: () => [12] },
  divebomb:    { text: 'Deal 20. +2 wear.', hits: () => [20] },
  latebraking: { text: 'Deal 11 twice.', hits: () => [11, 11] },
  cutback:     { text: 'Deal 8. Deal 15 if rival has block.', hits: () => [b.rival.block > 0 ? 15 : 8], fmt: (v, p) => `Deal ${p(8)}. Deal ${p(15)} if rival has block.` },
  lunge:       { text: 'Deal 7. +1 wear.', hits: () => [7] },
  fastestlap:  { text: 'Deal 14. Draw 1. +1 wear.', hits: () => [14] },
  slingshot:   { text: 'Deal 3 per card in your hand.', hits: others => [3 * others], fmt: v => `Deal ${v[0]} (3 per card).` },
  fullsend:    { cost: 2, text: 'Deal 26. +3 wear.', hits: () => [26] },
  defend:      { text: 'Gain 8 block.',                    play: () => block(8) },
  blockpass:   { text: 'Gain 17 block.',                   play: () => block(17) },
  liftcoast:   { text: 'Gain 5 block. -2 wear.',           play: () => { block(5); addWear(-2); } },
  kerbhug:     { text: 'Gain 11 block. +1 wear.',          play: () => { block(11); addWear(1); } },
  brakebias:   { text: 'Gain 9 block. Draw 1.',            play: () => { block(9); draw(1); } },
  wetsetup:    { text: 'Gain 14 block. -3 wear.',          play: () => { block(14); addWear(-3); } },
  rubberwall:  { text: 'Block = 3x tyre wear (min 5).',    play: () => block(Math.max(5, 3 * b.wear)) },
  pitstop:     { text: 'Reset wear to 0. Gain 7 block.',   play: () => { b.wear = 0; block(7); Sfx.pit(); fx('player', 'heal', 'Fresh tyres'); log('Fresh tyres!'); if (hasSp('pitcrew')) { draw(1); run.hp = Math.min(run.maxHp, run.hp + 3); } } },
  radio:       { text: 'Draw 3.',                          play: () => draw(3) },
  freshsofts:  { text: 'Next 3 hits +3. +2 wear.',         play: () => { b.softs = 3; addWear(2); } },
  ers:         { text: '+2 energy. Exhaust.',              play: () => { b.energy += 2; Sfx.ers(); fx('player', 'heal', '+2 energy'); } },
  safetycar:   { cost: 1, text: 'Cancel rival move. 8 block. Exhaust.', play: () => { b.cancel = true; block(8); Sfx.siren(); log('Safety car! Rival move cancelled.'); } },
  groundfx:    { text: 'All block gained +3 this fight. Exhaust.', play: () => { b.armor += 3; Sfx.ers(); fx('player', 'heal', 'Block +3'); } },
  undercut:    { text: 'Draw 2. Next 2 hits +3.',          play: () => { draw(2); b.softs += 2; } },
  aero:        { text: 'All hits +3 this fight. Exhaust.', play: () => { b.boost += 3; Sfx.ers(); fx('player', 'heal', 'Hits +3'); } },
  teamorders:  { text: '+2 energy. Draw 1. Exhaust.',      play: () => { b.energy += 2; draw(1); } },
  redflag:     { cost: 1, text: 'Strip rival block. Wear to 0. Exhaust.', play: () => { b.rival.block = 0; b.wear = 0; Sfx.siren(); fx('rival', 'blocked', 'Stripped'); log('Red flag! Restart on fresh tyres.'); } },
  repaircrew:  { text: 'Heal 15. Exhaust.',                play: () => { run.hp = Math.min(run.maxHp, run.hp + 15); Sfx.heal(); fx('player', 'heal', '+15'); } },
  tyrewarmers: { text: '-4 wear. Gain 5 block.',           play: () => { addWear(-4); block(5); } },
  mindgames:   { text: 'Rival attack -3 this fight. Exhaust.', play: () => { b.rival.str -= 3; Sfx.ers(); fx('rival', 'buff', '-3 atk'); } },
};
for (const id of Object.keys(UPGRADES)) CARDS[id + '+'] = { ...CARDS[id], ...UPGRADES[id], name: CARDS[id].name + '+', upgraded: true };
// Attack cards describe their damage with hits(); playing the card and the live text shown in
// your hand both use it, so the numbers on a card can never drift from what really happens.
// hits(others) gets the number of OTHER cards in hand (slingshot cares).
for (const c of Object.values(CARDS)) if (c.hits) c.play = () => { c.hits(b.hand.length).forEach(d => hit(d)); if (c.after) c.after(); };
const canUpgrade = id => !!UPGRADES[id]; // upgraded ids ("x+") aren't in UPGRADES, so they can't be upgraded twice

const STARTER = ['overtake', 'overtake', 'overtake', 'overtake', 'defend', 'defend', 'defend', 'defend', 'pitstop', 'slipstream'];
const REWARD_POOL = Object.keys(CARDS).filter(id => !id.endsWith('+') && !['overtake', 'defend', 'pitstop', 'slipstream'].includes(id));

/* ---------- Rivals ---------- */
const RIVALS = {
  rookie:  { name: 'Isack Cookie-Hadjar', emoji: '🍪', hp: 36, moves: [{ t: 'atk', v: 8 }, { t: 'atk', v: 11 }, { t: 'def', v: 8 }] },
  fighter: { name: 'Lando Chuck-Norris', emoji: '🥊', hp: 46, moves: [{ t: 'atk', v: 9 }, { t: 'atk', v: 6, wear: 2 }, { t: 'def', v: 10 }, { t: 'atk', v: 12 }] },
  pole:    { name: 'Lewis Hammer-Time', emoji: '🔨', hp: 66, moves: [{ t: 'buff', v: 2 }, { t: 'atk', v: 11 }, { t: 'atk', v: 8, wear: 2 }, { t: 'def', v: 12 }] },
  paydriver: { name: 'Liam Lawsuit',     emoji: '⚖️', hp: 36, moves: [{ t: 'def', v: 10 }, { t: 'atk', v: 9 }, { t: 'atk', v: 7, wear: 2 }] },
  wildcard:  { name: 'Pierre Gas-Leak',  emoji: '💨', hp: 32, moves: [{ t: 'atk', v: 4, n: 3 }, { t: 'atk', v: 12 }, { t: 'def', v: 6 }] },
  whisperer: { name: 'Oscar Pie-Astri',  emoji: '🥧', hp: 44, moves: [{ t: 'atk', v: 6, wear: 3 }, { t: 'atk', v: 9 }, { t: 'def', v: 8 }, { t: 'buff', v: 1 }] },
  backmarker:{ name: 'George Russell Sprout', emoji: '🥦', hp: 54, moves: [{ t: 'def', v: 12 }, { t: 'def', v: 12 }, { t: 'atk', v: 13 }, { t: 'atk', v: 7 }] },
  rainmaster:{ name: 'Charles Le-Plan-C', emoji: '📋', hp: 64, moves: [{ t: 'atk', v: 4, n: 3 }, { t: 'atk', v: 4, n: 3 }, { t: 'buff', v: 3 }, { t: 'atk', v: 14 }] },
  iceman:    { name: 'Max Ver-Stop-Me',   emoji: '🛑', hp: 100, moves: [{ t: 'def', v: 10 }, { t: 'atk', v: 9, n: 2 }, { t: 'atk', v: 8, wear: 2 }, { t: 'buff', v: 2 }, { t: 'atk', v: 18 }] },
  champ:   { name: 'Kimi Anto-Nailed-It', emoji: '🏆', hp: 105, moves: [{ t: 'atk', v: 12 }, { t: 'def', v: 14 }, { t: 'buff', v: 2 }, { t: 'atk', v: 16, wear: 2 }] },
};

const TIERS = {
  early: ['rookie', 'paydriver', 'wildcard'],
  mid:   ['fighter', 'whisperer', 'backmarker'],
  elite: ['pole', 'rainmaster'],
  boss:  ['champ', 'iceman'],
};

const NODES = {
  shop:   { label: 'Pit Lane Shop',   short: 'Shop',   icon: '🛒' },
  race:   { label: 'Grand Prix',      short: 'Race',   icon: '🏁' },
  elite:  { label: 'Qualifying Duel', short: 'Duel',   icon: '⚡' },
  garage: { label: 'Garage',          short: 'Garage', icon: '🔧' },
  boss:   { label: 'Title Decider',   short: 'Final',  icon: '🏆' },
};

/* ---------- State ---------- */
let run = { screen: 'title' };
let b = null; // battle
let barPrev = {}; // last bar widths, so bars animate from old to new
let lastScreen = null;

/* ---------- Sponsors (relics): permanent perks for the run ---------- */
const SPONSORS = {
  hydra:     { name: 'Hydra Energy',    icon: '🥤', text: '+1 energy on the first turn of each fight.' },
  apex:      { name: 'Apex Compounds',  icon: '🛞', text: 'Tyres last longer: +2 max wear.' },
  carbon:    { name: 'Carbon Corp',     icon: '🧪', text: '+10 max HP (and heal 10 now).', onPick: () => { run.maxHp += 10; run.hp = Math.min(run.maxHp, run.hp + 10); } },
  prize:     { name: 'Prize Partners',  icon: '💰', text: '+50% prize money.' },
  telemetry: { name: 'Telemetry Inc.',  icon: '📡', text: 'Draw 1 extra card each turn.' },
  brake:     { name: 'Stopper Brakes',  icon: '🛑', text: 'Start every turn with 3 block.' },
  aero:      { name: 'Aero Labs',       icon: '🌀', text: 'All your hits deal +1.' },
  pitcrew:   { name: 'Pit Crew Pro',    icon: '🧰', text: 'Pit Stop also draws 1 card and heals 3.' },
  fuel:      { name: 'Fuel Partners',   icon: '⛽', text: 'Heal 4 HP after every won fight.' },
  rain:      { name: 'Rain Gear Co.',   icon: '☔', text: 'Wear from rival attacks is halved.' },
  fanclub:   { name: 'Fan Club',        icon: '📣', text: 'Your first hit each turn deals +4.' },
  charm:     { name: 'Lucky Charm',     icon: '🍀', text: 'Draw 2 extra cards on the first turn of a fight.' },
};
function hasSp(id) { return !!(run && run.sponsors && run.sponsors.includes(id)); }

/* ---------- Auto-save (localStorage) ---------- */
const SAVE_KEY = 'pw-save', SAVE_VER = 2; // bumped: older saves have a different map length
const SAVE_SCREENS = new Set(['map', 'reward', 'sponsor', 'garage', 'shop', 'remove', 'upgrade']);
function saveRun() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ver: SAVE_VER, run: { ...run, time: elapsedMs(), help: false, pileView: null, sponsorView: false, mapView: false } })); } catch (e) {}
}
function peekSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.ver === SAVE_VER && s.run && s.run.map && s.run.map.nodes && Array.isArray(s.run.deck)) return s.run;
  } catch (e) {}
  return null;
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/* ---------- Run timer: counts only while you're actively playing a run ---------- */
const TIMED_SCREENS = new Set([...SAVE_SCREENS, 'battle']);
let tickStart = null, timedRun = null;
const pageVisible = () => !(typeof document !== 'undefined' && document.hidden);
// Banks the running stretch into run.time whenever play pauses (tab hidden, run over, left the run).
function syncTimer() {
  if (timedRun !== run) { timedRun = run; tickStart = null; }
  const should = !!run && TIMED_SCREENS.has(run.screen) && pageVisible();
  if (should && tickStart === null) tickStart = Date.now();
  else if (!should && tickStart !== null) { run.time = (run.time || 0) + (Date.now() - tickStart); tickStart = null; }
}
function elapsedMs() { return ((run && run.time) || 0) + (tickStart !== null ? Date.now() - tickStart : 0); }
function fmtTime(ms) {
  const sec = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}
// Keep the stored save's clock current, so closing the tab mid-fight doesn't lose time.
function touchSaveTime() {
  if (!run || !TIMED_SCREENS.has(run.screen)) return;
  try {
    const sv = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (sv && sv.run) { sv.run.time = elapsedMs(); localStorage.setItem(SAVE_KEY, JSON.stringify(sv)); }
  } catch (e) {}
}

/* ---------- Stats (kept on this device) ---------- */
const STATS_KEY = 'pw-stats';
const blankStats = () => ({ v: 1, totals: { runs: 0, wins: 0, fights: 0, elites: 0, cards: 0, dmgDealt: 0, dmgTaken: 0, bestRound: 0, totalTime: 0, bestTime: null }, history: [] });
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY));
    if (s && s.v === 1 && s.totals && Array.isArray(s.history)) {
      s.totals.totalTime = s.totals.totalTime || 0; // stats saved before the timer existed
      if (s.totals.bestTime === undefined) s.totals.bestTime = null;
      return s;
    }
  } catch (e) {}
  return blankStats();
}
function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {} }
// Per-run counters live on the run itself so they survive save/continue.
function bump(key, n = 1) {
  if (!run.stats) run.stats = { fights: 0, elites: 0, cards: 0, dmgDealt: 0, dmgTaken: 0 };
  run.stats[key] = (run.stats[key] || 0) + n;
}
// result: 'win' | 'loss' | 'abandoned'. Safe to call twice for one run.
function recordRun(r, result, killedBy) {
  if (!r || r.recorded) return;
  r.recorded = true;
  const st = loadStats(), t = st.totals, rs = r.stats || {};
  const round = result === 'win' ? FLOORS : Math.min((r.floor || 0) + 1, FLOORS);
  const time = r === run ? elapsedMs() : (r.time || 0); // saved runs carry their own clock
  r.finalTime = time;
  t.runs++;
  t.totalTime += time;
  if (result === 'win' && (t.bestTime === null || time < t.bestTime)) { t.bestTime = time; r.newBest = true; }
  if (result === 'win') t.wins++;
  t.fights += rs.fights || 0; t.elites += rs.elites || 0; t.cards += rs.cards || 0;
  t.dmgDealt += rs.dmgDealt || 0; t.dmgTaken += rs.dmgTaken || 0;
  t.bestRound = Math.max(t.bestRound, round);
  st.history.unshift({ t: Date.now(), result, round, time, deck: (r.deck || []).length, sponsors: r.sponsors || [], killedBy: killedBy || null });
  st.history.length = Math.min(st.history.length, 30);
  saveStats(st);
}

function newRun() {
  run = { screen: 'map', hp: 60, maxHp: 60, gold: 50, deck: [...STARTER], floor: 0, path: [], sponsors: [], stats: { fights: 0, elites: 0, cards: 0, dmgDealt: 0, dmgTaken: 0 }, map: genMap(), help: false, pileView: null, sponsorView: false, mapView: false };
  render();
}

// Branching route map: LANES columns x FLOORS rows. Each node links to nodes
// in the next row (same or adjacent lane, never crossing), so picking a path
// locks you out of the routes that don't connect to it.
const LANES = 4, FLOORS = 10;

function genMap() {
  const nodes = Array.from({ length: FLOORS }, () => Array(LANES).fill(null));
  const mk = () => ({ t: 'race', next: [] });
  const crosses = (f, from, to) => nodes[f].some((n, c) => n && n.next.some(d => (c < from && d > to) || (c > from && d < to)));
  const lanes = shuffle([0, 1, 2, 3]);
  const starts = [lanes[0], lanes[1], lanes[2], pick([0, 1, 2, 3])];
  for (const s of starts) {
    let lane = s;
    for (let f = 0; f < FLOORS - 2; f++) {
      nodes[f][lane] = nodes[f][lane] || mk();
      const opts = shuffle([lane - 1, lane, lane + 1].filter(l => l >= 0 && l < LANES));
      const ok = opts.find(l => !crosses(f, lane, l));
      const nl = ok === undefined ? lane : ok;
      if (!nodes[f][lane].next.includes(nl)) nodes[f][lane].next.push(nl);
      lane = nl;
    }
    nodes[FLOORS - 2][lane] = nodes[FLOORS - 2][lane] || mk();
  }
  nodes[FLOORS - 1][0] = { t: 'boss', next: [] };
  nodes.forEach((row, f) => row.forEach(n => {
    if (!n || f === FLOORS - 1) return;
    if (f === 0) n.t = 'race';
    else if (f === FLOORS - 2) { n.t = 'garage'; n.next = [0]; } // always a garage before the final
    else if (f === 1) n.t = pick(['race', 'race', 'race', 'shop']);
    else n.t = pick(['race', 'race', 'race', 'race', 'elite', 'shop', 'garage']);
  }));
  // Garages before the final are guaranteed; elsewhere they're rare (at most 2 on the map).
  let garages = 0;
  for (let f = 1; f < FLOORS - 2; f++) nodes[f].forEach(n => { if (n && n.t === 'garage' && ++garages > 2) n.t = 'race'; });
  return { nodes };
}

// Lanes on the current floor the player may enter right now.
function availLanes() {
  const nodes = run.map.nodes;
  if (run.floor === 0) return nodes[0].map((n, l) => (n ? l : -1)).filter(l => l >= 0);
  const prev = nodes[run.floor - 1][run.path[run.floor - 1]];
  return prev ? prev.next : [];
}

// Where the player stands on the map, for drawing it. On the map screen the current floor is still
// to be chosen; during a battle that floor's node is already chosen and the next floor's options
// hang off it.
function mapState() {
  const nodes = run.map.nodes;
  const inBattle = run.screen === 'battle';
  const last = inBattle ? run.floor : run.floor - 1; // last floor with a chosen node
  const nextFloor = inBattle ? run.floor + 1 : run.floor;
  const cur = inBattle ? nodes[run.floor][run.path[run.floor]] : null;
  const nextLanes = inBattle ? (cur ? cur.next : []) : availLanes();
  const R = Array.from({ length: FLOORS }, () => new Set()); // lanes still reachable, per floor
  if (nextFloor < FLOORS) nextLanes.forEach(l => R[nextFloor].add(l));
  for (let f = nextFloor; f < FLOORS - 1; f++) R[f].forEach(l => nodes[f][l].next.forEach(n => R[f + 1].add(n)));
  return { inBattle, last, nextFloor, nextLanes, R };
}

/* ---------- Battle helpers ---------- */
function log(msg) { b.log = msg; }
function fx(target, kind, text) { b.fx.push({ target, kind, text }); }
// HP left after each landed hit this render, so bars can drop one hit at a time.
const stepsOf = key => (b.steps = b.steps || { rival: [], you: [] })[key];
// Each landed hit gets its own beat: floaters, shakes and sounds are spaced HIT_GAP ms apart.
const HIT_GAP = 350;
const hitCount = target => b.fx.filter(f => f.target === target && (f.kind === 'dmg' || f.kind === 'blocked')).length;
const later = (fn, ms) => (ms > 0 ? setTimeout(fn, ms) : fn());

function hit(n) {
  let d = n + b.boost;
  if (!b.hitTurn && hasSp('fanclub')) { d += 4; b.hitTurn = true; }
  if (b.softs > 0) { d += 3; b.softs--; }
  if (b.wear >= b.maxWear) d = Math.floor(d / 2);
  const r = b.rival;
  if (!stepsOf('rival').length) stepsOf('rival').push(r.hp); // [hp before, hp after each hit...]
  const absorbed = Math.min(r.block, d);
  r.block -= absorbed;
  const dealt = d - absorbed;
  bump('dmgDealt', Math.min(dealt, r.hp));
  r.hp = Math.max(0, r.hp - dealt);
  stepsOf('rival').push(r.hp);
  const gap = hitCount('rival') * HIT_GAP;
  if (dealt > 0) { fx('rival', 'dmg', `-${dealt}`); later(Sfx.hit, gap); } else { fx('rival', 'blocked', 'Blocked'); later(Sfx.block, gap); }
  log(`You hit for ${d}.`);
}
// What a list of hits would really deal right now (same rules as hit(), without changing anything).
function previewDamage(bases) {
  let softs = b.softs, fan = !b.hitTurn && hasSp('fanclub');
  return bases.map(n => {
    let d = n + b.boost;
    if (fan) { d += 4; fan = false; }
    if (softs > 0) { d += 3; softs--; }
    if (b.wear >= b.maxWear) d = Math.floor(d / 2);
    return d;
  });
}
// Card text for a card in hand, with damage numbers coloured when buffs/debuffs change them.
function liveText(c) {
  const num = (val, base) => (val > base ? `<span class="nbuf">${val}</span>` : val < base ? `<span class="ndeb">${val}</span>` : `${val}`);
  const bases = c.hits(b.hand.length - 1); // the card itself is still in the hand here
  const v = previewDamage(bases).map((x, i) => num(x, bases[i]));
  const p = n => num(previewDamage([n])[0], n);
  return c.fmt ? c.fmt(v, p) : c.text;
}
function block(n) { n += b.armor; b.block += n; fx('player', 'block', `+${n}🛡️`); Sfx.block(); }
function addWear(n) {
  const was = b.wear;
  b.wear = clamp(b.wear + n, 0, b.maxWear);
  if (n > 0) { fx('player', 'wear', `+${n}🛞`); Sfx.wear(); }
  if (was < b.maxWear && b.wear >= b.maxWear) log('Tyres are gone! Your hits deal half.');
}
function draw(n) {
  if (n > 0) Sfx.draw();
  for (let i = 0; i < n; i++) {
    if (!b.drawPile.length) {
      if (!b.discard.length) return;
      b.drawPile = shuffle(b.discard);
      b.discard = [];
    }
    b.hand.push(b.drawPile.pop());
  }
}
function intent() { const r = b.rival; return r.moves[r.i % r.moves.length]; }

/* ---------- Battle flow ---------- */
function startBattle(nodeType) {
  const f = run.floor;
  const key = pick(nodeType === 'boss' ? TIERS.boss : nodeType === 'elite' ? TIERS.elite : (f < 3 ? TIERS.early : TIERS.mid));
  const def = RIVALS[key];
  b = {
    nodeType,
    rival: { ...def, hp: def.hp + f * 2, maxHp: def.hp + f * 2, block: 0, str: f >= 6 ? 1 : 0, i: 0 },
    drawPile: shuffle([...run.deck]),
    discard: [], exhaust: [], hand: [],
    block: 0, energy: ENERGY, wear: f >= 3 ? 2 : 0, softs: 0, armor: 0, fx: [], dealing: false,
    maxWear: MAX_WEAR + (hasSp('apex') ? 2 : 0), boost: hasSp('aero') ? 1 : 0, firstTurn: true, hitTurn: false,
    sel: -1, busy: false, cancel: false, log: `Lights out vs ${def.name}!`,
  };
  barPrev = {};
  run.pileView = null;
  run.mapView = false;
  Sfx.rev();
  run.screen = 'battle';
  startTurn();
}

function startTurn() {
  b.block = hasSp('brake') ? 3 : 0;
  b.energy = ENERGY + (b.firstTurn && hasSp('hydra') ? 1 : 0);
  b.sel = -1;
  b.cancel = false;
  b.hitTurn = false;
  draw(HAND_SIZE + (hasSp('telemetry') ? 1 : 0) + (b.firstTurn && hasSp('charm') ? 2 : 0));
  b.firstTurn = false;
  b.dealing = true;
  b.busy = false;
  render();
}

// Select in place (no re-render) so nothing else on screen restarts or shifts.
function selectCard(i) {
  b.sel = i;
  Sfx.tick();
  const cards = app.querySelectorAll ? app.querySelectorAll('.hand .card') : null;
  if (!cards || !cards.length) { render(); return; }
  cards.forEach((el, k) => el.classList.toggle('sel', k === i));
  const hint = app.querySelector('.hint');
  if (hint) hint.textContent = CARDS[b.hand[i]].cost > b.energy ? 'Not enough energy' : 'Tap again to play';
}

function tapCard(i) {
  if (b.busy) return;
  if (b.sel !== i) { selectCard(i); return; }
  const id = b.hand[i], c = CARDS[id];
  if (c.cost > b.energy) { b.log = 'Not enough energy.'; b.sel = -1; Sfx.err(); render(); return; }
  b.energy -= c.cost;
  bump('cards');
  b.hand.splice(i, 1);
  b.sel = -1;
  c.play();
  (c.exhaust ? b.exhaust : b.discard).push(id);
  if (b.rival.hp <= 0) { b.busy = true; b.log = `${b.rival.name} is out!`; render(); setTimeout(winBattle, 800); return; }
  render();
}

function endTurn() {
  if (b.busy) return;
  b.busy = true;
  Sfx.end();
  b.discard.push(...b.hand);
  b.hand = [];
  b.sel = -1;
  render();
  setTimeout(rivalTurn, 500);
}

function rivalTurn() {
  const r = b.rival;
  r.block = 0;
  const m = intent();
  if (b.cancel) {
    b.log = `${r.name} backs off.`;
  } else if (m.t === 'atk') {
    const d = Math.max(0, m.v + r.str), hits = m.n || 1;
    let dealt = 0;
    fx('rival', 'lunge');
    stepsOf('you').push(run.hp);
    for (let h = 0; h < hits; h++) {
      const absorbed = Math.min(b.block, d);
      b.block -= absorbed;
      const through = d - absorbed;
      dealt += through;
      stepsOf('you').push(Math.max(0, run.hp - dealt));
      const gap = h * HIT_GAP; // one animation + sound per hit
      if (through > 0) { fx('player', 'dmg', `-${through}`); later(Sfx.hurt, gap); } else { fx('player', 'blocked', 'Blocked'); later(Sfx.block, gap); }
    }
    bump('dmgTaken', Math.min(dealt, run.hp));
    run.hp = Math.max(0, run.hp - dealt);
    const w = hasSp('rain') && m.wear ? Math.floor(m.wear / 2) : m.wear;
    if (w) addWear(w);
    b.log = `${r.name} hits you for ${dealt}${m.wear ? ' and chews your tyres' : ''}.`;
  } else if (m.t === 'def') {
    r.block += m.v;
    fx('rival', 'block', `+${m.v}🛡️`); Sfx.block();
    b.log = `${r.name} defends (+${m.v} block).`;
  } else if (m.t === 'buff') {
    r.str += m.v;
    fx('rival', 'buff', `+${m.v} atk`); Sfx.ers();
    b.log = `${r.name} pushes harder (+${m.v} attack).`;
  }
  r.i++;
  const extra = m.t === 'atk' && !b.cancel ? ((m.n || 1) - 1) * HIT_GAP : 0; // let every hit play out
  render();
  if (run.hp <= 0) { recordRun(run, 'loss', r.name); clearSave(); setTimeout(() => { Sfx.lose(); run.screen = 'over'; render(); }, 800 + extra); return; }
  setTimeout(startTurn, 700 + extra);
}

function winBattle() {
  bump('fights');
  if (b.nodeType === 'elite') bump('elites');
  if (b.nodeType === 'boss') { recordRun(run, 'win'); clearSave(); Sfx.champ(); run.screen = 'win'; render(); return; }
  Sfx.win();
  const elite = b.nodeType === 'elite';
  run.lastGold = Math.round(((elite ? 35 : 18) + rnd(10)) * (hasSp('prize') ? 1.5 : 1));
  run.gold += run.lastGold;
  const hp0 = run.hp;
  run.hp = Math.min(run.maxHp, run.hp + (hasSp('fuel') ? 4 : 0));
  run.lastHeal = run.hp - hp0;
  run.rewards = shuffle([...REWARD_POOL]).slice(0, 3);
  run.offer = elite ? shuffle(Object.keys(SPONSORS).filter(id => !hasSp(id))).slice(0, 1) : []; // one sponsor, no choice
  run.screen = run.offer.length ? 'sponsor' : 'reward';
  render();
}

/* ---------- Views ---------- */
// blk > 0 turns the bar blue (shielded); flash pulses it when block is gained or soaks a hit.
let kfN = 0;
const bar = (v, max, cls = '', key = '', blk = 0, flash = false, steps = []) => {
  const to = clamp(v / max * 100, 0, 100);
  const from = key in barPrev ? barPrev[key] : to;
  if (key) barPrev[key] = to;
  let kf = '', anim = '';
  let seq = '';
  if (steps.length > 2) { // multi-hit: drop the bar a little at each hit's moment
    seq = steps.join(',');
    const T = (steps.length - 2) * HIT_GAP + 300, pct = ms => (ms / T * 100).toFixed(2);
    let frames = `0%{width:${from}%}`, prev = from;
    steps.slice(1).forEach((hp, k) => {
      const w = clamp(hp / max * 100, 0, 100);
      frames += `${pct(k * HIT_GAP)}%{width:${prev}%}${pct(k * HIT_GAP + 220)}%{width:${w}%}`;
      prev = w;
    });
    const name = 'bk' + (++kfN);
    kf = `<style>@keyframes ${name}{${frames}100%{width:${prev}%}}</style>`;
    anim = `;animation:${name} ${T}ms linear both`;
  }
  return `${kf}<div class="bar ${cls} ${blk > 0 ? 'shielded' : ''} ${flash ? 'bflash' : ''}"><i style="--from:${from}%;--to:${to}%${anim}"></i><span>${seq ? `<em class="hpv" data-seq="${seq}">${steps[0]}</em>` : v}/${max}${blk > 0 ? ` · 🛡️ ${blk}` : ''}</span></div>`;
};
const floaters = target => {
  let hitN = 0, other = 0;
  return b.fx.filter(f => f.target === target && f.text).map(f => {
    const isHit = f.kind === 'dmg' || f.kind === 'blocked';
    const delay = isHit ? hitN++ * HIT_GAP : other++ * 130; // hits follow the shake rhythm
    return `<div class="float ${f.kind}" style="animation-delay:${delay}ms">${f.text}</div>`;
  }).join('');
};
const hasFx = (target, kind) => b.fx.some(f => f.target === target && f.kind === kind);
const cardHtml = (id, opts = {}) => {
  const c = CARDS[id];
  return `<button class="card ${c.type} ${c.upgraded ? 'up' : ''} ${opts.sel ? 'sel' : ''} ${opts.no ? 'no' : ''} ${opts.deal ? 'deal' : ''}" style="${opts.deal ? `animation-delay:${opts.i * 70}ms` : ''}" data-act="${opts.act || ''}">
    <div class="cost">${c.cost}</div><div class="nm">${c.name}</div><div class="ic">${c.icon}</div><div class="tx">${opts.live && c.hits ? liveText(c) : c.text}</div></button>`;
};
const topBar = () => `<div class="top"><span>Round <b>${Math.min(run.floor + 1, FLOORS)}/${FLOORS}</b></span><span>❤️ <b>${run.hp}/${run.maxHp}</b></span><span>💰 <b>${run.gold}</b></span><span>🃏 <b>${run.deck.length}</b></span>${run.screen === 'battle' ? '<button class="mute" data-act="mapview" aria-label="View map">🗺️</button>' : ''}<button class="mute" data-act="help" aria-label="How to play">❓</button><button class="mute" data-act="mute" aria-label="Toggle sound">${Sfx.muted ? '🔇' : '🔊'}</button></div>${subBar()}`;
// Row under the top bar: sponsors on the left, run timer on the right.
const subBar = () => `<div class="subbar">${run.sponsors && run.sponsors.length
  ? `<button class="spons" data-act="sponsors" aria-label="View sponsors">${run.sponsors.map(id => SPONSORS[id].icon).join(' ')}</button>` : '<span></span>'}<span class="timer" aria-label="Run time">⏱ ${fmtTime(elapsedMs())}</span></div>`;

function vSponsor() {
  return `${topBar()}<div class="center"><h2>🏷️ New Sponsor!</h2><div class="muted">Beating a Duel earns you a sponsorship deal. Tap to sign it.</div>
    <div class="stack">${run.offer.map(id => { const s = SPONSORS[id]; return `<button class="spcard" data-act="sp:${id}"><span class="spic">${s.icon}</span><span><b>${s.name}</b><br><small>${s.text}</small></span></button>`; }).join('')}</div></div>`;
}

function vSponsors() {
  const rows = run.sponsors.map(id => { const s = SPONSORS[id]; return `<div class="sprow"><span class="spic">${s.icon}</span><span><b>${s.name}</b><br><small>${s.text}</small></span></div>`; }).join('');
  return `<div class="overlay"><div class="backdrop" data-act="sponsorsclose"></div><div class="sheet">
    <h2>Your Sponsors</h2>${rows}<button class="btn" data-act="sponsorsclose" style="width:100%">Close</button></div></div>`;
}

function vTitle() {
  const sv = peekSave();
  return `<div class="center"><h1>PIT <span>WALL</span></h1><div class="muted">A Formula 1 deck-building roguelike</div>
    <div class="stack" style="margin-top:8px">
      ${sv ? `<button class="btn" data-act="continue">Continue — Round ${Math.min(sv.floor + 1, FLOORS)}/${FLOORS} · ❤️ ${sv.hp}/${sv.maxHp}</button>` : ''}
      <button class="btn ${sv ? 'alt' : ''}" data-act="start">${sv ? 'New Season' : 'Start Season'}</button>
      <button class="btn alt" data-act="help">How to Play</button>
      <button class="btn alt" data-act="stats">📊 Stats</button>
    </div>
    <div class="howto">
      <div><b>1.</b> Pick a route across the season map.</div>
      <div><b>2.</b> Each turn: tap a card to select, tap again to play.</div>
      <div><b>3.</b> Beat every rival. Watch your 🛞 tyre wear!</div>
    </div></div>`;
}

// The route map itself. viewOnly (used mid-battle) makes every stop non-clickable.
function mapBody(viewOnly) {
  const S = mapState();
  const rows = run.map.nodes.map((row, f) => {
    const cells = row.map((n, l) => {
      if (!n) return '<div class="cell"></div>';
      const here = S.inBattle && f === run.floor && run.path[f] === l;
      const taken = !here && f <= S.last && run.path[f] === l;
      const avail = f === S.nextFloor && S.nextLanes.includes(l);
      const live = f >= S.nextFloor && S.R[f].has(l);
      const cls = here ? 'cur' : taken ? 'done' : avail ? 'avail' : live ? 'future' : 'locked';
      const info = NODES[n.t];
      const clickable = avail && !viewOnly && !S.inBattle;
      return `<div class="cell"><button class="node ${cls}" data-n="${f},${l}" ${clickable ? `data-act="node:${l}"` : 'disabled'}>${here ? '<span class="pin">📍</span>' : ''}<span class="ic">${info.icon}</span><span class="lb">${info.short}</span></button></div>`;
    }).join('');
    return `<div class="floor">${cells}</div>`;
  }).join('');
  return `<div class="map"><div class="mapin"><svg class="paths"></svg>${rows}</div></div>`;
}

function vMap() {
  return `${topBar()}${mapBody(false)}
    <div class="legend">Choose a route. Paths you don't take are locked out.</div>`;
}

// Read-only map shown on top of a battle.
function vMapView() {
  return `<div class="overlay"><div class="backdrop" data-act="mapclose"></div><div class="sheet mapsheet">
    <div class="row"><h2 style="margin:0">Season map</h2><button class="btn alt back" data-act="mapclose">Close</button></div>
    ${mapBody(true)}
    <div class="legend">📍 You are here · view only</div></div></div>`;
}

function drawPaths() {
  const map = app.querySelector('.map');
  const wrap = app.querySelector('.mapin');
  if (!wrap || !wrap.getBoundingClientRect) return;
  const svg = wrap.querySelector('svg');
  const wr = wrap.getBoundingClientRect();
  svg.setAttribute('width', wr.width);
  svg.setAttribute('height', wr.height);
  const S = mapState();
  const center = (f, l) => {
    const el = wrap.querySelector(`[data-n="${f},${l}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
  };
  let out = '';
  run.map.nodes.forEach((row, f) => row.forEach((n, l) => {
    if (!n) return;
    n.next.forEach(nl => {
      const a = center(f, l), c = center(f + 1, nl);
      if (!a || !c) return;
      let cls = 'dead';
      if (f + 1 <= S.last && run.path[f] === l && run.path[f + 1] === nl) cls = 'taken';
      else if (f === S.last && run.path[f] === l) cls = 'open';
      else if (f >= S.nextFloor && S.R[f].has(l)) cls = 'live';
      out += `<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}"/>`;
    });
  }));
  svg.innerHTML = out;
  const cur = wrap.querySelector('.node.cur') || wrap.querySelector('.node.avail');
  if (map && cur) {
    const top = cur.getBoundingClientRect().top - wr.top;
    map.scrollTop = Math.max(0, top - map.clientHeight / 2);
  }
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (run.screen === 'map' || (run.mapView && run.screen === 'battle')) drawPaths(); });

function vHelp() {
  return `<div class="overlay"><div class="backdrop" data-act="helpclose"></div><div class="sheet">
    <h2>How to Play</h2>
    <ul class="help">
      <li><b>Goal:</b> win a season of ${FLOORS} rounds and beat the Title Decider at the end.</li>
      <li><b>Your turn:</b> you get 3 ⚡ energy and 5 cards. Tap a card to select it, tap again to play it. Press End Turn when done.</li>
      <li><b>Fights:</b> reduce the rival's HP to 0. The badge on the rival shows what it will do next: ⚔️ attack, 🛡️ defend or ⬆️ power up.</li>
      <li><b>🛡️ Block</b> soaks up damage and wears off at the start of the next turn.</li>
      <li><b>🛞 Tyre wear:</b> some cards add wear. At full wear all your hits deal half damage. Pit Stop and Lift &amp; Coast bring it down.</li>
      <li><b>Routes:</b> the map branches. Each stop only connects to the ones just ahead of it, so choosing a path locks you out of the others.</li>
      <li><b>Stops:</b> 🏁 Race (gold + a new card), ⚡ Duel (tougher, more gold), 🔧 Garage (repair, or upgrade a card to a stronger "+" version), 🛒 Shop (spend 💰).</li>
      <li><b>Decks:</b> tap Draw or Discard in a fight to see what's in your piles. Exhausted cards are gone until the next fight.</li>
      <li><b>Sponsors:</b> beating a ⚡ Duel earns a sponsor with a permanent perk. Tap the sponsor icons under the top bar to review them.</li>
      <li>Your HP carries over between fights. If it hits 0 your season is over.</li>
      <li>Your run saves automatically between fights. Use Continue on the title screen to pick it back up.</li>
    </ul>
    <button class="btn" data-act="helpclose" style="width:100%">Got it</button>
  </div></div>`;
}

function vPiles() {
  const tab = run.pileView;
  const lists = { draw: b.drawPile, discard: b.discard, exhaust: b.exhaust };
  const names = { draw: 'Draw', discard: 'Discard', exhaust: 'Exhausted' };
  const counts = {};
  lists[tab].forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  const order = { attack: 0, defence: 1, skill: 2 };
  const ids = Object.keys(counts).sort((x, y) => order[CARDS[x].type] - order[CARDS[y].type] || CARDS[x].name.localeCompare(CARDS[y].name));
  const tabs = Object.keys(lists).map(t => `<button class="tab ${t === tab ? 'on' : ''}" data-act="pile:${t}">${names[t]} (${lists[t].length})</button>`).join('');
  const body = ids.length
    ? ids.map(id => `<div class="pilecard">${cardHtml(id, {})}${counts[id] > 1 ? `<span class="cnt">×${counts[id]}</span>` : ''}</div>`).join('')
    : '<div class="muted" style="padding:24px 0;text-align:center;width:100%">Empty</div>';
  const note = tab === 'draw' ? 'Shown in alphabetical order, not draw order.' : '';
  return `<div class="overlay"><div class="backdrop" data-act="pileclose"></div><div class="sheet">
    <div class="tabs">${tabs}</div>
    <div class="muted" style="text-align:center;min-height:18px">${note}</div>
    <div class="pilegrid">${body}</div>
    <button class="btn" data-act="pileclose" style="width:100%">Close</button>
  </div></div>`;
}

function vBattle() {
  const r = b.rival, m = intent();
  const dmg = m.t === 'atk' ? Math.max(0, m.v + r.str) : 0;
  const wearHit = m.t === 'atk' && m.wear ? (hasSp('rain') ? Math.floor(m.wear / 2) : m.wear) : 0; // Rain Gear halves it
  const it = b.cancel ? '🚨 Cancelled' : m.t === 'atk' ? `⚔️ ${dmg}${m.n > 1 ? `×${m.n}` : ''}${wearHit ? ` + 🛞${wearHit}` : ''}` : m.t === 'def' ? `🛡️ ${m.v}` : `⬆️ +${m.v} attack`;
  const segs = Array.from({ length: b.maxWear }, (_, i) => `<div class="seg ${i < b.wear ? 'on' : ''}"></div>`).join('');
  const sel = b.sel >= 0 ? CARDS[b.hand[b.sel]] : null;
  const hand = b.hand.map((id, i) => cardHtml(id, { act: `card:${i}`, sel: i === b.sel, no: CARDS[id].cost > b.energy, deal: b.dealing, live: true, i })).join('');
  const ko = r.hp <= 0 ? 'ko' : '';
  const rivalCls = `rival ${hasFx('rival', 'dmg') ? 'shake' : ''} ${hasFx('rival', 'lunge') ? 'lunge' : ''}`;
  const playerCls = `player ${hasFx('player', 'dmg') ? 'shake hurt' : ''}`;
  // --n repeats the hit animation once per hit (blocked hits still lunge, but don't shake)
  const rivalN = Math.max(1, b.fx.filter(f => f.target === 'rival' && f.kind === 'dmg').length, hasFx('rival', 'lunge') ? hitCount('player') : 1);
  const playerN = Math.max(1, b.fx.filter(f => f.target === 'player' && f.kind === 'dmg').length);
  return `${topBar()}
  <div class="arena">
    <div class="${rivalCls}" style="--n:${rivalN}">
      ${floaters('rival')}
      <div class="face ${ko}">${r.emoji}</div><b>${r.name}</b>${r.str ? ` <span class="muted">(${r.str > 0 ? '+' : ''}${r.str} atk)</span>` : ''}
      ${bar(r.hp, r.maxHp, '', 'rival', r.block, hasFx('rival', 'block') || hasFx('rival', 'blocked'), stepsOf('rival'))}
      <div class="intent">${it}</div>
    </div>
    <div class="log">${b.log}</div>
    <div class="${playerCls}" style="--n:${playerN}">
      ${floaters('player')}
      <div class="row"><div style="flex:1"><b>You</b>${bar(run.hp, run.maxHp, 'p', 'you', b.block, hasFx('player', 'block') || hasFx('player', 'blocked'), stepsOf('you'))}</div>
      <div class="energy">${b.energy}/${ENERGY}</div></div>
      <div class="wear ${b.wear >= b.maxWear ? 'dead' : ''}">🛞 ${segs}</div>
    </div>
  </div>
  <div class="hint">${sel ? (sel.cost > b.energy ? 'Not enough energy' : 'Tap again to play') : 'Tap a card to select'}</div>
  <div class="hand">${hand}</div>
  <div class="foot"><div class="piles">
      <button class="pilebtn" data-act="pile:draw">📚 Draw ${b.drawPile.length}</button>
      <button class="pilebtn" data-act="pile:discard">🗑️ Discard ${b.discard.length}</button>
      ${b.exhaust.length ? `<button class="pilebtn" data-act="pile:exhaust">🔥 ${b.exhaust.length}</button>` : ''}
    </div>
    <button class="btn" data-act="end" ${b.busy ? 'disabled' : ''}>End Turn</button></div>`;
}

function vReward() {
  return `${topBar()}<div class="center"><h2>Race won! 🏆</h2><div class="muted">+${run.lastGold} 💰 prize money${run.lastHeal ? ` · +${run.lastHeal} ❤️` : ``}. Add a card?</div>
    <div class="choices">${run.rewards.map(id => cardHtml(id, { act: `reward:${id}` })).join('')}</div>
    <button class="btn alt" data-act="skip">Skip</button></div>`;
}

function vGarage() {
  return `${topBar()}<div class="center"><h2>🔧 The Garage</h2><div class="muted">Choose one</div>
    <div class="stack">
      <button class="btn" data-act="heal">Repair — heal ${Math.floor(run.maxHp * 0.3)} HP</button>
      <button class="btn alt" data-act="tune" ${run.deck.some(canUpgrade) ? '' : 'disabled'}>⬆️ Upgrade a card</button>
    </div></div>`;
}

const REMOVE_COST = 50, HEAL_COST = 35, HEAL_AMT = 15;
const cardPrice = id => 35 + CARDS[id].cost * 12 + (CARDS[id].exhaust ? -8 : 0) + 5 * (id.length % 3);

function makeShop() {
  const ids = shuffle([...REWARD_POOL]).slice(0, 3);
  return { cards: ids.map(id => ({ id, price: cardPrice(id), sold: false })), removed: false, healed: false };
}

function vShop() {
  const s = run.shop;
  const cards = s.cards.map((c, i) => `<div class="shopitem">${cardHtml(c.id, { act: c.sold ? '' : `buy:${i}`, no: c.sold || run.gold < c.price })}
    <div class="price ${c.sold ? 'sold' : run.gold < c.price ? 'poor' : ''}">${c.sold ? 'SOLD' : `💰 ${c.price}`}</div></div>`).join('');
  const svc = (label, cost, used, act) => `<button class="btn alt svc" data-act="${used || run.gold < cost ? '' : act}" ${used || run.gold < cost ? 'disabled' : ''}>${label} <span>${used ? 'used' : `💰 ${cost}`}</span></button>`;
  return `${topBar()}<h2 style="text-align:center">🛒 Pit Lane Shop</h2>
    <div class="grid" style="flex:none;padding:8px 0">${cards}</div>
    <div class="stack" style="margin:0 auto">
      ${svc('Remove a card', REMOVE_COST, s.removed, 'shopRemove')}
      ${svc(`Quick repair (+${HEAL_AMT} HP)`, HEAL_COST, s.healed, 'shopHeal')}
      <button class="btn" data-act="skip">Leave shop</button>
    </div>`;
}

function vUpgrade() {
  const pick = run.upgradePick;
  const cards = run.deck.map((id, i) => (canUpgrade(id) ? cardHtml(id, { act: `upsel:${i}`, sel: i === pick }) : '')).join('');
  const id = pick >= 0 ? run.deck[pick] : null;
  const preview = id
    ? `<div class="upprev">${cardHtml(id, {})}<span class="uparrow">➜</span>${cardHtml(id + '+', {})}</div>`
    : '<div class="muted" style="text-align:center;padding:18px 0">Tap a card to preview its upgrade.</div>';
  return `${topBar()}<h2 style="text-align:center;margin:0">⬆️ Upgrade a card</h2>
    <div class="grid">${cards || '<div class="muted">Every card is already upgraded.</div>'}</div>
    ${preview}
    <div class="row" style="gap:10px"><button class="btn alt" data-act="back" style="flex:1">Back</button>
    <button class="btn" data-act="upconfirm" style="flex:2" ${id ? '' : 'disabled'}>Upgrade</button></div>`;
}

function vRemove() {
  return `${topBar()}<h2 style="text-align:center">Remove a card</h2>
    <div class="grid">${run.deck.map((id, i) => cardHtml(id, { act: `remove:${i}` })).join('')}</div>
    <button class="btn alt" data-act="back">Back</button>`;
}

function vOver() {
  return `<div class="center"><h2>💥 DNF</h2><div class="muted">Your season ended on round ${run.floor + 1}.</div><div class="muted">⏱ ${fmtTime(run.finalTime || run.time)}</div>
    <div class="stack"><button class="btn" data-act="start">New Season</button><button class="btn alt" data-act="home">Main Menu</button></div></div>`;
}
function vWin() {
  return `<div class="center"><h1>🏆</h1><h2>World Champion!</h2><div class="bigtime">⏱ ${fmtTime(run.finalTime || run.time)}</div>${run.newBest ? '<div class="newbest">New fastest win!</div>' : ''}<div class="muted">Deck size: ${run.deck.length} · HP left: ${run.hp}</div>
    <button class="btn" data-act="home">Back to Main Menu</button></div>`;
}

function vStats() {
  const st = loadStats(), t = st.totals;
  const rate = t.runs ? Math.round(t.wins / t.runs * 100) : 0;
  const tiles = [
    ['🏁', 'Runs', t.runs], ['🏆', 'Wins', t.wins], ['📈', 'Win rate', `${rate}%`],
    ['🥇', 'Best round', t.bestRound ? `${t.bestRound}/${FLOORS}` : '—'], ['⚔️', 'Fights won', t.fights], ['⚡', 'Duels won', t.elites],
    ['🃏', 'Cards played', t.cards], ['💥', 'Damage dealt', t.dmgDealt], ['🩹', 'Damage taken', t.dmgTaken],
    ['⏱️', 'Fastest win', t.bestTime === null ? '—' : fmtTime(t.bestTime)], ['📊', 'Avg run', t.runs ? fmtTime(Math.round(t.totalTime / t.runs)) : '—'], ['⌛', 'Total time', fmtTime(t.totalTime)],
  ].map(([i, l, v]) => `<div class="tile"><div class="tv">${typeof v === 'number' ? v.toLocaleString() : v}</div><div class="tl">${i} ${l}</div></div>`).join('');
  const rows = st.history.length ? st.history.map(h => {
    const ic = h.result === 'win' ? '🏆' : h.result === 'loss' ? '💥' : '🚪';
    const head = h.result === 'win' ? 'World Champion!' : h.result === 'loss' ? `DNF in round ${h.round}${h.killedBy ? ` · ${h.killedBy}` : ''}` : `Abandoned in round ${h.round}`;
    const date = new Date(h.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const sp = (h.sponsors || []).map(id => (SPONSORS[id] ? SPONSORS[id].icon : '')).join('');
    return `<div class="hrow ${h.result}"><span class="hic">${ic}</span><span><b>${head}</b><br><small>${date}${h.time ? ` · ⏱ ${fmtTime(h.time)}` : ''} · ${h.deck} cards${sp ? ` · ${sp}` : ''}</small></span></div>`;
  }).join('') : '<div class="muted" style="text-align:center;padding:18px 0">No runs yet. Finish a season and it shows up here.</div>';
  return `<div class="top"><button class="btn alt back" data-act="home">‹ Back</button><b style="color:var(--text)">Your Stats</b><span style="width:70px"></span></div>
    <div class="statsbody">
      <div class="tiles">${tiles}</div>
      <h2 style="margin:18px 0 8px">Recent runs</h2>
      <div class="hist">${rows}</div>
      ${t.runs ? '<button class="btn alt" data-act="statsreset" style="margin:18px 0 8px;width:100%">Reset stats</button>' : ''}
      <div class="muted" style="text-align:center;font-size:12px;padding-bottom:8px">Stats are stored on this device only.</div>
    </div>`;
}

const VIEWS = { upgrade: vUpgrade, stats: vStats, sponsor: vSponsor, shop: vShop, title: vTitle, map: vMap, battle: vBattle, reward: vReward, garage: vGarage, remove: vRemove, over: vOver, win: vWin };
function render() {
  syncTimer();
  const hand = app.querySelector('.hand');
  const sx = hand ? hand.scrollLeft : 0;
  const gridEl = app.querySelector('.grid');
  const gy = gridEl && run.screen === lastScreen ? gridEl.scrollTop : 0; // keep list position while picking cards
  // Only fade in when the screen itself changes, not on every re-render.
  if (run.screen === lastScreen && app.classList) app.classList.remove('enter');
  app.innerHTML = VIEWS[run.screen]() + (run.help ? vHelp() : '') + (run.pileView && run.screen === 'battle' ? vPiles() : '') + (run.sponsorView && run.sponsors && run.sponsors.length ? vSponsors() : '') + (run.mapView && run.screen === 'battle' ? vMapView() : '');
  const nh = app.querySelector('.hand');
  if (nh) nh.scrollLeft = sx;
  const ng = app.querySelector('.grid');
  if (ng && gy) ng.scrollTop = gy;
  if (run.screen === 'map' || (run.mapView && run.screen === 'battle')) drawPaths();
  if (SAVE_SCREENS.has(run.screen)) saveRun();
  // Multi-hit: count the HP number down one hit at a time, in step with the bar and shakes.
  if (app.querySelectorAll) app.querySelectorAll('.hpv').forEach(el => {
    el.dataset.seq.split(',').slice(1).forEach((hp, k) => setTimeout(() => { el.textContent = hp; }, k * HIT_GAP + 120));
  });
  if (run.screen === 'battle') { b.fx = []; b.steps = { rival: [], you: [] }; b.dealing = false; }
  if (run.screen !== lastScreen && app.classList) {
    lastScreen = run.screen;
    app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
  }
}

/* ---------- Input ---------- */
function nextFloor() { run.floor++; run.screen = 'map'; render(); }

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !el.dataset.act) return;
  const [act, arg] = el.dataset.act.split(':');
  Sfx.unlock();
  switch (act) {
    case 'mute': Sfx.toggle(); render(); break;
    case 'start': {
      const old = run.screen === 'title' ? peekSave() : null;
      if (old) {
        if (typeof confirm === 'function' && !confirm('Start a new season? Your saved run will be lost.')) break;
        recordRun(old, 'abandoned'); // keeps the stats honest
      }
      newRun();
      break;
    }
    case 'stats': run = { screen: 'stats' }; render(); break;
    case 'statsreset':
      if (typeof confirm === 'function' && !confirm('Erase all stats and run history on this device?')) break;
      try { localStorage.removeItem(STATS_KEY); } catch (e) {}
      render();
      break;
    case 'home': run = { screen: 'title' }; b = null; render(); break;
    case 'continue': {
      const sv = peekSave();
      if (!sv) break;
      run = { ...sv, deck: (sv.deck || []).map(id => id === 'fuelsave' ? 'groundfx' : id === 'fuelsave+' ? 'groundfx+' : id), sponsors: sv.sponsors || [], help: false, pileView: null, sponsorView: false, mapView: false };
      if (!SAVE_SCREENS.has(run.screen)) run.screen = 'map';
      lastScreen = null;
      render();
      break;
    }
    case 'sponsors': run.sponsorView = true; render(); break;
    case 'sponsorsclose': run.sponsorView = false; render(); break;
    case 'sp': {
      const s = SPONSORS[arg];
      if (!s || hasSp(arg)) break;
      run.sponsors.push(arg);
      if (s.onPick) s.onPick();
      Sfx.win();
      run.screen = 'reward';
      render();
      break;
    }
    case 'help': run.help = true; render(); break;
    case 'helpclose': run.help = false; render(); break;
    case 'pile': run.pileView = arg; Sfx.tick(); render(); break;
    case 'pileclose': run.pileView = null; render(); break;
    case 'mapview': run.mapView = true; Sfx.tick(); render(); break;
    case 'mapclose': run.mapView = false; render(); break;
    case 'node': {
      run.path[run.floor] = +arg;
      const t = run.map.nodes[run.floor][+arg].t;
      if (t === 'garage') { run.screen = 'garage'; render(); }
      else if (t === 'shop') { run.shop = makeShop(); run.screen = 'shop'; render(); }
      else startBattle(t);
      break;
    }
    case 'card': tapCard(+arg); break;
    case 'end': endTurn(); break;
    case 'reward': run.deck.push(arg); nextFloor(); break;
    case 'skip': nextFloor(); break;
    case 'heal': run.hp = Math.min(run.maxHp, run.hp + Math.floor(run.maxHp * 0.3)); Sfx.heal(); nextFloor(); break;
    case 'tune': run.screen = 'upgrade'; run.upgradePick = -1; render(); break;
    case 'upsel': run.upgradePick = +arg; Sfx.tick(); render(); break;
    case 'upconfirm': {
      const i = run.upgradePick, id = run.deck[i];
      if (i >= 0 && canUpgrade(id)) { run.deck[i] = id + '+'; run.upgradePick = -1; Sfx.pit(); nextFloor(); }
      break;
    }
    case 'back': run.screen = run.screen === 'upgrade' ? 'garage' : run.removeFrom; render(); break;
    case 'remove':
      run.deck.splice(+arg, 1);
      if (run.removeFrom === 'shop') { run.gold -= REMOVE_COST; run.shop.removed = true; Sfx.pit(); run.screen = 'shop'; render(); }
      else nextFloor();
      break;
    case 'buy': {
      const c = run.shop.cards[+arg];
      if (c.sold || run.gold < c.price) break;
      run.gold -= c.price; c.sold = true; run.deck.push(c.id); Sfx.win(); render();
      break;
    }
    case 'shopRemove': run.removeFrom = 'shop'; run.screen = 'remove'; render(); break;
    case 'shopHeal': run.gold -= HEAL_COST; run.shop.healed = true; run.hp = Math.min(run.maxHp, run.hp + HEAL_AMT); Sfx.heal(); render(); break;
  }
});

/* ---------- Timer ticking (browser only) ---------- */
if (typeof window !== 'undefined' && window.addEventListener) {
  let ticks = 0;
  setInterval(() => {
    syncTimer();
    const label = '⏱ ' + fmtTime(elapsedMs());
    document.querySelectorAll('.timer').forEach(el => { el.textContent = label; });
    if (++ticks % 15 === 0) touchSaveTime();
  }, 1000);
  document.addEventListener('visibilitychange', () => { syncTimer(); touchSaveTime(); });
  window.addEventListener('pagehide', () => { syncTimer(); touchSaveTime(); });
}

render();
