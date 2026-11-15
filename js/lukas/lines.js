// Lo que dice Lukas en el editor: cientos de frases por accesorio, color, combinación, look, hora del día y situación
// (indecisión, cosquillas seguidas, volver a ponerse algo, muchos accesorios, cambios sin guardar…), con memoria para
// no repetirse. Sin DOM: devuelve { text, react, then, burst, spin } y la vista lo actúa. Corre también en Node.
import { BY_ID, PALETTE, LOOKS } from './catalog.js';
import { SLOTS } from './store.js';

// ── Frases por accesorio (r: reacción principal, then: segunda reacción, burst: emojis que salen de Lukas) ──
// Variables: {it} nombre en minúscula · {el} artículo + nombre · {lo} pronombre · {este} demostrativo · {name} usuario
export const ITEM_LINES = {
  // Cabello
  copete: { burst: '💨', lines: ['Este copete tiene vida propia', 'Copete arriba, autoestima arriba', '¿Viste el volumen? Puro estilo', 'Me peiné con gel y con ganas', 'El viento no despeina este copete'] },
  afro: { r: 'feliz', burst: '🌀', lines: ['¡Estos rizos tienen flow!', 'Mis rizos, mis reglas', 'Con este afro no quepo por la puerta', 'Volumen nivel experto', 'Rizos afro: orgullo total'] },
  mohicana: { r: 'presume', burst: '⚡', lines: ['Modo rebelde: activado', 'Cresta lista para el concierto', 'Ahora sí doy miedo… un poquito', 'Punk, pero con presupuesto', 'Rebelde con causa: ahorrar'] },
  flequillo: { r: 'pose2', lines: ['Flequillo de lado, mirada misteriosa', '¿Me tapa un ojo? Es parte del misterio', 'Look de portada de revista', 'Me lo acomodo cada cinco segundos'] },
  mono: { lines: ['Moño alto: concentración total', 'Con el moño hago cuentas más rápido', 'Modo productivo: ON', 'Moño arriba, gastos abajo'] },
  despeinado: { r: 'pose2', then: 'cosquillas', burst: '💤', lines: ['Recién levantado… y así salgo', 'Ni me peiné y quedé bien', 'Cinco minutos más, porfa 😴', 'Despeinado pero con las cuentas al día', 'La almohada me peinó'] },
  tupe: { r: 'presume', burst: '🎸', lines: ['Tupé rockero, ¡ye-ye!', 'Me falta la guitarra y listo 🎸', 'Este tupé lleva tres kilos de gel', 'Elvis estaría orgulloso'] },
  punk: { r: 'presume', burst: '⚡', lines: ['¡Puntas punk! Anarquía con orden financiero', 'Pinchudo pero cariñoso', 'Cuidado, que pincho 😝', 'Punk de corazón, ahorrador de profesión'] },
  coletas: { r: 'feliz', then: 'pose3', burst: '🎀', lines: ['¡Coletas! Me siento de vacaciones', 'Dos colitas, el doble de alegría', 'Estas coletas rebotan solas', '¡Boing, boing!'] },
  raya: { r: 'ajuste', lines: ['Raya al lado: listo para la reunión', 'Peinado de gerente de banco', 'Serio, pero con chispa', 'Ni un pelo fuera de lugar'] },
  // Cabeza
  gorra: { lines: ['Gorra puesta, actitud lista', 'Con gorra me da menos sol ☀️', 'Look de domingo de partido ⚽', 'Visera al frente, metas al frente'] },
  'gorra-reves': { r: 'pose1', lines: ['Gorra al revés: modo relajado', 'Así la usan los que saben', 'Yo, versión skater 🛹', 'Relajado, pero con las cuentas claras'] },
  helice: { r: 'arriba', then: 'pose3', burst: '🌀', lines: ['¡Esta hélice me hace volar! 🚁', 'Si sopla viento, despego', 'Ingeniería aeronáutica de alto nivel', 'Gira, gira… como la plata en el mes'] },
  vueltiao: { r: 'presume', burst: '🇨🇴', lines: ['¡Ajá, compadre! Sombrero vueltiao', 'Esto sí es patrimonio, ve', 'Puro orgullo costeño', 'Me provoca un vallenato ya mismo 🪗', '¡Qué calor tan sabroso!'] },
  vaquero: { r: 'presume', burst: '🤠', lines: ['¡Yija! Este pueblo es pequeño pa’ los dos', 'Arreando gastos como ganado', 'Sheriff de tus finanzas, a la orden', 'Ningún gasto hormiga se me escapa, forastero'] },
  copa: { r: 'presume', burst: '🎩', lines: ['Elegancia de gala, mi estimado', 'Con sombrero de copa todo se ve más caro', '¿Me abre la puerta, por favor?', 'Hoy cenamos fino (pero con presupuesto)'] },
  boina: { burst: '🎨', lines: ['Boina puesta: me siento artista', '¿Pinto un cuadro o una hoja de cálculo?', 'Bonjour, mon ami', 'Con boina hasta las cuentas son arte'] },
  lana: { r: 'feliz', burst: '❄️', lines: ['Calientico, como chocolate con queso ☕', 'Ideal para el frío bogotano', 'Gorro de lana y cobija: plan perfecto', 'El pompón es lo mejor, ¿cierto?'] },
  pescador: { burst: '🎣', lines: ['Listo pa’ pescar ofertas', 'Sombrero de pescador: vibra de río', 'Hoy pescamos ahorros 🐟', 'Paciencia de pescador para ahorrar'] },
  casco: { r: 'ajuste', burst: '🧱', lines: ['Seguridad ante todo 👷', 'Construyendo tu ahorro, ladrillo a ladrillo', 'Obra en progreso: tus finanzas', 'Con casco ni los gastos hormiga me tumban'] },
  corona: { r: 'presume', then: 'pose3', burst: '👑✨', spin: true, lines: ['¡Rey de las finanzas! 👑', 'Pueden llamarme Su Majestad', 'La corona me queda, ¿cierto?', 'Reinando sobre el presupuesto', 'Súbditos: ¡a ahorrar!'] },
  fiesta: { r: 'cosquillas', then: 'pose3', burst: '🎉🎊', lines: ['¡Que empiece la fiesta! 🎉', '¿Dónde está la torta?', 'Fiesta sí, pero con presupuesto', '¡Hoy se celebra!', '¿Quién trajo la música?'] },
  chef: { r: 'feliz', burst: '🍳', lines: ['Chef Lukas en la casa 👨‍🍳', 'Hoy cocinamos en casa y ahorramos', 'Receta del día: cero domicilios', '¡Oui, chef!', 'Un ajiaco y unos ahorros, por favor'] },
  mago: { r: 'arriba', then: 'presume', burst: '✨🪄', spin: true, lines: ['¡Abracadabra! Que aparezca plata 🪄', 'Con magia… y disciplina', 'Mi mejor truco: ahorrar', 'Hago desaparecer los gastos hormiga'] },
  gato: { r: 'timido', then: 'feliz', burst: '🐾', lines: ['Miau 🐱', 'Siete vidas y un presupuesto', 'Soy un gatito muy financiero', 'Ronroneo cuando ahorras'] },
  antenas: { r: 'arriba', burst: '🐝', lines: ['¡Bzz! Captando ahorros', 'Mis antenas detectan gastos hormiga', 'Señal al máximo 📶', 'Bzz, bzz… trabajador como abejita'] },
  navideno: { r: 'feliz', then: 'pose3', burst: '❄️🎄', lines: ['¡Jo, jo, jo! 🎅', 'Ya huele a natilla y buñuelos', 'La prima navideña: ¡a cuidarla!', '¿Quién quiere novena?'] },
  pirata: { r: 'presume', burst: '🏴‍☠️', lines: ['¡Arrr! Buscando el tesoro', 'El tesoro es tu ahorro, grumete', '¡Al abordaje de las metas!', 'Pirata, pero pago todo legal'] },
  aureola: { r: 'feliz', then: 'timido', burst: '✨', lines: ['Me siento angelical 😇', 'Nunca gasto de más… casi nunca', 'Un santo de las finanzas', '¿Inocente yo? Siempre'] },
  // Gafas
  redondas: { r: 'ajuste', lines: ['Veo tus finanzas con claridad 👓', 'Gafas redondas: modo intelectual', 'Ahora leo hasta la letra pequeña', 'Muy de poeta, ¿no?'] },
  cuadradas: { r: 'ajuste', lines: ['Nerd y orgulloso 🤓', 'Calculando intereses compuestos…', 'Estas gafas suben el IQ', 'Ahora sí entiendo los extractos'] },
  aviador: { r: 'presume', burst: '😎', lines: ['Piloto listo para despegar', 'Demasiado cool para este mundo', 'Con estas gafas el sol me pide permiso', 'Torre de control, aquí Lukas ✈️'] },
  corazon: { r: 'timido', then: 'feliz', burst: '💖💕', lines: ['Todo lo veo con amor 💖', 'Enamorado de tus ahorros', 'Ay, qué romántico me puse', 'Veo corazones por todas partes'] },
  estrella: { r: 'presume', then: 'pose3', burst: '⭐✨', lines: ['¡Soy una estrella! ⭐', 'Brillo propio, cero filtros', 'Firmo autógrafos después', 'Estrella de la pasarela'] },
  tresd: { r: 'arriba', burst: '🍿', lines: ['¡Todo se ve en 3D! 🎬', 'Tus ahorros saltan de la pantalla', '¿Alguien trajo crispetas?', 'Efectos especiales incluidos'] },
  monoculo: { r: 'ajuste', lines: ['Mmm, interesante… 🧐', 'Muy distinguido, ¿no cree?', 'Analizando con lupa elegante', 'Permítame revisar ese extracto'] },
  pixel: { r: 'presume', burst: '😎', lines: ['Deal with it 😎', 'Modo 8 bits activado 👾', 'Pixelado pero en alta definición de estilo', 'Nivel desbloqueado: estilo'] },
  esqui: { r: 'pose1', burst: '❄️', lines: ['¡A la nieve! ⛷️', 'Bajando gastos en picada', 'Listo para la avalancha de estilo', 'Brr, ¿dónde es la pista?'] },
  nariz: { r: 'cosquillas', burst: '🥸', lines: ['No me reconoces, ¿cierto? 🥸', 'Disfraz perfecto: soy otro Lukas', 'Agente encubierto de las finanzas', 'Shh, estoy de incógnito'] },
  // Vello
  bigote: { r: 'ajuste', lines: ['Bigote clásico: caballero total', 'Ahora sí parezco señor serio', 'Me lo peino con cuidado', 'Con bigote todo suena más convincente'] },
  manubrio: { r: 'presume', lines: ['Bigote de manubrio, ¡qué distinción!', 'Lo enrosco cuando pienso', 'Estilo de barbería antigua 💈', 'Un bigote con historia'] },
  lapiz: { r: 'pose1', lines: ['Bigote lápiz: galán de telenovela', 'Fino, como las cuentas claras', 'Seductor y ahorrador', 'Mírame a los ojos… y al bigote'] },
  barba: { r: 'ajuste', lines: ['Barba completa, sabiduría completa', 'Ahora sí doy consejos financieros', 'Me siento más sabio', 'Barba de profesor universitario'] },
  lenador: { r: 'presume', burst: '🪓', lines: ['¡A cortar gastos como leña!', 'Leñador de presupuestos', 'Fuerte como un roble 🌲', 'Barba de montaña, corazón de ahorro'] },
  candado: { r: 'ajuste', burst: '🔒', lines: ['Candado: tus ahorros, bajo llave', 'Estilo con seguridad incluida', 'Cerrado a los gastos innecesarios', 'Clic: barba asegurada'] },
  chivera: { r: 'pose2', lines: ['Chivera de filósofo', 'Pienso, luego ahorro', 'Me la acaricio cuando calculo', 'Muy de pensador, ¿no?'] },
  'tres-dias': { r: 'pose1', lines: ['Barba de tres días, pero cuentas al día', 'Desarreglado con intención', 'Look rudo pero amable', 'No me afeité… a propósito'] },
  // Cuello
  bufanda: { r: 'feliz', burst: '❄️', lines: ['Bufanda calientica 🧣', 'Abrigadito y feliz', 'Perfecta para el frío de la mañana', 'Huele a suavizante'] },
  corbatin: { r: 'ajuste', lines: ['Corbatín: elegancia en miniatura', 'Listo para la gala', 'Pequeño pero poderoso, como el ahorro diario', 'Muy de matrimonio, ¿no?'] },
  corbata: { r: 'ajuste', lines: ['Corbata puesta: hora de negocios 👔', '¿Reunión con el banco? Listo', 'Ejecutivo de tus finanzas', 'Ahora sí me dan el crédito'] },
  panoleta: { lines: ['Pañoleta al cuello, ¡qué pinta!', 'Listo pa’ la feria', 'Estilo de campo, corazón de ciudad', 'Muy de finca, me encanta'] },
  hawaiano: { r: 'cosquillas', then: 'pose3', burst: '🌺🌴', lines: ['¡Aloha! 🌺', 'Mentalidad de vacaciones (con presupuesto)', 'Me siento en la playa', '¿Alguien dijo coco loco?'] },
  cadena: { r: 'presume', burst: '✨', lines: ['Cadena dorada, puro brillo', 'Bling bling financiero', 'Oro… pero de ahorro', 'Pesadita, pero vale la pena'] },
  medalla: { r: 'presume', then: 'pose3', burst: '🏅', lines: ['¡Medalla de oro en ahorro!', 'Campeón de las finanzas', 'Me la gané por registrar todo', 'Al podio, ¡por favor!'] },
  ruana: { r: 'feliz', burst: '☕', lines: ['Ruana boyacense: calorcito puro', 'Con ruana y tinto, perfecto ☕', 'Abrigado como en el páramo', 'Sumercé, qué elegancia'] },
  capa: { r: 'presume', then: 'pose3', burst: '💥', spin: true, lines: ['¡Al rescate de tus finanzas! 🦸', 'Súper Lukas ha llegado', 'Mi superpoder: ahorrar', 'La capa ondea sola, ¿viste?'] },
  // Detalles de la cara
  rubor: { r: 'timido', lines: ['Ay, me sonrojé ☺️', 'Me da pena, pero me gusta', 'Cachetes rosaditos', 'No me mires así, que me pongo rojo'] },
  pecas: { r: 'feliz', lines: ['Pecas de sol: encanto natural', 'Cada peca es un ahorro', 'Pequitas lindas, ¿cierto?', 'Las conté: son de la suerte'] },
  curita: { r: 'timido', lines: ['Una pequeña herida de batalla 🩹', 'Me caí… pero me levanté', 'No pregunten', 'Ya casi no duele'] },
  lunar: { r: 'pose1', lines: ['Un lunar coqueto', 'Lunar de galán', 'Detallito con encanto', 'Mi marca personal'] },
  brillitos: { r: 'feliz', then: 'pose3', burst: '✨', lines: ['¡Brillo, brillo! ✨', 'Hoy amanecí reluciente', 'Más brillante que un billete nuevo', 'Brillo como tus finanzas'] },
  corazoncito: { r: 'timido', burst: '💗', lines: ['Con amor para ti 💗', 'Corazoncito en la mejilla', 'Tierno nivel máximo', 'Me puse cursi, perdón'] },
  // Extras
  audifonos: { r: 'pose2', then: 'cosquillas', burst: '🎵🎶', lines: ['Pon mi canción favorita 🎧', 'Escuchando un podcast de finanzas', 'Con música todo sale mejor', '¿Salsa o vallenato?'] },
  flor: { r: 'timido', burst: '🌸', lines: ['Una flor para alegrar el día 🌸', 'Florecido y feliz', 'Huelo a primavera', 'Me la regalaron, ¿se nota?'] },
  'lapiz-oreja': { r: 'ajuste', burst: '📝', lines: ['Lápiz listo para anotar gastos ✏️', 'Llevo la cuenta de todo', 'Contador profesional', 'Anotado y subrayado'] },
  mariposa: { r: 'arriba', burst: '🦋', lines: ['Una mariposa se posó en mí 🦋', 'No te muevas, que se va', '¡Mira quién vino de visita!', 'Mariposas amarillas, como en Macondo'] },
  globo: { r: 'arriba', then: 'pose3', burst: '🎈', lines: ['¡Mi globito! 🎈', 'No lo sueltes, porfa', 'Me siento de cumpleaños', 'Si lo suelto, me voy volando'] },
};

