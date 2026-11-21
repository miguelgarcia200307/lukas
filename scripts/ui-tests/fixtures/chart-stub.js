// Chart.js falso para pruebas de navegador (se inyecta con un import map): guarda cada gráfica en window.__charts.
export class Chart {
  static defaults = { font: {}, animation: {}, plugins: { legend: {}, tooltip: {} } };
  static register() {}
  constructor(canvas, config) { this.canvas = canvas; this.config = config; (window.__charts ??= []).push(this); }
  destroy() { this.destroyed = true; }
}
export const registerables = [];
