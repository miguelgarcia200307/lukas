// Renderizador de accesorios de Lukas. Los ítems viven DENTRO del grupo animado del cuerpo (nunca como capas HTML):
// heredan la respiración, el estiramiento y aplastamiento, los saltos y la mirada. Tres capas por slot:
//   atrás (detrás del cuerpo) → piel (recortada con la silueta exacta, debajo de la boca y los ojos) → adelante.
// Cada pieza va en el marco del cuerpo o de la cara, con un desplazamiento por slot (gafas siguen a los ojos, vello a la
// boca). Movimiento secundario propio (resortes, hélice, destellos…) solo con transform y opacity, y entradas/salidas.
// Lo usan: el motor SVG (attachEngine, todas las <lukas-orb>), el orbe del Inicio (hero-look.js) y las miniaturas (lookSvg).
import { SLOTS, isClassic } from './store.js';
import { BY_ID, colorOf, shades, describe } from './catalog.js';
import { clamp, spring as springCurve, eyePoints } from '../ui/face-geometry.js';
import { contourPath, eyePath, mouthPath, ORB_COLORS, REST_ALPHA, prefersReducedMotion } from '../ui/lukas-orb.js';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;
const r2 = (v) => Math.round(v * 100) / 100;
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};

/** Nivel de detalle por tamaño en px: mini (≤ 48), medio, grande (≥ 160). */
export const tierFor = (px) => (px <= 48 ? 'mini' : px >= 160 ? 'grande' : 'medio');
/** Caja del SVG cuando hay accesorios (lo más alto: sombrero de mago y globo; lo más ancho: capa y vueltiao). */
export const LOOK_BOX = { x: -12, size: 144 };

// Orden de dibujo por capa (de atrás hacia adelante)
const ORDER = {
  atras: ['extras', 'cuello', 'gafas', 'cabello', 'cabeza'],
  sombra: ['cuello', 'cabeza', 'cabello', 'gafas', 'extras'],
  piel: ['cara', 'vello', 'gafas'],
  adelante: ['gafas', 'cuello', 'cabello', 'cabeza', 'extras'],
};
const ENTRY = { cabeza: 'cae', cabello: 'cae', cuello: 'desliza' };
const ANCHOR = { cabeza: [60, 28], cabello: [60, 30], gafas: [60, 55], vello: [60, 70], cara: [60, 64], cuello: [60, 84], extras: [60, 50] };

// Variables de color → style (los atributos de presentación no resuelven var() en todos los navegadores)
function varsToStyle(markup) {
  return markup.replace(/<([a-zA-Z]+)((?:\s[^<>]*?)?)(\/?)>/g, (m, tag, attrs, close) => {
    let style = '';
    const rest = attrs.replace(/\s(fill|stroke|stop-color)="(var\([^"]+\))"/g, (_, k, v) => { style += `${k}:${v};`; return ''; });
    if (!style) return m;
    if (/\sstyle="/.test(rest)) return `<${tag}${rest.replace(/\sstyle="/, ` style="${style}`)}${close}>`;
    return `<${tag}${rest} style="${style}"${close}>`;
  });
}
const gradDefs = (id) => ['1', '2'].map((n) => `<radialGradient id="${id}f${n}" cx=".36" cy=".3" r=".92"><stop offset="0" style="stop-color:var(--acc-${n}-l)"/><stop offset=".55" style="stop-color:var(--acc-${n})"/><stop offset="1" style="stop-color:var(--acc-${n}-d)"/></radialGradient>`).join('');
const helpers = (id, mini, v) => ({
  id, mini, v,
  f1: `url(#${id}f1)`, f2: `url(#${id}f2)`,
  c1: 'var(--acc-1)', c1l: 'var(--acc-1-l)', c1d: 'var(--acc-1-d)', c2: 'var(--acc-2)', c2l: 'var(--acc-2-l)', c2d: 'var(--acc-2-d)',
});
function colorVars(cfg, item) {
  const a = shades(colorOf(cfg, item)), b = shades(item.color2);
  return { '--acc-1': a.base, '--acc-1-l': a.light, '--acc-1-d': a.dark, '--acc-2': b.base, '--acc-2-l': b.light, '--acc-2-d': b.dark };
}
const styleText = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** Qué se ve de una apariencia: variantes (cabello bajo el sombrero), slots ocultos y versión mini. */
export function plan(cfg, tier = 'medio') {
  const items = SLOTS.map((s) => BY_ID.get(cfg?.[s])).filter(Boolean);
  const out = [];
  for (const it of items) {
    if (tier === 'mini' && (!it.versionMini || it.slot === 'extras')) continue;
    const hiders = items.filter((o) => o !== it && o.ocultaSlots.includes(it.slot));
    let v = null;
    if (hiders.length) {
      if (!it.varianteCon || !hiders.every((o) => it.varianteCon[o.slot])) continue;
      v = it.varianteCon[hiders[0].slot];
    }
    out.push({ item: it, v, key: `${it.slot}:${it.id}:${v ?? ''}` });
  }
  return out;
}