// Al quitarse algo (por slot) y en general
const REMOVE = {
  cabello: ['Vuelvo a mi calva brillante', 'Sin pelo: más aerodinámico', 'Adiós, {it}', 'Corte cero, ¡qué fresco!'],
  cabeza: ['Uf, qué fresquito sin {el}', 'Cabeza libre', 'Despeinado otra vez', 'Guardé {el} para otro día'],
  gafas: ['Sin gafas veo… más o menos', '¿Dónde quedaron mis gafas?', 'Ojos al natural', 'Ahora sí me ves los ojitos'],
  vello: ['Recién afeitado ✨', 'Carita lisa otra vez', 'Me afeité en un segundo', 'Adiós, {it}: fue bonito'],
  cuello: ['Cuello libre', 'Ya no me aprieta nada', 'Adiós, {it}', 'Más ligerito'],
  cara: ['Carita limpia', 'Sin {it}, al natural', 'Cara lavada, como recién levantado'],
  extras: ['Bye, {it} 👋', 'Menos es más, ¿cierto?', 'Guardé {el} para después'],
};
const REMOVE_ANY = ['Adiós, {it} 👋', 'Te voy a extrañar, {it}', 'Bueno, sin {el} también me veo bien', 'Fue lindo mientras duró'];

const EQUIP_ANY = [
  '¡Me encanta!', '¿Cómo me veo?', 'Esto es muy yo', 'Uff, elegancia pura', '¡Qué estilo!', 'Me queda pintado', '¡Así sí!',
  'Ya me siento otro', '¿{El}? ¡Buena elección!', 'Me gusta {el}, mucho criterio', 'Tienes buen ojo, {name}',
  '{name}, ¿qué haría yo sin ti?', '¡Me veo de revista!', 'Esto pide foto 📸',
];
const FIRST_ITEM = ['¡Mi primer accesorio!', 'Empezamos a armar el look', 'Primer paso hacia el estilo', '¡Ya no soy el mismo!'];
const MANY = ['Voy recargado, pero con estilo', '¿Cabe algo más?', 'Más accesorios que gastos hormiga', 'Parezco árbol de Navidad 🎄', 'Todo puesto, ¡nada me falta!'];
const INDECISO = ['¿Indeciso? Tómate tu tiempo', 'Me cambio más rápido que tú de opinión 😄', 'Uf, me estoy mareando', 'Pruébalo todo, yo no me canso', 'Probador abierto 24 horas'];
const VUELVE = ['¡Volvió {el}! Sabía que {lo} extrañarías', 'Ya decía yo que {el} era lo mío', 'Reconciliación con {el} 💞', '¿Otra vez {el}? ¡Me encanta!'];
const CONFLICT = ['No cabían los dos: me quité {el2}', 'Chao, {it2}: llegó {el}', 'Cambio de turno: {el} por {el2}', '{El2} le cedió el puesto a {el}'];

