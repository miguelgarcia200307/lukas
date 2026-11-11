// Estados vacíos ilustrados
import { html, raw } from '../utils/dom.js';

const ILLUS = {
  cards: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <g style="animation:float 4s ease-in-out infinite"><rect x="26" y="30" width="78" height="50" rx="9" fill="#DCD8FE" transform="rotate(-10 65 55)"/>
    <rect x="30" y="34" width="78" height="50" rx="9" fill="#4B3BF5"/><rect x="40" y="46" width="14" height="10" rx="2.5" fill="#F6C66B"/>
    <rect x="40" y="68" width="34" height="5" rx="2.5" fill="#fff" opacity=".7"/><circle cx="92" cy="70" r="6" fill="#fff" opacity=".35"/><circle cx="98" cy="70" r="6" fill="#fff" opacity=".55"/></g></svg>`,
  list: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <g style="animation:float 4s ease-in-out infinite"><rect x="30" y="16" width="72" height="80" rx="12" fill="#fff" stroke="#E4E4DE" stroke-width="2"/>
    <circle cx="46" cy="36" r="7" fill="#FFE2D3"/><rect x="58" y="32" width="32" height="5" rx="2.5" fill="#D9D9D2"/>
    <circle cx="46" cy="56" r="7" fill="#DCD8FE"/><rect x="58" y="52" width="26" height="5" rx="2.5" fill="#D9D9D2"/>
    <circle cx="46" cy="76" r="7" fill="#D6F0E3"/><rect x="58" y="72" width="30" height="5" rx="2.5" fill="#D9D9D2"/></g></svg>`,
  bell: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <g style="animation:float 4s ease-in-out infinite;transform-origin:66px 20px"><path d="M44 66c0-26 8-40 22-40s22 14 22 40l6 10H38z" fill="#DCD8FE"/>
    <circle cx="66" cy="84" r="7" fill="#4B3BF5"/><circle cx="66" cy="24" r="4" fill="#4B3BF5"/></g></svg>`,
  chart: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <rect x="30" y="58" width="14" height="34" rx="4" fill="#DCD8FE"/><rect x="52" y="38" width="14" height="54" rx="4" fill="#4B3BF5"/>
    <rect x="74" y="66" width="14" height="26" rx="4" fill="#FFD7C8"/><rect x="96" y="48" width="14" height="44" rx="4" fill="#D6F0E3"/></svg>`,
  target: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <circle cx="66" cy="54" r="38" fill="#EEECFE"/><circle cx="66" cy="54" r="26" fill="#DCD8FE"/><circle cx="66" cy="54" r="13" fill="#4B3BF5"/>
    <path d="M66 54 98 22" stroke="#141413" stroke-width="3" stroke-linecap="round"/><path d="m92 18 8-2-2 8z" fill="#141413"/></svg>`,
  search: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <circle cx="60" cy="50" r="26" fill="#fff" stroke="#DCD8FE" stroke-width="8"/><path d="m80 70 18 18" stroke="#4B3BF5" stroke-width="9" stroke-linecap="round"/></svg>`,
  wallet: `<svg viewBox="0 0 132 112" class="illus" aria-hidden="true"><ellipse cx="66" cy="102" rx="44" ry="6" fill="#EAEAE4"/>
    <g style="animation:float 4s ease-in-out infinite"><rect x="28" y="30" width="76" height="58" rx="12" fill="#4B3BF5"/><rect x="28" y="30" width="76" height="16" rx="8" fill="#3A2BD9"/>
    <rect x="76" y="54" width="34" height="20" rx="8" fill="#DCD8FE"/><circle cx="88" cy="64" r="4" fill="#4B3BF5"/></g></svg>`,
};

/** emptyState({ illus, title, text, action: { label, attrs } }) */
export function emptyState({ illus = 'list', title, text = '', action = null }) {
  return html`<div class="empty fade-up">
    ${raw(ILLUS[illus] ?? ILLUS.list)}
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${action ? html`<button class="btn btn-primary btn-sm mt-2" ${raw(action.attrs ?? '')}>${action.label}</button>` : ''}
  </div>`;
}
