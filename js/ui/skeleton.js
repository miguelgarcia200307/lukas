// Skeletons con la forma real del contenido (nunca spinners genéricos)
import { html } from '../utils/dom.js';

const skRow = () => html`<div class="list-row">
  <div class="sk" style="width:40px;height:40px;border-radius:13px"></div>
  <div class="grow stack gap-2"><div class="sk sk-line" style="width:${50 + Math.round(Math.random() * 30)}%"></div><div class="sk sk-line" style="width:30%;height:10px"></div></div>
  <div class="sk sk-line" style="width:64px"></div>
</div>`;

export const skRows = (n = 5) => html`<div class="list">${Array.from({ length: n }, skRow)}</div>`;

export const skHome = () => html`<div class="home-sk">
  <div class="sk sk-line" style="width:40%;height:14px;margin-top:8px"></div>
  <div class="sk" style="width:85%;height:40px;margin-top:14px;border-radius:12px"></div>
  <div class="sk sk-circle" style="width:168px;height:168px;margin:36px auto 0"></div>
  <div class="row gap-2" style="margin-top:28px">${[1, 2, 3].map(() => html`<div class="sk" style="flex:1;height:36px;border-radius:999px"></div>`)}</div>
  <div class="row gap-3" style="margin-top:32px">${[1, 2].map(() => html`<div class="sk" style="flex:1;height:96px;border-radius:20px"></div>`)}</div>
  <div style="margin-top:28px">${skRows(3)}</div>
</div>`;

export const skCards = () => html`<div class="stack gap-4">${[1, 2].map(() => html`<div class="sk" style="aspect-ratio:1.586;border-radius:22px"></div>`)}</div>`;

export const skReport = () => html`<div class="stack gap-4">
  <div class="row gap-3">${[1, 2].map(() => html`<div class="sk" style="flex:1;height:92px;border-radius:20px"></div>`)}</div>
  <div class="sk" style="height:240px;border-radius:20px"></div>
  <div class="sk" style="height:280px;border-radius:20px"></div>
</div>`;