// Colores (por nombre de la paleta)
export const COLOR_LINES = {
  Lima: ['Verde lima, ¡qué energía!', 'Lima ácido: me despierta', 'Fosforito, ¡se ve de lejos!'],
  Amarillo: ['Amarillo sol ☀️', 'Amarillo, como la bandera', 'Amarillo: color de la buena suerte'],
  Naranja: ['Naranja vitamina 🍊', 'Naranja: alegría pura', 'Naranja, como el atardecer'],
  Coral: ['Coral, muy de playa', 'Coral tropical 🐠', 'Coral: suave y alegre'],
  Rojo: ['¡Rojo pasión!', 'Rojo: color de poder', 'En rojo, pero no mis cuentas 😉'],
  Rosa: ['Rosa: valiente y tierno', 'Pink power 💗', 'Rosado chicle, ¡me encanta!'],
  Menta: ['Menta fresquita', 'Menta: frescura total 🌿', 'Verde menta, relajante'],
  Verde: ['Verde como los billetes que ahorramos 💵', 'Verde esperanza', 'Verde montaña, muy colombiano'],
  Turquesa: ['Turquesa caribeño', 'Turquesa, como el mar de San Andrés 🌊', 'Turquesa: se ve fresquísimo'],
  Cielo: ['Azul cielo, tranquilidad', 'Celestito, qué paz ☁️', 'Azul cielo: cero estrés'],
  'Café': ['Café, como un buen tinto ☕', 'Café clásico: nunca falla', 'Café: elegante y sencillo'],
  'Carbón': ['Negro carbón: elegante siempre', 'Oscuro y misterioso 🖤', 'Negro: combina con todo'],
};
const COLOR_ANY = ['{It} en {color}, ¡me gusta!', 'Combina con mi personalidad', 'Ese tono me queda', 'Cambio de color, cambio de ánimo', '{color}… sí, definitivamente {color}'];

