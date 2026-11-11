// Logo de Lukas: una "L" cuyo pie sostiene tres barras de voz (una onda de audio)
export function logoSvg({ size = 64, animated = false, tile = true } = {}) {
  return `<svg class="logo-tile ${animated ? 'animated' : ''}" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="Lukas">
    <defs><linearGradient id="lk-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6C5DFF"/><stop offset="1" stop-color="#3A2BD9"/></linearGradient></defs>
    ${tile ? '<rect width="512" height="512" rx="128" fill="url(#lk-g)"/>' : ''}
    <path class="stroke" d="M150 128V380H369" fill="none" stroke="#fff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/>
    <line class="bar-a" x1="233" y1="300" x2="233" y2="252" stroke="#fff" stroke-width="40" stroke-linecap="round" opacity=".92"/>
    <line class="bar-b" x1="301" y1="300" x2="301" y2="180" stroke="#fff" stroke-width="40" stroke-linecap="round"/>
    <line class="bar-c" x1="369" y1="300" x2="369" y2="236" stroke="#fff" stroke-width="40" stroke-linecap="round" opacity=".92"/>
  </svg>`;
}