/** Piezas por capa de un ítem: [{ capa, marco, markup }] */
function pieces(item, v, mini, idBase) {
  const out = [];
  const p = item.piezas;
  const skin = item.slot === 'vello' || item.slot === 'cara';
  const add = (capa, fn, key) => {
    if (!fn) return;
    const id = `${idBase}${key}`;
    const body = fn(helpers(id, mini, v));
    if (body) out.push({ capa, marco: item.marco, markup: varsToStyle(`<defs>${gradDefs(id)}</defs>${body}`) });
  };
  add('atras', p.atras, 'a');
  if (!mini) add('sombra', p.sombra, 's');
  add(skin ? 'piel' : 'adelante', p.adelante, 'f');
  add('piel', p.piel, 'p');
  return out;
}

// ── Capa animada ──────────────────────────────────────────
/**
 * adapter: {
 *   back, skin, front: <g> contenedores · svg: el <svg> (para <defs>) · clipId: silueta del cuerpo (clipPath)
 *   tier: 'mini' | 'medio' | 'grande' · frames(): { body, face } (transform del marco)
 *   offsets(): { eyeDy, mouthDx, mouthDy, talk } · energy(): 0.4…1.8 · bodyY(): altura de la coronilla (saltos)
 *   light(): [x, y] luz del cuerpo en unidades del personaje · blush(): 0…1 (tímido) · faceMask?: id de máscara
 * }
 */
export class LookLayer {
  constructor(adapter) {
    this.a = adapter;
    this.id = `lk${++uid}x`;
    this.items = new Map(); // slot → instancia
    this.exiting = [];
    this.cfg = {};
    this.t = Math.random() * 10;
    this.energy = 1;
    this.yPrev = null; this.vPrev = 0; this.drive = 0;
    this.build();
  }

  get mini() { return this.a.tier === 'mini'; }
  get busy() { return this.exiting.length > 0 || [...this.items.values()].some((i) => i.age < i.dur); }
  get empty() { return !this.items.size && !this.exiting.length; }