// Looks completos
export const LOOK_LINES = {
  ejecutivo: ['Listo para la junta directiva', '¡Modo ejecutivo activado!', 'Ejecutivo y con las cuentas claras', '¿Firmamos el contrato?'],
  costeno: ['¡Ajá, compadre! Modo costeño', 'Puro sabor caribeño 🌴', '¿Dónde es el fandango?', 'Con este calor, ¡qué sabroso!'],
  rockero: ['¡Rock and roll! 🤘', 'Modo rockero: volumen al máximo', 'Esta noche toco en vivo', 'Rockero con fondo de emergencia'],
  fiestero: ['¡A rumbear (con presupuesto)! 🎉', 'Fiestero oficial reportándose', '¿Quién puso la música?', 'Pa’ la rumba, ¡pero temprano!'],
  intelectual: ['Hoy leo a García Márquez 📚', 'Modo intelectual: pensamiento profundo', 'Hablemos de economía, querido', 'Café, libro y presupuesto'],
  invierno: ['Abrigadito para el frío ❄️', 'Modo invierno: chocolate y cobija', 'Brr, qué frío… pero qué estilo', 'Listo para Bogotá a las 6 a. m.'],
  explorador: ['¡A explorar el mundo! 🧭', 'Expedición en busca del ahorro perdido', 'Mochila lista, presupuesto también', 'Rumbo a la selva… de los extractos'],
  superheroe: ['¡Súper Lukas al rescate! 🦸', 'Un gran poder trae un gran presupuesto', 'Ningún gasto hormiga escapa de mí', '¡Justicia financiera!'],
};
const LOOK_ANY = ['¡Modo {look} activado!', 'Look {look}: me queda perfecto', '{Look} de pies a cabeza… bueno, solo cabeza'];

