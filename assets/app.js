'use strict';
/* =========================================================
   מזג האוויר בישראל – ממשק לנתוני ה-RSS של השירות המטאורולוגי
   קורא data/weather.json (נכתב ע"י scripts/fetch_ims.py)
   תצוגה מקדימה של אפקטים:  ?sim=storm&night=1&temp=17
   ערכי sim: clear partly cloudy rain storm snow hail fog dust heat wind
   ========================================================= */

const TZ = 'Asia/Jerusalem';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const Q = new URLSearchParams(location.search);

const KIND_LABEL = {
  clear: 'שמיים בהירים', partly: 'מעונן חלקית', cloudy: 'מעונן', rain: 'גשם',
  storm: 'סופות רעמים', snow: 'שלג', hail: 'ברד', fog: 'ערפל', dust: 'אובך ואבק',
  heat: 'חם מאוד', wind: 'רוחות חזקות'
};

/* ---------------- זמן ושמש ---------------- */
function ilParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const o = {}; f.formatToParts(d).forEach(p => { o[p.type] = +p.value; });
  return o;
}
function sunInfo(d = new Date()) {
  const p = ilParts(d);
  const lat = 31.8, lon = 35.0;
  const start = Date.UTC(p.year, 0, 0);
  const n = Math.floor((Date.UTC(p.year, p.month - 1, p.day) - start) / 864e5);
  const g = 2 * Math.PI / 365 * (n - 1 + (p.hour - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const la = lat * Math.PI / 180;
  const cosH = Math.cos(90.833 * Math.PI / 180) / (Math.cos(la) * Math.cos(decl)) - Math.tan(la) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
  const noonUTC = 720 - 4 * lon - eqt;
  const off = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  const rise = noonUTC - 4 * ha + off, set = noonUTC + 4 * ha + off;
  const now = p.hour * 60 + p.minute + p.second / 60;
  return { rise, set, now, night: now < rise || now > set };
}
const D = n => `<span class="ltr">${n}°</span>`;
const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

/* ---------------- פענוח טקסט התחזית ---------------- */
function detect(raw, tmax) {
  const src = (raw || '').trim();
  if (!src) return null;
  const t = src.replace(/(ללא|לא צפוי|לא צפויים|אין|ללא סכנת)\s+(גשם|ממטרים|רעמים|ברקים|שלג|ברד|ערפל)/g, ' ');
  const has = r => r.test(t);
  if (has(/סופ(ות|ת)\s*רעמים|רעמים|ברקים|סערה/)) return 'storm';
  if (has(/שלג/)) return 'snow';
  if (has(/ברד/)) return 'hail';
  if (has(/גשם|ממטרים|טפטוף|גשום|גשומ/)) return 'rain';
  if (has(/ערפל|ראות\s+(נמוכה|מוגבלת)/)) return 'fog';
  if (has(/שרב|עומס\s*חום|גל\s*חום/)) return 'heat';
  if (has(/אבק|סופת\s*חול|אובך\s*(כבד|סמיך|מוגבר|רב)/)) return 'dust';
  if (has(/מעונן\s*חלקית|עננות\s*חלקית|עננות\s*משתנה|מעונן\s*לסירוגין|עננות\s*דלילה/)) return 'partly';
  if (has(/שמי(ים|ם)\s*בהירים|בהיר/) && !has(/מעונן|עננות/)) return tmax >= 37 ? 'heat' : 'clear';
  if (has(/מעונן|עננות|עננים/)) return has(/מעט|קלה/) ? 'partly' : 'cloudy';
  if (has(/רוח(ות)?\s*חזק(ה|ות)|סוער/)) return 'wind';
  if (has(/חם/)) return 'heat';
  return tmax != null && tmax >= 37 ? 'heat' : 'partly';
}
function parseTemps(txt) {
  const o = {}; if (!txt) return o; let m;
  const N = '(-?\\d{1,2})';
  if ((m = txt.match(new RegExp('מינ(?:ימום|\\.|\')?\\D{0,14}' + N)))) o.min = +m[1];
  if ((m = txt.match(new RegExp('מקס(?:ימום|\\.|\')?\\D{0,14}' + N)))) o.max = +m[1];
  if (o.min == null || o.max == null) {
    if ((m = txt.match(new RegExp(N + '\\s*(?:-|–|עד|/)\\s*' + N + '\\s*(?:°|º|מעלות|צלזיוס)')))
      || (m = txt.match(new RegExp('טמפרטורה\\D{0,14}' + N + '\\s*(?:-|–|עד|/)\\s*' + N)))) {
      const a = +m[1], b = +m[2]; o.min = Math.min(a, b); o.max = Math.max(a, b);
    } else if ((m = txt.match(new RegExp(N + '\\s*(?:°|º|מעלות)')))) {
      o.cur = +m[1];
    }
  }
  return o;
}
function parseExtras(txt) {
  const o = {}; let m;
  if ((m = txt.match(/לחות[^\d]{0,16}(\d{1,3})\s*%?/))) o.hum = +m[1];
  if ((m = txt.match(/רוח[^\n.]{0,50}?(\d{1,3})\s*(?:[-–]|עד)?\s*(\d{1,3})?\s*(?:קמ|ק"מ|קמ"ש|קמ״ש|km)/))) o.wind = m[2] ? `${m[1]}–${m[2]}` : m[1];
  return o;
}
function info(it) {
  if (!it) return { kind: null };
  const body = it.text || '';
  const all = (it.title || '') + '\n' + body;
  const t = parseTemps(all);
  const kind = detect(body || it.title, t.max ?? t.cur);
  return { kind, ...t, ...parseExtras(all), title: it.title || '', text: body };
}
const tempMain = i => i.max ?? i.cur ?? i.min ?? null;

/* ---------------- איורים מונפשים (SVG) ---------------- */
let _uid = 0;
const CLOUD = 'M26 72h48a16 16 0 0 0 2-31.9A22 22 0 0 0 33 38 17 17 0 0 0 26 72z';
function icon(kind, night, cls = '') {
  const u = 'i' + (++_uid);
  const defs = `<defs>
    <radialGradient id="${u}s"><stop offset="0" stop-color="#fff7c9"/><stop offset=".55" stop-color="#ffd43b"/><stop offset="1" stop-color="#ff9f1c"/></radialGradient>
    <radialGradient id="${u}h"><stop offset="0" stop-color="#ffe29a"/><stop offset=".6" stop-color="#ff8a2b"/><stop offset="1" stop-color="#e8541a"/></radialGradient>
    <linearGradient id="${u}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d8ea"/></linearGradient>
    <linearGradient id="${u}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa6bd"/><stop offset="1" stop-color="#58627a"/></linearGradient>
  </defs>`;
  const rays = (g, r1 = 24, r2 = 33) => `<g class="rays" stroke="${g}" stroke-width="4" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return `<line x1="${50 + c * r1}" y1="${50 + s * r1}" x2="${50 + c * r2}" y2="${50 + s * r2}"/>`; }).join('')}</g>`;
  const sun = (fill = `url(#${u}s)`, ray = '#ffd43b') => `<g class="glow"><circle cx="50" cy="50" r="30" fill="${ray}" opacity=".22"/></g>${rays(ray)}<circle cx="50" cy="50" r="17" fill="${fill}"/>`;
  const moon = `<g class="glow"><circle cx="50" cy="50" r="34" fill="#cfd8ff" opacity=".12"/></g><path d="M60 16a34 34 0 1 0 24 58A28 28 0 0 1 60 16z" fill="#f4efd6"/><circle class="twinkle" cx="78" cy="26" r="2.2" fill="#fff"/><circle class="twinkle" cx="86" cy="42" r="1.6" fill="#fff"/><circle class="twinkle" cx="70" cy="14" r="1.4" fill="#fff"/>`;
  const cloud = (fill, tr = '', c = 'float') => `<g transform="${tr}"><g class="${c}"><path d="${CLOUD}" fill="url(#${u}${fill})"/></g></g>`;
  const drops = [40, 53, 66].map(x => `<line class="drop" x1="${x}" y1="76" x2="${x - 4}" y2="86" stroke="#7fc4ff" stroke-width="4" stroke-linecap="round"/>`).join('');
  let body;
  switch (kind) {
    case 'clear': body = night ? moon : sun(); break;
    case 'partly': body = (night ? `<g transform="translate(-14,-16) scale(.78)">${moon}</g>` : `<g transform="translate(-14,-16) scale(.78)">${sun()}</g>`) + cloud('c', 'translate(8,6)'); break;
    case 'cloudy': body = cloud('d', 'translate(-12,-8) scale(.82)', 'float2') + cloud('c', 'translate(4,8)'); break;
    case 'rain': body = cloud('d', 'translate(0,-6)') + `<g>${drops}</g>`; break;
    case 'storm': body = cloud('d', 'translate(0,-8)') + `<polygon class="bolt" points="55,58 43,80 52,80 46,98 64,73 55,73 61,58" fill="#ffd43b" stroke="#fff3a0" stroke-width="1.2" stroke-linejoin="round"/>`; break;
    case 'snow': body = cloud('c', 'translate(0,-8)') + `<g>${[40, 53, 66].map(x => `<circle class="flake" cx="${x}" cy="80" r="3" fill="#fff"/>`).join('')}</g>`; break;
    case 'hail': body = cloud('d', 'translate(0,-8)') + `<g>${[40, 53, 66].map(x => `<circle class="drop" cx="${x}" cy="80" r="3.4" fill="#dff1ff" stroke="#9fd0ff"/>`).join('')}</g>`; break;
    case 'fog': body = cloud('c', 'translate(0,-12) scale(.95)') + `<g stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".85">${[70, 80, 90].map((y, i) => `<line class="mist" x1="${24 + i * 4}" y1="${y}" x2="${76 - i * 4}" y2="${y}"/>`).join('')}</g>`; break;
    case 'dust': body = `<g transform="translate(0,-8)">${sun(`url(#${u}h)`, '#f2a65a')}</g><g fill="none" stroke="#d9a35f" stroke-width="3.5" stroke-linecap="round" opacity=".9">${[72, 82, 92].map((y, i) => `<path class="mist" d="M${22 + i * 3} ${y}q10-8 20 0t20 0 t20 0"/>`).join('')}</g>`; break;
    case 'heat': body = `<g transform="translate(0,-8) scale(1.0)">${sun(`url(#${u}h)`, '#ff9a3c')}</g><g fill="none" stroke="#ffd2a0" stroke-width="3.2" stroke-linecap="round">${[28, 46, 64].map(x => `<path class="shim" d="M${x} 90q4-5 0-10t0-10"/>`).join('')}</g>`; break;
    case 'wind': body = `<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"><path class="gust" d="M14 38h46a9 9 0 1 0-9-9"/><path class="gust" d="M14 54h58a10 10 0 1 1-10 10"/><path class="gust" d="M14 70h30a8 8 0 1 1-8 8"/></g>`; break;
    default: body = `<g opacity=".4">${cloud('c', '')}</g>`;
  }
  return `<svg class="ic ${cls}" viewBox="0 0 100 100" aria-hidden="true">${defs}${body}</svg>`;
}

/* ---------------- שמיים חיים (canvas) ---------------- */
const SKY = {
  day: { clear: ['#1673d9', '#8ad3ff'], partly: ['#3a82c4', '#a6cfe6'], cloudy: ['#5b7186', '#a3b4c2'], rain: ['#32475c', '#6a8296'], storm: ['#1d2434', '#4b5067'], snow: ['#7a90a6', '#d3dee8'], hail: ['#3a4b5e', '#7e93a6'], fog: ['#85929a', '#c6cccf'], dust: ['#b4843f', '#e6c98f'], heat: ['#e8741f', '#ffd484'], wind: ['#3b83b6', '#a6d2e6'] },
  night: { clear: ['#050929', '#1a2a6c'], partly: ['#0b1032', '#2b3763'], cloudy: ['#10141d', '#333c4b'], rain: ['#09101a', '#26323f'], storm: ['#06060e', '#2a2541'], snow: ['#18202e', '#4b5b72'], hail: ['#0b111b', '#2f3d4d'], fog: ['#181c20', '#454d53'], dust: ['#271a0e', '#6c4a29'], heat: ['#2a1207', '#7b3a14'], wind: ['#0a1828', '#2b4862'] }
};
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function applySkyColors(kind, night, twi) {
  let [a, b] = SKY[night ? 'night' : 'day'][kind] || SKY.day.clear;
  if (twi > 0) { b = mix(b, '#ff9a5a', .55 * twi); a = mix(a, '#4a3a8a', .25 * twi); }
  const r = document.documentElement.style;
  r.setProperty('--sky1', a); r.setProperty('--sky2', b);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', a);
}

class Sky {
  constructor(c) {
    this.c = c; this.g = c.getContext('2d');
    this.kind = 'clear'; this.night = false; this.t = 0; this.last = 0;
    this.flash = 0; this.nextBolt = 2.5; this.bolt = null; this.boltLife = 0;
    this.flashEl = $('#flash');
    this.resize(); this.build();
    let w = innerWidth;
    addEventListener('resize', () => { if (Math.abs(innerWidth - w) > 40 || !this.small) { w = innerWidth; this.resize(); this.build(); } });
    if (REDUCE) this.draw(0); else requestAnimationFrame(t => this.loop(t));
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = innerWidth; this.H = innerHeight;
    this.c.width = Math.round(this.W * d); this.c.height = Math.round(this.H * d);
    this.g.setTransform(d, 0, 0, d, 0, 0); this.small = this.W < 700;
  }
  set(kind, night) { if (kind === this.kind && night === this.night) return; this.kind = kind; this.night = night; this.build(); if (REDUCE) this.draw(0); }
  cloudSprite(tint) {
    const s = document.createElement('canvas'); s.width = 380; s.height = 170; const g = s.getContext('2d');
    [[60, 118, 46], [130, 86, 62], [205, 76, 68], [275, 100, 56], [320, 122, 40], [190, 118, 56]].forEach(([x, y, r]) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, tint + 'e6'); gr.addColorStop(.55, tint + '99'); gr.addColorStop(1, tint + '00');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    });
    return s;
  }
  build() {
    const k = this.kind, n = this.night, W = this.W, H = this.H, sc = this.small ? .55 : 1, R = Math.random;
    this.stars = n && ['clear', 'partly', 'wind', 'heat', 'dust'].includes(k)
      ? Array.from({ length: Math.round((k === 'clear' ? 200 : 110) * sc) }, () => ({ x: R() * W, y: R() * H * .8, r: R() * 1.3 + .25, p: R() * 6.28, s: .6 + R() * 1.6 })) : [];
    const cn = { clear: 2, partly: 6, cloudy: 11, rain: 11, storm: 14, snow: 10, hail: 11, fog: 3, dust: 4, heat: 1, wind: 6 }[k] || 3;
    const dark = ['rain', 'storm', 'hail'].includes(k);
    const tint = dark ? (n ? '#262d3b' : '#5d687b') : (k === 'cloudy' ? (n ? '#454e61' : '#e4ebf2') : (n ? '#6f7c9c' : '#ffffff'));
    this.sprite = this.cloudSprite(tint);
    this.clouds = Array.from({ length: Math.round(cn * (this.small ? .7 : 1)) }, () => ({ x: R() * (W + 500) - 250, y: R() * H * .55 - 30, s: .8 + R() * 1.5, v: (5 + R() * 11) * (k === 'wind' ? 5 : 1), a: .3 + R() * .5 }));
    const rn = { rain: 150, storm: 280, hail: 0 }[k] || 0;
    this.drops = Array.from({ length: Math.round(rn * sc) }, () => ({ x: R() * (W + 300), y: R() * H, l: 12 + R() * 16, v: 650 + R() * 400 }));
    this.hail = Array.from({ length: k === 'hail' ? Math.round(120 * sc) : 0 }, () => ({ x: R() * (W + 100), y: R() * H, r: 1.5 + R() * 2, v: 600 + R() * 300 }));
    this.flakes = Array.from({ length: k === 'snow' ? Math.round(170 * sc) : 0 }, () => ({ x: R() * W, y: R() * H, r: .8 + R() * 2.8, v: 30 + R() * 50, p: R() * 6.28 }));
    this.fogs = Array.from({ length: k === 'fog' ? 7 : 0 }, (_, i) => ({ x: R() * W, y: H * (.25 + i * .1), s: 1.6 + R() * 1.4, v: 8 + R() * 14 }));
    this.dust = Array.from({ length: k === 'dust' ? Math.round(150 * sc) : 0 }, () => ({ x: R() * W, y: R() * H, r: .8 + R() * 2.2, v: 25 + R() * 70, p: R() * 6.28 }));
    this.streaks = Array.from({ length: k === 'wind' ? Math.round(40 * sc) : 0 }, () => ({ x: R() * W, y: R() * H, l: 90 + R() * 160, v: 600 + R() * 500 }));
  }
  loop(t) {
    const dt = Math.min((t - this.last) / 1000 || 0, .05); this.last = t; this.t += dt;
    this.draw(dt); requestAnimationFrame(x => this.loop(x));
  }
  makeBolt() {
    const W = this.W, H = this.H; let x = W * (.15 + Math.random() * .7), y = -10; const pts = [[x, y]];
    while (y < H * (.5 + Math.random() * .2)) { y += 22 + Math.random() * 38; x += (Math.random() - .5) * 70; pts.push([x, y]); }
    const br = []; for (let i = 3; i < pts.length - 1; i += 3) { if (Math.random() < .6) { let [bx, by] = pts[i]; const b = [[bx, by]]; for (let j = 0; j < 4; j++) { bx += (Math.random() - .3) * 50; by += 20 + Math.random() * 28; b.push([bx, by]); } br.push(b); } }
    this.bolt = { main: pts, br }; this.boltLife = .22 + Math.random() * .12;
  }
  draw(dt) {
    const g = this.g, W = this.W, H = this.H, k = this.kind, n = this.night, t = this.t;
    g.clearRect(0, 0, W, H);
    const sx = W * (this.small ? .8 : .17), sy = H * .14, M = Math.min(W, H);
    /* שמש / ירח */
    const sunny = ['clear', 'partly', 'wind', 'heat', 'dust'].includes(k);
    if (sunny && !n) {
      const pulse = 1 + Math.sin(t * .9) * .05, big = k === 'heat' ? 1.35 : 1, a = k === 'partly' || k === 'dust' ? .7 : 1;
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, M * .62 * pulse * big);
      gr.addColorStop(0, `rgba(255,250,215,${.95 * a})`); gr.addColorStop(.12, `rgba(255,232,150,${.55 * a})`); gr.addColorStop(.4, `rgba(255,205,110,${.16 * a})`); gr.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = k === 'heat' ? '#fff0c0' : '#fffbe6'; g.beginPath(); g.arc(sx, sy, 34 * big, 0, 7); g.fill();
    } else if (!n && ['cloudy', 'snow', 'fog'].includes(k)) {
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, M * .5); gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    if (n && ['clear', 'partly', 'wind', 'heat', 'dust'].includes(k)) {
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, M * .4); gr.addColorStop(0, 'rgba(210,222,255,.4)'); gr.addColorStop(.25, 'rgba(180,200,255,.12)'); gr.addColorStop(1, 'rgba(160,180,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f6f1da'; g.beginPath(); g.arc(sx, sy, 28, 0, 7); g.fill();
      g.fillStyle = 'rgba(150,140,110,.28)'; [[-8, -6, 7], [7, 5, 9], [-2, 12, 5]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(sx + dx, sy + dy, r, 0, 7); g.fill(); });
    }
    /* כוכבים */
    this.stars.forEach(s => { const a = .35 + .65 * (.5 + .5 * Math.sin(t * s.s + s.p)); g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); });
    /* גלי חום */
    if (k === 'heat') {
      g.lineWidth = 18; for (let i = 0; i < 8; i++) {
        g.strokeStyle = 'rgba(255,236,190,.045)'; g.beginPath();
        const y0 = H * (.55 + i * .06) - ((t * 14 + i * 40) % 80);
        for (let x = 0; x <= W; x += 14) { const y = y0 + Math.sin(x / 70 + t * 1.6 + i) * 6; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
    }
    /* עננים */
    this.clouds.forEach(c => {
      c.x += c.v * dt; if (c.x > W + 260) c.x = -400 * c.s;
      g.globalAlpha = c.a; g.drawImage(this.sprite, c.x, c.y, 380 * c.s, 170 * c.s);
    });
    g.globalAlpha = 1;
    /* ערפל */
    this.fogs.forEach(f => { f.x += f.v * dt; if (f.x > W + 200) f.x = -700; g.globalAlpha = .34; g.drawImage(this.sprite, f.x, f.y, 380 * f.s * 2, 170 * f.s * .9); }); g.globalAlpha = 1;
    /* גשם */
    if (this.drops.length) {
      g.strokeStyle = k === 'storm' ? 'rgba(200,220,255,.5)' : 'rgba(205,225,255,.45)'; g.lineWidth = 1.3; g.beginPath();
      this.drops.forEach(d => { d.y += d.v * dt; d.x -= d.v * dt * .22; if (d.y > H) { d.y = -30; d.x = Math.random() * (W + 300); } g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * .22, d.y - d.l); });
      g.stroke();
    }
    /* ברד */
    if (this.hail.length) { g.fillStyle = 'rgba(235,246,255,.85)'; this.hail.forEach(h => { h.y += h.v * dt; h.x -= h.v * dt * .12; if (h.y > H) { h.y = -10; h.x = Math.random() * (W + 100); } g.beginPath(); g.arc(h.x, h.y, h.r, 0, 7); g.fill(); }); }
    /* שלג */
    this.flakes.forEach(f => { f.y += f.v * dt; f.x += Math.sin(t * .8 + f.p) * 14 * dt; if (f.y > H + 5) { f.y = -5; f.x = Math.random() * W; } g.fillStyle = `rgba(255,255,255,${.5 + f.r / 7})`; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 7); g.fill(); });
    /* אבק */
    this.dust.forEach(d => { d.x += d.v * dt; d.y += Math.sin(t + d.p) * 8 * dt; if (d.x > W + 5) { d.x = -5; d.y = Math.random() * H; } g.fillStyle = 'rgba(222,178,108,.38)'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, 7); g.fill(); });
    /* רוח */
    if (this.streaks.length) {
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.4; g.beginPath();
      this.streaks.forEach(s => { s.x -= s.v * dt; if (s.x + s.l < 0) { s.x = W + 20; s.y = Math.random() * H; } g.moveTo(s.x, s.y); g.lineTo(s.x + s.l, s.y + Math.sin(s.x / 90) * 4); });
      g.stroke();
    }
    /* ברקים */
    if (k === 'storm' && !REDUCE) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.makeBolt(); this.flash = 1; this.nextBolt = 3 + Math.random() * 6; if (Math.random() < .4) setTimeout(() => { this.flash = .8; }, 140); }
      this.flash = Math.max(0, this.flash - dt * 3.4);
      if (this.boltLife > 0 && this.bolt) {
        this.boltLife -= dt; const a = Math.min(1, this.boltLife * 8);
        g.save(); g.lineJoin = 'round'; g.shadowBlur = 24; g.shadowColor = '#a9c1ff'; g.strokeStyle = `rgba(240,244,255,${a})`;
        g.lineWidth = 2.6; g.beginPath(); this.bolt.main.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
        g.lineWidth = 1.3; this.bolt.br.forEach(b => { g.beginPath(); b.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); });
        g.restore();
      }
      this.flashEl.style.opacity = (this.flash * .42).toFixed(3);
    } else if (this.flashEl.style.opacity !== '0') this.flashEl.style.opacity = '0';
  }
}

