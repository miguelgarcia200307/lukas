// Chart.js cargado bajo demanda y estilizado con los tokens del diseño
import { moneyShort, money } from '../utils/format.js';

let chartPromise = null;

export function loadChart() {
  chartPromise ??= import('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm').then(({ Chart, registerables }) => {
    Chart.register(...registerables);
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    Chart.defaults.font.family = v('--font');
    Chart.defaults.font.size = 11;
    Chart.defaults.font.weight = '600';
    Chart.defaults.color = v('--ink-3');
    Chart.defaults.borderColor = 'rgba(20,20,19,0.06)';
    Chart.defaults.animation.duration = 900;
    Chart.defaults.animation.easing = 'easeOutQuart';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: 'rgba(20,20,19,0.94)',
      titleColor: '#fff',
      bodyColor: '#fff',
      padding: 10,
      cornerRadius: 12,
      displayColors: false,
      titleFont: { weight: '700', size: 12 },
      bodyFont: { weight: '600', size: 12 },
      callbacks: { label: (ctx) => money(ctx.parsed?.y ?? ctx.parsed) },
    });
    return Chart;
  });
  return chartPromise;
}

export const axisMoney = { callback: (v) => moneyShort(v).replace('$', '') };

export const theme = () => {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return { accent: v('--accent'), income: v('--income'), expense: v('--expense'), ink: v('--ink'), ink3: v('--ink-3'), line: v('--surface-3') };
};