// Combinaciones con nombre propio (se dicen al formarse, cuando la última pieza las completa)
export const COMBOS = [
  { ids: ['vaquero', ['bigote', 'manubrio']], burst: '🤠', lines: ['Sheriff con bigote: el pueblo está a salvo', '¡Forastero, aquí se ahorra!'] },
  { ids: ['vueltiao', 'panoleta'], burst: '🪗', lines: ['Costeño de pura cepa, ¡ajá!', 'Solo me falta el acordeón'] },
  { ids: ['corona', 'capa'], burst: '👑', lines: ['Rey y superhéroe: demasiado poder', 'Su Majestad Súper Lukas'] },
  { ids: ['chef', ['bigote', 'manubrio']], lines: ['Chef con bigote: cocina de abuela auténtica', 'Mamma mia, ¡qué sazón!'] },
  { ids: ['mago', ['barba', 'lenador']], burst: '🧙', lines: ['Mago con barba: sabiduría ancestral', '¡No pasarás… sin ahorrar!'] },
  { ids: ['copa', ['monoculo', 'manubrio', 'corbatin']], lines: ['Un caballero de otro siglo', 'Mmm, muy aristocrático, ¿no cree?', '¿Té a las cinco, mi estimado?'] },
  { ids: ['aviador', 'tupe'], lines: ['Rockero de los 80, ¡qué nivel!', 'Pura nostalgia ochentera'] },
  { ids: ['lana', 'bufanda'], burst: '❄️', lines: ['Combo anti-frío completo', 'Que venga el frío, estoy listo'] },
  { ids: ['ruana', ['lana', 'boina']], burst: '☕', lines: ['Listo para el páramo, sumercé', '¿Un aguapanela calientica?'] },
  { ids: ['hawaiano', ['fiesta', 'pescador', 'gorra-reves']], burst: '🌴', lines: ['Modo vacaciones: ON', 'Me voy pa’ la playa'] },
  { ids: ['pixel', 'cadena'], lines: ['Rapero nivel 8 bits', 'Yo, en mi videoclip'] },
  { ids: ['gato', ['corazon', 'corazoncito']], burst: '😻', lines: ['Gatito enamorado', 'Miau con amor'] },
  { ids: ['corbata', 'raya'], lines: ['Gerente general, mucho gusto', 'Listo para presentar resultados'] },
  { ids: ['casco', 'lapiz-oreja'], lines: ['Maestro de obra con todo anotado', 'Obra con presupuesto al día'] },
  { ids: ['navideno', ['bufanda', 'rubor']], burst: '🎄', lines: ['Navidad con abrigo, ¡qué ternura!', 'Listo para la novena'] },
  { ids: ['esqui', ['lana', 'bufanda']], burst: '⛷️', lines: ['Listo para la nieve', '¿Nos vamos a esquiar?'] },
  { ids: ['aureola', ['corazoncito', 'rubor']], lines: ['Angelito enamorado', 'Más tierno, imposible'] },
  { ids: ['antenas', 'mariposa'], burst: '🐝🦋', lines: ['Del reino de los insectos', 'Mi amiga la mariposa y yo'] },
  { ids: ['corona', 'cadena'], burst: '👑', lines: ['Bling real', 'Rey con flow'] },
  { ids: ['boina', 'redondas'], lines: ['Artista intelectual', 'Pinto y leo poesía'] },
  { ids: ['helice', 'globo'], burst: '🎈', lines: ['¡Me voy a salir volando!', 'Doble propulsión: hélice y globo'] },
  { ids: ['pirata', 'medalla'], lines: ['Encontré el tesoro', 'Botín de pirata ganado'] },
  { ids: ['mohicana', ['cadena', 'tres-dias']], lines: ['Punk de verdad', 'Concierto esta noche'] },
  { ids: ['coletas', ['flor', 'pecas']], lines: ['Más tierno que un domingo en el parque', 'Lista para el picnic'] },
  { ids: ['afro', 'audifonos'], burst: '🎶', lines: ['Mis rizos bailan con la música', 'Groove total'] },
];