  build() {
    const { back, skin, front, svg } = this.a;
    const id = this.id;
    this.defs = el('defs', {}, svg);
    const pairs = (parent, layer) => Object.fromEntries(ORDER[layer].map((s) => [s, el('g', { 'data-slot': s }, parent)]));
    this.g = { atras: pairs(back, 'atras') };
    // Piel: recortada con la silueta; sombras de contacto, ítems y la luz/sombra del cuerpo reaplicada encima
    this.skinWrap = el('g', { 'clip-path': `url(#${this.a.clipId})` }, skin);
    if (this.a.faceMask) this.skinWrap.setAttribute('mask', `url(#${this.a.faceMask})`);
    this.g.sombra = pairs(el('g', {}, this.skinWrap), 'sombra');
    this.skinItems = el('g', { id: `${id}si` }, this.skinWrap);
    this.g.piel = pairs(this.skinItems, 'piel');
    // Rubor de "tímido": vive en la piel, en el marco de la cara
    this.blushG = el('g', { opacity: 0 }, this.skinItems);
    const bg = el('radialGradient', { id: `${id}bl` }, this.defs);
    el('stop', { offset: 0, 'stop-color': '#FF7EB6', 'stop-opacity': 0.8 }, bg);
    el('stop', { offset: 1, 'stop-color': '#FF7EB6', 'stop-opacity': 0 }, bg);
    el('ellipse', { cx: 41.4, cy: 66, rx: 7, ry: 4, fill: `url(#${id}bl)` }, this.blushG);
    el('ellipse', { cx: 78.6, cy: 66, rx: 7, ry: 4, fill: `url(#${id}bl)` }, this.blushG);
    if (!this.mini) {
      const lg = el('radialGradient', { id: `${id}lt`, gradientUnits: 'userSpaceOnUse', cx: 48, cy: 44, r: 54 }, this.defs);
      [[0, '#fff', 0.2], [0.4, '#fff', 0], [0.68, '#1B1250', 0], [1, '#1B1250', 0.42]].forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, lg));
      this.lightGrad = lg;
      const mask = el('mask', { id: `${id}lm`, maskUnits: 'userSpaceOnUse', x: -2000, y: -2000, width: 4000, height: 4000, style: 'mask-type:alpha' }, this.defs);
      el('use', { href: `#${id}si` }, mask);
      const relight = el('g', { mask: `url(#${id}lm)` }, this.skinWrap);
      this.relight = el('g', {}, relight);
      el('rect', { x: 10, y: 10, width: 100, height: 100, fill: `url(#${id}lt)` }, this.relight);
    }
    this.g.adelante = pairs(front, 'adelante');
  }

  /** Cambia la apariencia. animate: entra/sale con movimiento; quick: solo un fundido corto (comparar antes/después). */
  set(cfg, { animate = true, quick = false } = {}) {
    this.cfg = cfg ?? {};
    const want = plan(this.cfg, this.a.tier);
    const keys = new Map(want.map((w) => [w.item.slot, w]));
    for (const [slot, inst] of this.items) {
      const w = keys.get(slot);
      if (w && w.key === inst.key) { this.paint(inst); continue; }
      if (!animate && !quick) { for (const e of inst.els) e.outer.remove(); }
      else this.exit(inst, quick || (w && w.item.id === inst.item.id));
      this.items.delete(slot);
    }
    for (const w of want) {
      if (this.items.has(w.item.slot)) continue;
      const variantSwap = this.exiting.some((e) => e.item.id === w.item.id);
      this.items.set(w.item.slot, this.enter(w, animate && !variantSwap ? (quick ? 'fundido' : (ENTRY[w.item.slot] ?? 'escala')) : (variantSwap || quick ? 'fundido' : null)));
    }
    this.render(0);
  }

  enter({ item, v, key }, kind) {
    const els = [];
    for (const p of pieces(item, v, this.mini, `${this.id}${item.slot}${++uid}`)) {
      const outer = el('g', { 'data-item': item.id }, this.g[p.capa][item.slot] ?? this.g[p.capa][ORDER[p.capa][0]]);
      const inner = el('g', {}, outer);
      inner.innerHTML = p.markup;
      els.push({ outer, inner, marco: p.marco, capa: p.capa });
    }
    const nodes = [];
    if (!this.mini) {
      for (const e of els) for (const n of e.inner.querySelectorAll('[data-a]')) {
        const [ox, oy] = (n.getAttribute('data-o') ?? '60 60').split(/[\s,]+/).map(Number);
        nodes.push({ el: n, type: n.getAttribute('data-a'), ox, oy, p: +(n.getAttribute('data-p') ?? 0) + Math.random() * 0.3, x: 0, v: 0, ph: Math.random() * 6 });
      }
    }
    const rm = prefersReducedMotion();
    const inst = { item, v, key, els, nodes, kind: kind && rm ? 'fundido' : kind, age: kind ? 0 : 99, dur: kind === 'fundido' || rm ? 0.2 : kind ? 0.75 : 0 };
    this.paint(inst);
    this.place(inst, kind ? 0 : 1);
    return inst;
  }

  exit(inst, quick) {
    inst.exitAge = 0;
    inst.exitDur = quick || prefersReducedMotion() ? 0.16 : 0.24;
    inst.exitQuick = quick || prefersReducedMotion();
    this.exiting.push(inst);
  }

  paint(inst) {
    const vars = colorVars(this.cfg, inst.item);
    for (const e of inst.els) for (const k in vars) e.outer.style.setProperty(k, vars[k]);
  }

  /** Empujón para los resortes (salto, toque, aterrizaje). */
  kick(s = 1) { for (const i of this.items.values()) for (const n of i.nodes) n.v += s * (n.type === 'rebote' ? -40 : 60 * (n.p % 2 ? -1 : 1)); }

  /** Un frame: marcos, desplazamientos por slot, entradas/salidas y movimiento secundario. */
  render(dt) {
    dt = Math.min(0.05, Math.max(0, dt || 0));
    this.t += dt;
    const a = this.a;
    const fr = a.frames();
    const off = a.offsets();
    const rm = prefersReducedMotion();
    const eT = clamp(a.energy?.() ?? 1, 0.3, 2);
    this.energy += (eT - this.energy) * Math.min(1, dt * 3);
    // Aceleración vertical de la coronilla → los resortes la sienten (el cabello rebota con el salto)
    const y = a.bodyY?.() ?? 0;
    if (dt > 0) {
      const vel = this.yPrev == null ? 0 : (y - this.yPrev) / dt;
      this.drive = clamp((vel - this.vPrev) / dt, -4000, 4000);
      this.vPrev = vel;
    }
    this.yPrev = y;
    const slotT = {
      gafas: `translate(0 ${r2(off.eyeDy)})`,
      vello: `translate(${r2(off.mouthDx * 0.7)} ${r2(off.mouthDy * 0.6 + off.talk * 1.1)})`,
      cara: '',
    };
    const frameOf = (inst, e) => `${e.marco === 'cara' ? fr.face : fr.body} ${slotT[inst.item.slot] ?? ''}`;
    for (const inst of this.items.values()) {
      if (inst.age < inst.dur) inst.age += dt;
      for (const e of inst.els) e.outer.setAttribute('transform', frameOf(inst, e));
      this.place(inst, inst.dur ? clamp(inst.age / inst.dur) : 1);
      if (inst.nodes.length) this.animateNodes(inst, dt, rm);
      // El vello acompaña a la boca: la barba baja un poco al hablar
      if (inst.item.slot === 'vello' && inst.age >= inst.dur) {
        const tr = off.talk > 0.01 && !rm ? `translate(60 64) scale(1 ${r2(1 + off.talk * 0.04)}) translate(-60 -64)` : '';
        for (const e of inst.els) e.inner.setAttribute('transform', tr);
      }
    }
    for (let i = this.exiting.length - 1; i >= 0; i--) {
      const inst = this.exiting[i];
      inst.exitAge += dt;
      const p = clamp(inst.exitAge / inst.exitDur);
      for (const e of inst.els) {
        e.outer.setAttribute('transform', frameOf(inst, e));
        const [ax, ay] = ANCHOR[inst.item.slot];
        const s = inst.exitQuick ? 1 : 1 - 0.18 * p;
        e.inner.setAttribute('opacity', r2(1 - p));
        e.inner.setAttribute('transform', s === 1 ? '' : `translate(${ax} ${ay}) scale(${r2(s)}) translate(${-ax} ${-ay})`);
      }
      if (p >= 1) { for (const e of inst.els) e.outer.remove(); this.exiting.splice(i, 1); }
    }
    // Luz del cuerpo reaplicada sobre la piel, rubor de tímido
    if (this.relight) {
      this.relight.setAttribute('transform', fr.body);
      const [lx, ly] = a.light?.() ?? [48, 44];
      this.lightGrad.setAttribute('cx', r2(lx));
      this.lightGrad.setAttribute('cy', r2(ly));
      this.relight.parentNode.style.display = this.hasSkin() ? '' : 'none';
    }
    const b = clamp(a.blush?.() ?? 0);
    this.blushG.setAttribute('opacity', r2(b));
    if (b > 0.003) this.blushG.setAttribute('transform', fr.face);
  }

  hasSkin() {
    for (const i of this.items.values()) if (i.els.some((e) => e.capa === 'piel')) return true;
    return this.exiting.some((i) => i.els.some((e) => e.capa === 'piel'));
  }

  /** Entrada del ítem (cae y rebota, escala elástica, se desliza o fundido). */
  place(inst, p) {
    const [ax, ay] = ANCHOR[inst.item.slot];
    let tr = '', op = 1;
    if (p < 1) {
      const s = springCurve(p * 1.35);
      switch (inst.kind) {
        case 'cae': tr = `translate(0 ${r2(-22 * (1 - s))})`; op = clamp(p / 0.18); break;
        case 'desliza': tr = `translate(0 ${r2(14 * (1 - s))})`; op = clamp(p / 0.25); break;
        case 'escala': tr = `translate(${ax} ${ay}) scale(${r2(Math.max(0.01, s))}) translate(${-ax} ${-ay})`; op = clamp(p / 0.15); break;
        default: op = p;
      }
    }
    for (const e of inst.els) {
      if (inst.item.slot === 'vello' && p >= 1) continue; // la transformación del habla la pone render()
      e.inner.setAttribute('transform', tr);
      if (op < 0.999) e.inner.setAttribute('opacity', r2(op)); else e.inner.removeAttribute('opacity');
    }
  }

  animateNodes(inst, dt, rm) {
    const e = this.energy, t = this.t;
    for (const n of inst.nodes) {
      const { ox, oy } = n;
      let tr = '', op = null;
      if (rm) {
        if (n.type === 'destello') tr = 'translate(-60 0)';
        n.el.setAttribute('transform', tr);
        continue;
      }
      switch (n.type) {
        case 'resorte': case 'mecer': {
          // Resorte subamortiguado hacia un vaivén suave (más vivo con energía, tranquilo al escuchar)
          const target = (n.type === 'mecer' ? 2.6 : 3.2) * e * Math.sin(t * (1.5 + 0.4 * e) + n.p + n.ph);
          const acc = -95 * (n.x - target) - 7.5 * n.v + this.drive * 1.2 * (n.p % 2 ? -1 : 1);
          n.v += acc * dt; n.x += n.v * dt;
          n.x = clamp(n.x, -24, 24);
          tr = `rotate(${r2(n.x)} ${ox} ${oy})`;
          break;
        }
        case 'rebote': {
          const acc = -150 * n.x - 9 * n.v + this.drive * 0.25;
          n.v += acc * dt; n.x += n.v * dt;
          n.x = clamp(n.x, -5, 5);
          tr = `translate(${ox} ${oy}) scale(1 ${r2(1 - n.x * 0.012)}) translate(${-ox} ${r2(-oy + n.x)})`;
          break;
        }
        case 'helice': {
          n.x += dt * (7 + 7 * e);
          let c = Math.cos(n.x);
          if (Math.abs(c) < 0.06) c = c < 0 ? -0.06 : 0.06;
          tr = `translate(${ox} ${oy}) scale(${r2(c)} 1) translate(${-ox} ${-oy})`;
          break;
        }
        case 'ondear': {
          const sk = 3.2 * e * Math.sin(t * 2.2 + n.ph), sy = 1 + 0.03 * Math.sin(t * 2.9 + n.ph);
          tr = `translate(${ox} ${oy}) skewX(${r2(sk)}) scale(1 ${r2(sy)}) translate(${-ox} ${-oy})`;
          break;
        }
        case 'destello': {
          const per = 4.6, u = ((t + n.ph * 2) % per) / 0.75;
          const x = u < 1 ? -32 + 64 * (u * u * (3 - 2 * u)) : -60;
          tr = `translate(${r2(x)} 0)`;
          break;
        }
        case 'brillitos': {
          const k = 0.5 + 0.5 * Math.sin(t * (2.6 + e) + n.p * 2.1);
          const s = 0.45 + 0.6 * k;
          tr = `translate(${ox} ${oy}) scale(${r2(s)}) translate(${-ox} ${-oy})`;
          op = r2(0.25 + 0.75 * k);
          break;
        }
        case 'aletear': {
          const s = 0.28 + 0.72 * Math.abs(Math.cos(t * (5 + 3 * e) + n.ph));
          tr = `translate(${ox} ${oy}) scale(${r2(s)} 1) translate(${-ox} ${-oy})`;
          break;
        }
        case 'flotar': {
          tr = `rotate(${r2(4 * e * Math.sin(t * 1.3 + n.ph))} ${ox} ${oy}) translate(0 ${r2(1.2 * Math.sin(t * 1.7 + n.ph))})`;
          break;
        }
        case 'levitar': tr = `translate(0 ${r2(1.8 * Math.sin(t * 1.8 + n.ph))})`; break;
        default: break;
      }
      n.el.setAttribute('transform', tr);
      if (op != null) n.el.setAttribute('opacity', op);
    }
  }

  destroy() {
    for (const i of this.items.values()) for (const e of i.els) e.outer.remove();
    for (const i of this.exiting) for (const e of i.els) e.outer.remove();
    this.items.clear();
    this.exiting = [];
    this.defs.remove();
    this.skinWrap.remove();
    for (const k of ['atras', 'adelante']) for (const g of Object.values(this.g[k])) g.remove();
  }
}