/* ---------------- אפליקציה ---------------- */
const S = { data: null, city: null, sky: null, shown: null };
const feedsBy = cat => (S.data?.feeds || []).filter(f => f.cat === cat);
const cityFeeds = () => feedsBy('city').filter(f => f.ok || f.items?.length);

function levelOf(s) { return /אדומה|אדום/.test(s) ? 'red' : /כתומה|כתום/.test(s) ? 'org' : 'yel'; }

function renderAlerts() {
  const box = $('#alerts'); const feeds = feedsBy('alert');
  const seen = new Set(), list = [];
  feeds.forEach(f => (f.items || []).forEach(it => {
    const key = (it.title || '') + '|' + (it.text || '');
    if (!key.trim() || key === '|' || seen.has(key)) return; seen.add(key); list.push(it);
  }));
  if (!feeds.some(f => f.ok)) { box.innerHTML = ''; return; }
  if (!list.length) { box.innerHTML = '<div class="alerts-ok">אין אזהרות פעילות כרגע</div>'; return; }
  const order = { red: 0, org: 1, yel: 2 };
  list.sort((a, b) => order[levelOf(a.title)] - order[levelOf(b.title)]);
  box.innerHTML = list.slice(0, 8).map(it => `<div class="alert ${levelOf(it.title)}" role="alert"><span class="pulse"></span><div><b>${esc(it.title || 'אזהרה')}</b>${it.text && it.text !== it.title ? `<small>${esc(it.text)}</small>` : ''}</div></div>`).join('');
}