// Entrar al editor
const ENTER_CLASSIC = ['¡Uy, me vas a arreglar!', '¿Qué me pongo hoy?', 'Estoy listo para el cambio', 'Hora de cambio de look', '¡Vísteme bonito!'];
const ENTER_DRESSED = ['¿Le cambiamos algo a mi look?', '¿Otra vez de compras? 😄', '¿Me quedo así o renovamos?', 'Con {el} me siento bien… pero escucho propuestas', '¿Qué tal si probamos algo nuevo?'];
const ENTER_NAME = ['¡Hola, {name}! ¿Qué me pongo?', '{name}, ¡vísteme bonito!', '¡{name}! Justo pensaba en cambiar de look'];
const BY_HOUR = {
  madrugada: ['¿Desvelado? Yo también 🌙', 'A esta hora solo los valientes se arreglan'],
  manana: ['¡Buenos días! ¿Qué me pongo hoy?', 'Tinto y cambio de look ☕', 'Arrancamos el día con estilo'],
  tarde: ['Buenas tardes, ¿renovamos estilo?', 'Tarde perfecta para un cambio'],
  noche: ['¿Arreglándome a esta hora? Me gusta', 'Look nocturno, ¡a ver!', 'Buenas noches, ¿salimos?'],
};
const BY_DAY = { 5: ['¡Es viernes! Algo para salir 🎉', 'Viernes: ¿look de rumba?'], 6: ['Sábado de estilo libre'], 0: ['Domingo: estilo relajado', 'Look de domingo en familia'], 1: ['Lunes: ¿look serio para la semana?'] };

// Pestañas (la primera vez que se abre cada una)
const TAB_LINES = {
  looks: ['Conjuntos listos: ¡tú eliges!', 'Un toque y quedo completo'],
  cabeza: ['¿Algo para la cabeza?', 'Sombreros, gorras… ¡todo me queda!'],
  cabello: ['¿Me dejo el pelo?', 'Peluquería Lukas, ¡pase!'],
  gafas: ['¿Gafas? Veamos…', 'Gafas: para ver tus finanzas mejor'],
  vello: ['¿Me dejo crecer algo?', '¿Bigote o barba? Difícil decisión'],
  cuello: ['¿Algo para el cuello?', 'Bufandas, corbatas, capas…'],
  cara: ['Detallitos para la cara', 'Pequeños detalles, gran diferencia'],
  extras: ['¡Los extras son lo mejor!', 'Aquí está lo divertido'],
};

// Reposo
const IDLE = ['¿Me tomas una foto?', 'Modelando…', '¿Así o más guapo?', '¿Probamos algo más?', 'La pasarela es mía 💃', 'Posando para la portada', 'Pose número tres…', '¿Me veo bien de este lado?'];
const IDLE_ITEM = ['¿Te gusta {este} {it}? A mí me encanta', 'No me quito {el} por nada', 'Me encanta {el}', '¿Qué tal {el}? ¿Bien?'];
const IDLE_LATE = ['Ya es tarde… pero el estilo no duerme 🌙', 'Uaaa… ¿seguimos? 😴'];
const TIP_COMPARE = ['Tip: mantenme presionado para ver cómo estaba', 'Mantenme presionado y compara el antes'];
const TIP_COLOR = ['Toca un color abajo y lo cambio', '¿Y si le cambias el color a {el}?'];
const TIP_LOOKS = ['¿Sin ideas? Mira la pestaña «Looks»', 'En «Looks» hay conjuntos completos'];
const TIP_SURPRISE = ['¿Sin ideas? Toca «Sorpréndeme»', 'Deja que el azar me vista: «Sorpréndeme»'];
const TIP_TICKLE = ['Psst… tócame, no muerdo', 'Hazme cosquillas, ¡anda!'];
const TIP_SAVE = ['No olvides guardar mi look 😉', '¿Guardamos? Me encanta cómo quedé', 'Si no guardas, ¡me desvisto al salir!'];

// Cosquillas: suben de intensidad si siguen
const TICKLE = [
  ['¡Jajaja, cosquillas!', '¡Ay, para, para!', '¡Jiji, eso no se vale!', '¡Jajaja, ahí no!', '¡Ay, me haces reír!'],
  ['¡Jajaja, ya, ya!', '¡Me vas a hacer llorar de risa!', '¡Jajaja, tregua, tregua!', '¡Ay, no puedo más, jajaja!'],
  ['¡Me rindo! ¡Tú ganas! 🏳️', 'Ok, ya sé que soy irresistible', 'Necesito aire… ¡jajaja!', '¡Ay! Voy a llamar a soporte técnico'],
];