// ── Adaptador del motor SVG (<lukas-orb>) ─────────────────
const lerp = (a, b, t) => a + (b - a) * t;
/** Monta la capa dentro del grupo animado del personaje (squash) y devuelve un controlador. */
export function attachEngine(engine) {
  const n = engine.n;
  const id = `lkb${++uid}`;
  n.body.setAttribute('id', `${id}body`);
  const defs = n.svg.querySelector('defs');
  const clip = el('clipPath', { id: `${id}clip` }, defs);
  el('use', { href: `#${id}body` }, clip);
  const back = el('g', {}, null), skin = el('g', {}, null), front = el('g', {}, null);
  n.squash.insertBefore(back, n.body);
  n.squash.insertBefore(skin, n.face);
  n.squash.appendChild(front);
  const tier = engine.size <= 48 || engine.simple ? 'mini' : tierFor(engine.size);
  const layer = new LookLayer({
    back, skin, front, svg: n.svg, clipId: `${id}clip`, tier,
    frames: () => {
      const v = engine.v;
      const S = Math.max(0.0001, v.sc * (1 + v.br));
      const F = (1 + v.br * 0.7) * Math.min(1, S);
      return { body: `translate(60 60) scale(${r2(S * 1000) / 1000}) translate(-60 -60)`, face: `translate(60 60) scale(${Math.round(F * 1000) / 1000}) translate(-60 -60)` };
    },
    offsets: () => {
      const v = engine.v, simp = clamp(v.simp);
      return { eyeDy: -2.5 * simp, mouthDx: clamp(v.mx - 60, -2, 2), mouthDy: clamp(v.my - 71, -2.5, 3.5) + 3 * simp, talk: clamp(v.mo ?? 0) };
    },
    energy: () => engine.energy ?? 1,
    bodyY: () => engine.v.jy + 66 * (engine.v.q - 0.1 * engine.v.pull),
    light: () => [60 + 11.9 * Math.cos(engine.v.al), 60 + 11.9 * Math.sin(engine.v.al)],
    blush: () => engine.blushAmount ?? 0,
  });
  let boxed = false;
  const setBox = (on) => {
    if (on === boxed) return;
    boxed = on;
    const vbSize = on ? LOOK_BOX.size : (engine.simple ? 76 : 120);
    const vb0 = on ? LOOK_BOX.x : 60 - vbSize / 2;
    const k = vbSize / 66;
    const offp = `${r2(((1 - k) / 2) * 100)}%`;
    n.svg.setAttribute('viewBox', `${vb0} ${vb0} ${vbSize} ${vbSize}`);
    Object.assign(n.svg.style, { left: offp, top: offp, width: `${r2(k * 100)}%`, height: `${r2(k * 100)}%` });
  };
  let last = null;
  return {
    layer,
    get busy() { return layer.busy || (engine.blushAmount ?? 0) > 0.003; },
    set(cfg, opts) {
      last = cfg;
      if (!isClassic(cfg)) setBox(true);
      layer.set(cfg, opts);
      n.svg.setAttribute('aria-label', describe(cfg));
    },
    kick: (s) => layer.kick(s),
    render(dt) {
      layer.render(dt);
      if (boxed && layer.empty && isClassic(last)) setBox(false);
    },
    destroy() { layer.destroy(); back.remove(); skin.remove(); front.remove(); clip.remove(); setBox(false); },
  };
}