function cityFeed() { return cityFeeds().find(f => f.id === S.city) || cityFeeds()[0]; }

function animateNum(el, to) {
  const from = parseFloat(el.dataset.v ?? to); el.dataset.v = to;
  if (REDUCE || isNaN(from) || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function arcSvg(sun) {
  const { rise, set, now, night } = sun;
  const P0 = [580, 82], P1 = [300, -52], P2 = [20, 82];
  const B = t => [0, 1].map(i => (1 - t) * (1 - t) * P0[i] + 2 * (1 - t) * t * P1[i] + t * t * P2[i]);
  let p, dot;
  if (!night) { p = (now - rise) / (set - rise); dot = `<circle cx="${B(p)[0]}" cy="${B(p)[1]}" r="9" fill="#ffd43b"/><circle cx="${B(p)[0]}" cy="${B(p)[1]}" r="20" fill="#ffd43b" opacity=".25"><animate attributeName="r" values="14;24;14" dur="3s" repeatCount="indefinite"/></circle>`; }
  else { const nn = now < rise ? now + 1440 : now; p = (nn - set) / (rise + 1440 - set); dot = `<circle cx="${B(p)[0]}" cy="${B(p)[1]}" r="8" fill="#f4efd6"/><circle cx="${B(p)[0]}" cy="${B(p)[1]}" r="18" fill="#cfd8ff" opacity=".22"/>`; }
  const d = `M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`;
  const prog = Math.max(0, Math.min(1, p));
  const L = 640;
  return `<svg viewBox="0 0 600 96" role="img" aria-label="מסלול ${night ? 'הירח' : 'השמש'} בשמיים">
    <line x1="0" y1="86" x2="600" y2="86" stroke="rgba(255,255,255,.25)"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2.5" stroke-linecap="round" pathLength="1" stroke-dasharray="${prog} 1"/>
    ${dot}</svg>
    <div class="arc-labels"><span>זריחה <b>${hhmm(rise)}</b></span><span>${night ? 'לילה' : `אור יום ${Math.floor((set - rise) / 60)}:${String(Math.round((set - rise) % 60)).padStart(2, '0')} שע׳`}</span><span>שקיעה <b>${hhmm(set)}</b></span></div>`;
}

function renderHero() {
  const hero = $('#hero'); const f = cityFeed(); const sun = sunInfo();
  let night = Q.has('night') ? Q.get('night') !== '0' : sun.night; sun.night = night;
  const it = f?.items?.[0]; const i = info(it);
  let kind = Q.get('sim') && KIND_LABEL[Q.get('sim')] ? Q.get('sim') : i.kind;
  let temp = Q.has('temp') ? +Q.get('temp') : tempMain(i);
  const name = f?.name || '—';
  const chips = [];
  if (i.min != null && i.max != null) chips.push(`<span class="chip"><i>מינימום</i>${D(i.min)}</span><span class="chip"><i>מקסימום</i>${D(i.max)}</span>`);
  if (i.hum != null) chips.push(`<span class="chip"><i>לחות</i><span class="ltr">${i.hum}%</span></span>`);
  if (i.wind) chips.push(`<span class="chip"><i>רוח</i>${esc(i.wind)} קמ״ש</span>`);
  const k = kind || 'partly';
  const when = it?.title ? esc(it.title) : '';
  const txt = (it?.text || '').trim();
  hero.innerHTML = `
    <div class="hero-main">
      <div>
        <h1>${esc(name)}</h1>
        <div class="when">${when}</div>
        <div class="temp">${temp != null ? `<span class="num" id="tnum">${temp}</span><span class="deg">°</span>` : `<span class="none">—</span>`}</div>
        <div class="cond">${kind ? KIND_LABEL[kind] : 'אין נתוני תחזית'}</div>
        <div class="chips">${chips.join('')}</div>
      </div>
      ${icon(k, night, 'hero-icon')}
    </div>
    ${txt ? `<p class="hero-text">${esc(txt.length > 420 ? txt.slice(0, 420) + '…' : txt)}</p>` : ''}
    <div class="arc">${arcSvg(sun)}</div>`;
  if (temp != null) { const el = $('#tnum'); const prev = S.shown; el.dataset.v = prev ?? temp; animateNum(el, temp); S.shown = temp; }
  const twi = Math.max(0, 1 - Math.min(Math.abs(sun.now - sun.rise), Math.abs(sun.now - sun.set)) / 45);
  applySkyColors(k, night, Q.has('night') ? 0 : twi);
  S.sky.set(k, night);
  document.title = (temp != null ? `${temp}° ` : '') + `${name} · מזג האוויר בישראל`;
}

function renderWeek() {
  const f = cityFeed(); const sun = sunInfo(); const box = $('#week');
  $('#weekTitle').textContent = f ? `הימים הקרובים · ${f.name}` : 'הימים הקרובים';
  const items = (f?.items || []).slice(0, 8);
  if (!items.length) { box.innerHTML = '<div class="empty">אין כרגע נתוני תחזית לעיר זו.</div>'; return; }
  box.innerHTML = items.map((it, idx) => {
    const i = info(it);
    const tm = i.min != null && i.max != null ? `${D(i.max)} <small>/ ${D(i.min)}</small>` : tempMain(i) != null ? D(tempMain(i)) : '';
    const body = (it.text || '').replace(/\s+/g, ' ').trim();
    return `<article class="day">${''}<div class="dn">${esc(it.title || `יום ${idx + 1}`)}</div>${icon(i.kind || 'partly', idx === 0 && sun.night)}<div class="tmp">${tm}</div>${i.kind ? `<div style="font-size:14px">${KIND_LABEL[i.kind]}</div>` : ''}<p>${esc(body)}</p></article>`;
  }).join('');
}

function renderCountry() {
  const f = feedsBy('country')[0]; const box = $('#country');
  const items = f?.items || [];
  if (!items.length) { box.innerHTML = '<div class="empty">אין כרגע תחזית כללית.</div>'; return; }
  box.innerHTML = items.slice(0, 8).map(it => {
    const i = info(it);
    return `<article class="cday">${icon(i.kind || 'partly', false)}<div><b>${esc(it.title)}</b><p>${esc(it.text)}</p></div></article>`;
  }).join('');
}

function renderCities() {
  const box = $('#cities'); const sun = sunInfo();
  box.innerHTML = cityFeeds().map(f => {
    const i = info(f.items?.[0]); const t = tempMain(i);
    return `<button class="city" data-id="${esc(f.id)}" aria-pressed="${f.id === S.city}">${icon(i.kind || 'partly', sun.night)}<span><span class="cn">${esc(f.name)}</span><span class="ct">${t != null ? D(t) : '—'}${i.min != null && i.max != null ? ` <small class="ltr">${i.min}°–${i.max}°</small>` : ''}</span></span></button>`;
  }).join('');
}

function wavePath(h, i) {
  const amp = 4 + Math.min(3, h) * 5 + i * 1.5, w = 200 + i * 30; let d = `M0 22 `;
  for (let x = 0; x <= 400; x += w) d += `q${w / 4} ${-amp} ${w / 2} 0 t${w / 2} 0 `;
  return d + `V60 H0z`;
}
function renderSea() {
  const box = $('#sea'); const feeds = feedsBy('sea').filter(f => f.items?.length);
  if (!feeds.length) { box.innerHTML = '<div class="empty">אין כרגע נתוני ים.</div>'; return; }
  box.innerHTML = feeds.map(f => {
    const it = f.items[0]; const all = (it.title || '') + '\n' + (it.text || ''); let m;
    let h = null, hh = null;
    if ((m = all.match(/גובה[^\d\n]{0,25}(\d+(?:\.\d+)?)(?:\s*(?:-|–|עד)\s*(\d+(?:\.\d+)?))?/))) { h = m[1]; hh = m[2] || null; }
    let st = null; if ((m = all.match(/טמפרטורת\s*(?:פני\s*)?ה(?:ים|מים)[^\d]{0,12}(\d{1,2})/))) st = +m[1];
    const hv = parseFloat(hh ?? h ?? 0.6); const dur = Math.max(4, 11 - hv * 2.5);
    return `<article class="wave"><div class="wh"><b>${esc(f.name)}</b><span class="big">${h != null ? `<span class="ltr">${hh ? `${h}–${hh}` : h}</span><small> מ׳</small>` : ''}${st != null ? ` <small>· ים ${D(st)}</small>` : ''}</span></div><p>${esc((it.text || '').replace(/\s+/g, ' '))}</p>
      <svg class="sw" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true"><path d="${wavePath(hv, 0)}" fill="rgba(120,200,255,.22)" style="animation-duration:${dur + 3}s"/><path d="${wavePath(hv, 1)}" fill="rgba(90,170,255,.28)" style="animation-duration:${dur}s;animation-direction:reverse"/></svg></article>`;
  }).join('');
}

function uvColor(v) { return v >= 11 ? '#b36bff' : v >= 8 ? '#ff4d5e' : v >= 6 ? '#ff9a1f' : v >= 3 ? '#ffd23f' : '#5ce1a0'; }
function renderUV() {
  const box = $('#uv'); const f = feedsBy('uv')[0]; const items = f?.items || [];
  if (!items.length) { box.innerHTML = '<div class="empty">אין כרגע נתוני UV.</div>'; return; }
  const rows = []; const re = /([\u0590-\u05FF][\u0590-\u05FF\-'" ]{1,24}?)\s*(?:\||:|–|-)\s*(\d{1,2})(?!\d)/g;
  items.forEach(it => {
    const txt = (it.title ? it.title + '\n' : '') + (it.text || '');
    let m; while ((m = re.exec(txt))) rows.push([m[1].trim(), +m[2]]);
    if (!rows.length && it.title) { const n = (it.text || '').match(/(\d{1,2})/); if (n) rows.push([it.title.replace(/^.*?(?:ב|ל)(?=\S)/, '').trim() || it.title, +n[1]]); }
  });
  const uniq = []; const seen = new Set(); rows.forEach(r => { if (!seen.has(r[0])) { seen.add(r[0]); uniq.push(r); } });
  if (!uniq.length) { box.innerHTML = `<div class="rawbox">${esc(items.map(i => (i.title ? i.title + '\n' : '') + i.text).join('\n\n'))}</div>`; return; }
  box.innerHTML = uniq.slice(0, 16).map(([n, v]) => `<div class="uvrow" style="--c:${uvColor(v)}"><span>${esc(n)}</span><span class="bar"><i data-w="${Math.min(100, v / 12 * 100)}"></i></span><em>${v}</em></div>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll('.bar i').forEach(i => i.style.width = i.dataset.w + '%')));
}

function renderMeta() {
  const d = S.data; const b = $('#banner');
  const when = d?.fetchedAt ? new Date(d.fetchedAt) : null;
  const mins = when ? Math.round((Date.now() - when) / 60000) : null;
  const ago = mins == null ? '' : mins < 2 ? 'עכשיו' : mins < 60 ? `לפני ${mins} דקות` : mins < 1440 ? `לפני ${Math.round(mins / 60)} שעות` : `לפני ${Math.round(mins / 1440)} ימים`;
  $('#footUpdate').textContent = d?.fetchedAtIL ? `עודכן לאחרונה: ${d.fetchedAtIL} (${ago}).` : '';
  b.hidden = true; b.className = 'banner';
  if (d?.demo) { b.hidden = false; b.textContent = 'נתוני הדגמה בלבד. התחזית האמיתית תופיע אחרי הרצת העדכון הראשון ב-GitHub Actions.'; }
  else if (mins != null && mins > 180) { b.hidden = false; b.className = 'banner err'; b.textContent = `הנתונים לא התעדכנו ${ago}. ייתכן שהשירות המטאורולוגי אינו זמין. מומלץ לבדוק באתר הרשמי.`; }
  else if (d && d.okCount < d.total) { b.hidden = false; b.textContent = `${d.total - d.okCount} מתוך ${d.total} ערוצים לא נטענו בעדכון האחרון; מוצג המידע האחרון שהתקבל.`; }
}

function fillSelect() {
  const sel = $('#citySel'); const fs = cityFeeds();
  sel.innerHTML = fs.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  sel.value = S.city;
}
function pickCity(id) {
  S.city = id; $('#citySel').value = id; try { localStorage.setItem('ims-city', id); } catch (e) { }
  renderHero(); renderWeek(); renderCities();
}

function renderAll() {
  const fs = cityFeeds();
  if (!S.city || !fs.some(f => f.id === S.city)) { let saved = null; try { saved = localStorage.getItem('ims-city'); } catch (e) { } S.city = fs.some(f => f.id === saved) ? saved : (fs.find(f => f.id === '402') || fs[0])?.id; }
  fillSelect(); renderMeta(); renderAlerts(); renderHero(); renderWeek(); renderCountry(); renderCities(); renderSea(); renderUV();
}

async function load(first) {
  try {
    const r = await fetch('data/weather.json?_=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (!first && S.data && d.fetchedAt === S.data.fetchedAt) { renderMeta(); return; }
    S.data = d; renderAll();
  } catch (e) {
    if (!S.data) { const b = $('#banner'); b.hidden = false; b.className = 'banner err'; b.textContent = 'לא ניתן לטעון את נתוני התחזית (data/weather.json).'; }
  }
}

function tick() {
  const d = new Date();
  $('#clock').textContent = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
  const day = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  let heb = ''; try { heb = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d); } catch (e) { }
  const t = day + (heb ? ' · ' + heb : ''); const el = $('#dateline'); if (el.textContent !== t) el.textContent = t;
}

addEventListener('DOMContentLoaded', () => {
  S.sky = new Sky($('#sky'));
  $('#citySel').addEventListener('change', e => pickCity(e.target.value));
  $('#cities').addEventListener('click', e => { const b = e.target.closest('.city'); if (b) { pickCity(b.dataset.id); scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' }); } });
  tick(); setInterval(tick, 1000);
  load(true);
  setInterval(() => { if (!document.hidden) load(false); }, 5 * 60 * 1000);
  setInterval(() => { if (S.data) { renderMeta(); renderHero(); } }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
});