const SAVE = ['¡Quedé brutal!', '¡Listo! Así me quedo', 'Guardado. ¡Qué pinta la mía!', 'Me encanta, gracias {name} 💜', 'Nuevo look, nuevo yo', 'Ahora sí, a cuidar tu plata con estilo', 'Así me verás en el Inicio', '¡Me veo increíble!', '¡Guardadito!'];
const SAVE_ITEM = ['Con {el} nadie me para', '{El} se queda conmigo', 'Me quedo con {el}, ¡gracias!'];
const SAVE_CLASSIC = ['Volví a mis raíces', 'Clásico nunca pasa de moda', 'Sencillo y feliz'];
const SAVE_MANY = ['Guardado con todo y accesorios', 'Todo puesto y guardado, ¡qué lujo!'];
const UNDO = ['Mejor como estaba', '¡Rebobinando! ⏪', 'Ups, retrocedemos', 'Como si nada hubiera pasado', 'Volvamos un pasito'];
const SURPRISE = ['¡Sorpresa!', '¡A ver qué sale!', 'Esto no me lo esperaba', '¡Ruleta de estilo!', 'El azar tiene buen gusto', '¿Y esto? ¡Me gusta!', 'Dejé que el destino me vistiera', '¡Tómala! Look al azar'];
const CLASSIC = ['Me siento sin nada…', 'Al natural, como vine al mundo', 'Clásico: nunca pasa de moda', 'Me siento ligerito', 'Ay, me da pena así 🙈'];
const COMPARE_END = ['¿Mejor el nuevo, cierto?', 'Antes vs. ahora: me quedo con ahora', '¿Viste la diferencia?', 'El de ahora tiene más chispa'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LO = { el: 'lo', la: 'la', los: 'los', las: 'las' };
const ESTE = { el: 'este', la: 'esta', los: 'estos', las: 'estas' };
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SLOT_REACT = { cabeza: 'arriba', cabello: 'feliz', gafas: 'ajuste', vello: 'ajuste', cuello: 'presume', cara: 'feliz', extras: 'presume' };
const SLOT_SPIN = new Set(['cuello', 'extras']);
const HAPPY_THEN = ['pose3', 'feliz', 'pose1', null, null];

/** Variables de un ítem para las plantillas */
function itemVars(it, suffix = '') {
  if (!it) return {};
  const it_ = lc(it.nombre);
  return { [`it${suffix}`]: it_, [`el${suffix}`]: `${it.art} ${it_}`, [`lo${suffix}`]: LO[it.art], [`este${suffix}`]: ESTE[it.art] };
}

/** Reemplaza {var} y {Var} (con mayúscula inicial). Devuelve null si falta alguna variable. */
export function fill(tpl, vars) {
  let ok = true;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k] ?? vars[lc(k)];
    if (v == null || v === '') { ok = false; return ''; }
    return k[0] === k[0].toUpperCase() ? cap(String(v)) : String(v);
  });
  return ok ? cap(out) : null;
}

const hourBand = (h) => (h < 5 ? 'madrugada' : h < 12 ? 'manana' : h < 19 ? 'tarde' : 'noche');
const present = (cfg) => SLOTS.map((s) => cfg?.[s] && BY_ID.get(cfg[s])).filter(Boolean);

/**
 * Crea la "voz" del editor. rnd y now se inyectan para poder probarla.
 * name: primer nombre del usuario (las frases con {name} se omiten si no hay).
 */