// ── SVG estático (miniaturas del editor y barra compacta del Inicio) ──
/**
 * Lukas en reposo con la apariencia dada, como string. Sin animación (solo la miniatura seleccionada se anima con CSS).
 * { tier: 'mini' | 'medio', viewBox, simple: cara simplificada (como el ícono de 24 px) }
 */
export function lookSvg(cfg, { tier = 'medio', viewBox = `${LOOK_BOX.x} ${LOOK_BOX.x} ${LOOK_BOX.size} ${LOOK_BOX.size}`, simple = false, label = '' } = {}) {
  const id = `ls${++uid}`;
  const simp = simple ? 1 : 0;
  const ca = Math.cos(REST_ALPHA), sa = Math.sin(REST_ALPHA);
  const gx = r2(0.5 + 0.18 * ca), gy = r2(0.5 + 0.18 * sa);
  const body = contourPath(1);
  const ey = lerp(55, 52.5, simp), ew = lerp(6, 8, simp), eh = lerp(12, 13, simp);
  const mw = 9 * lerp(1, 12 / 9, simp), my = 71 + 3 * simp;
  const by = { atras: '', sombra: '', piel: '', adelante: '' };
  for (const { item, v } of plan(cfg, tier)) {
    const vars = styleText(colorVars(cfg, item));
    for (const p of pieces(item, v, tier === 'mini', `${id}${item.slot}`)) {
      const shift = item.slot === 'gafas' ? ` translate(0 ${r2(-2.5 * simp)})` : item.slot === 'vello' ? ` translate(0 ${r2(1.8 * simp)})` : '';
      // Estático: el destello de las gafas queda fuera del lente (solo se ve animado)
      const markup = p.markup.replace(/data-a="destello"/g, 'data-a="destello" transform="translate(-60 0)"');
      by[p.capa] += `<g data-capa="${p.capa}" data-slot="${item.slot}" style="${vars}"${shift ? ` transform="${shift.trim()}"` : ''}>${markup}</g>`;
    }
  }
  return `<svg xmlns="${NS}" viewBox="${viewBox}" role="img" aria-label="${label || describe(cfg)}" focusable="false"><defs>
    <radialGradient id="${id}b" r="0.78" cx="${gx}" cy="${gy}" fx="${gx}" fy="${gy}"><stop offset="0" stop-color="${ORB_COLORS.light}"/><stop offset="0.5" stop-color="${ORB_COLORS.mid}"/><stop offset="1" stop-color="${ORB_COLORS.deep}"/></radialGradient>
    <clipPath id="${id}c"><path d="${body}"/></clipPath></defs>
    ${by.atras}<path d="${body}" fill="url(#${id}b)"/>${simple ? '' : `<ellipse cx="${r2(60 + 25 * ca)}" cy="${r2(60 + 25 * sa)}" rx="7" ry="4" fill="#fff" opacity="0.28" transform="rotate(${r2((REST_ALPHA * 180) / Math.PI + 90)} ${r2(60 + 25 * ca)} ${r2(60 + 25 * sa)})"/>`}
    <g clip-path="url(#${id}c)">${by.sombra}${by.piel}</g>
    <g fill="none" stroke-linecap="round"><path d="${eyePath(50.5, ey, { h: eh })}" stroke="#fff" stroke-width="${ew}"/><path d="${eyePath(69.5, ey, { h: eh })}" stroke="#fff" stroke-width="${ew}"/>
    <path d="${mouthPath(60, my, 0, 0)}" stroke="${ORB_COLORS.lime}" stroke-width="${r2(mw)}"/></g>${by.adelante}</svg>`;
}

/** Puntos de un ojo del orbe de voz (para la máscara de la piel en el Inicio). */
export const eyeShape = (out, h, open, happy, tired, closed) => eyePoints(out, h, open, 1, happy, tired, closed);