export function createChatter({ rnd = Math.random, now = () => new Date(), name = '' } = {}) {
  const recent = [];
  const changes = [];
  const tickles = [];
  const removedAt = new Map();
  const tabsSeen = new Set();
  const ctx = { tickled: false, sawLooks: false, idle: 0 };
  const firstName = String(name ?? '').trim().split(/\s+/)[0] ?? '';

  const at = () => now().getTime();
  const one = (list) => list[Math.floor(rnd() * list.length)];

  /** pools: [[peso, frases, variables], …] → texto (evita las últimas frases dichas) */
  function choose(pools) {
    const live = pools.map(([w, list, vars = {}]) => {
      const all = (list ?? []).map((t) => fill(t, { name: firstName, ...vars })).filter(Boolean);
      return { w, all, fresh: all.filter((t) => !recent.includes(t)) };
    }).filter((p) => p.w > 0 && p.all.length);
    if (!live.length) return '';
    const usable = live.some((p) => p.fresh.length) ? live.filter((p) => p.fresh.length) : live;
    let r = rnd() * usable.reduce((a, p) => a + p.w, 0);
    let pool = usable[usable.length - 1];
    for (const p of usable) { r -= p.w; if (r <= 0) { pool = p; break; } }
    const list = pool.fresh.length ? pool.fresh : pool.all;
    const text = one(list);
    recent.push(text);
    if (recent.length > 18) recent.shift();
    return text;
  }

  const comboFor = (cfg, newId) => {
    const ids = new Set(present(cfg).map((it) => it.id));
    return COMBOS.find((c) => c.ids.some((x) => (Array.isArray(x) ? x.includes(newId) : x === newId))
      && c.ids.every((x) => (Array.isArray(x) ? x.some((y) => ids.has(y)) : ids.has(x))));
  };

  const seasonal = (it) => {
    if (it.id !== 'navideno') return [];
    const m = now().getMonth();
    return m === 11 ? ['¡Por fin diciembre! 🎄', 'Diciembre y gorro navideño: combo perfecto']
      : m === 10 ? ['¿Ya preparando diciembre? ¡Me gusta!'] : [`¿Navidad en ${MESES[m]}? Yo no juzgo 😄`];
  };

  function trackChange() {
    const t = at();
    changes.push(t);
    while (changes.length && t - changes[0] > 12000) changes.shift();
    return changes.length;
  }

  return {
    get context() { return ctx; },

    enter(cfg) {
      const d = now();
      const items = present(cfg);
      const main = items.length ? one(items) : null;
      const text = choose([
        [items.length ? 0 : 3, ENTER_CLASSIC],
        [items.length ? 3 : 0, ENTER_DRESSED, itemVars(main)],
        [1.5, ENTER_NAME],
        [1.5, BY_HOUR[hourBand(d.getHours())]],
        [1, BY_DAY[d.getDay()]],
        [d.getMonth() === 11 ? 1.5 : 0, ['Diciembre: ¿algo navideño? 🎄', 'Ya llegó diciembre, ¡vísteme de fiesta!']],
      ]);
      return { text, react: items.length ? 'presume' : 'feliz' };
    },

    tab(slot) {
      if (slot === 'looks') ctx.sawLooks = true;
      if (tabsSeen.has(slot)) return null;
      tabsSeen.add(slot);
      if (rnd() > 0.55) return null;
      return { text: choose([[1, TAB_LINES[slot]]]), react: 'arriba' };
    },

    /** Se puso `item` en `slot` (prev → next). removed: lo que se quitó por incompatibilidad. */
    equip({ prev, next, slot, item, removed = [] }) {
      const n = trackChange();
      const meta = ITEM_LINES[item.id] ?? {};
      const vars = itemVars(item);
      const combo = comboFor(next, item.id);
      const count = present(next).length;
      const back = removedAt.has(item.id) && at() - removedAt.get(item.id) < 20000;
      removedAt.delete(item.id);
      let text;
      if (removed.length && rnd() < 0.6) text = choose([[1, CONFLICT, { ...vars, ...itemVars(removed[0], '2') }]]);
      else if (combo && rnd() < 0.85) text = choose([[1, combo.lines, vars]]);
      else if (back) text = choose([[1, VUELVE, vars]]);
      else if (n >= 5 && rnd() < 0.6) text = choose([[1, INDECISO, vars]]);
      else {
        text = choose([
          [6, [...(meta.lines ?? []), ...seasonal(item)], vars],
          [present(prev).length === 0 ? 2 : 0, FIRST_ITEM, vars],
          [count >= 5 ? 2 : 0, MANY, vars],
          [1.6, EQUIP_ANY, vars],
        ]);
      }
      return {
        text,
        react: meta.r ?? SLOT_REACT[slot] ?? 'feliz',
        then: meta.then ?? (rnd() < 0.45 ? one(HAPPY_THEN) : null),
        burst: combo?.burst ?? meta.burst ?? null,
        spin: !!meta.spin || SLOT_SPIN.has(slot),
      };
    },

    remove({ slot, item }) {
      trackChange();
      if (item) removedAt.set(item.id, at());
      return { text: choose([[3, REMOVE[slot], itemVars(item)], [1, REMOVE_ANY, itemVars(item)]]), react: 'ajuste' };
    },

    color({ item, hex }) {
      trackChange();
      const c = PALETTE.find((p) => p.hex === hex)?.nombre ?? '';
      return { text: choose([[2.5, COLOR_LINES[c]], [1, COLOR_ANY, { ...itemVars(item), color: lc(c) }]]), react: 'ajuste', then: rnd() < 0.4 ? 'pose1' : null };
    },

    look(id) {
      trackChange();
      const l = LOOKS.find((x) => x.id === id);
      return { text: choose([[3, LOOK_LINES[id]], [1, LOOK_ANY, { look: lc(l?.nombre ?? '') }]]), react: 'presume', then: 'pose3', burst: '✨', spin: true };
    },

    surprise() {
      trackChange();
      return { text: choose([[1, SURPRISE]]), react: 'cosquillas', then: 'presume', burst: '🎲✨', spin: true };
    },

    classic() { return { text: choose([[1, CLASSIC]]), react: 'timido' }; },

    undo() { return { text: choose([[1, UNDO]]), react: 'ajuste' }; },

    tickle() {
      ctx.tickled = true;
      const t = at();
      tickles.push(t);
      while (tickles.length && t - tickles[0] > 8000) tickles.shift();
      const level = tickles.length >= 5 ? 2 : tickles.length >= 3 ? 1 : 0;
      return { text: choose([[1, TICKLE[level]]]), react: level === 2 && rnd() < 0.5 ? 'timido' : 'cosquillas', level };
    },

    /** Reposo. state: { cfg, dirty, colorable, colorItem } */
    idle({ cfg, dirty = false, colorable = false, colorItem = null } = {}) {
      ctx.idle++;
      const items = present(cfg);
      const main = items.length ? one(items) : null;
      const late = now().getHours() < 5 || now().getHours() >= 23;
      const text = choose([
        [3, IDLE],
        [main ? 2.5 : 0, IDLE_ITEM, itemVars(main)],
        [late ? 1.5 : 0, IDLE_LATE],
        [dirty && ctx.idle >= 2 ? 3 : 0, TIP_SAVE],
        [dirty ? 1.2 : 0, TIP_COMPARE],
        [colorable ? 1.2 : 0, TIP_COLOR, itemVars(colorItem)],
        [ctx.sawLooks ? 0 : 1, TIP_LOOKS],
        [1, TIP_SURPRISE],
        [ctx.tickled ? 0 : 1.2, TIP_TICKLE],
      ]);
      return { text, react: one(['pose1', 'pose2', 'pose3']) };
    },

    save(cfg) {
      const items = present(cfg);
      const main = items.length ? one(items) : null;
      const text = choose([
        [4, SAVE],
        [main ? 2 : 0, SAVE_ITEM, itemVars(main)],
        [items.length ? 0 : 3, SAVE_CLASSIC],
        [items.length >= 4 ? 1.5 : 0, SAVE_MANY],
      ]);
      return { text, react: 'presume', burst: main ? ITEM_LINES[main.id]?.burst ?? '💜' : '💜' };
    },

    compareEnd() { return rnd() < 0.6 ? { text: choose([[1, COMPARE_END]]), react: 'presume' } : null; },
  };
}
