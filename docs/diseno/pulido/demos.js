// Código que corre dentro de cada demostración de movimiento de la página del pulido visual
// (`pagina.mjs` lo mete en el `srcdoc` de un iframe, junto a una instantánea del DOM de la app real
// y su hoja de estilos de producción). Aquí no hay React ni la lógica de la app: cada demostración
// mueve el DOM a mano para enseñar un solo cambio con la animación de la opción elegida.
// La página le manda `{ t: 'play', variant, css, motion, theme }` y la demostración vuelve a su
// estado de partida, espera un momento y reproduce el cambio.

/* global DEMO_ID, SNAP2 */
const root = document.documentElement;
const $ = (selector, from = document) => from.querySelector(selector);
const $$ = (selector, from = document) => [...from.querySelectorAll(selector)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const motion = () => parseFloat(getComputedStyle(root).getPropertyValue('--motion')) || 0;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const app = $('.app');
const main = $('#main');
const mainHtml = main ? main.innerHTML : '';
let variant = 'ninguna';
let turn = 0;

/** La otra pantalla de las demostraciones que cambian de pantalla. */
const other = (() => {
  if (!SNAP2) return null;
  const doc = new DOMParser().parseFromString(SNAP2, 'text/html');
  return {
    main: doc.querySelector('#main').innerHTML,
    route: doc.querySelector('.app').dataset.route,
  };
})();

function setRoute(route) {
  app.dataset.route = route;
  const current = { list: 0, game: 0, catalog: 1, settings: 2 }[route];
  $$('.app-nav__link').forEach((link, i) => {
    if (i === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('.palette')?.classList.toggle('is-barless', route !== 'list');
}

function swapMain(html, route, animate = true) {
  main.innerHTML = html;
  setRoute(route);
  main.classList.remove('is-entering');
  if (animate) {
    void main.offsetWidth;
    main.classList.add('is-entering');
  }
  scrollTo(0, 0);
}

const palette = {
  reset() {
    this.pal ??= $('.palette');
    this.popup ??= $('.palette__popup');
    this.back ??= $('.palette__backdrop');
    this.input ??= $('.palette__input');
    this.pal.classList.remove('is-open');
    this.popup.hidden = true;
    this.back.remove();
    this.input.value = '';
  },
  async run() {
    this.pal.classList.add('is-open');
    this.pal.prepend(this.back);
    this.popup.hidden = false;
    this.input.value = 'hollow';
  },
};

const DEMOS = {
  paleta: palette,
  'paleta-movil': palette,

  menu: {
    reset() {
      this.popup ??= $('.menu__popup');
      this.parent ??= this.popup.parentNode;
      this.popup.remove();
      $('button', this.parent).setAttribute('aria-expanded', 'false');
    },
    async run() {
      this.parent.append(this.popup);
      $('button', this.parent).setAttribute('aria-expanded', 'true');
    },
  },

  estado: {
    reset() {
      main.innerHTML = mainHtml;
      scrollTo(0, 0);
    },
    async run() {
      const row = $('[data-entry-id="steam:1030300"]');
      const target = $$('.entry-list')[0];
      const change = () => {
        target.append(row);
        row.dataset.status = 'playing';
        const button = $('.status-button', row);
        button.className = button.className.replace('want_to_play', 'playing');
        $('.status-button__label', row).textContent = 'Jugando';
        $('.entry-row__handle', row)?.remove();
        const titles = $$('.list-section__header h2');
        titles[0].textContent = 'Jugando ahora (3)';
        titles[1].textContent = 'A continuación (1)';
      };
      if (variant === 'deslizar') {
        // FLIP: se mide antes y después, y cada fila recorre la diferencia con `transform`.
        const moving = $$('.entry-row, .list-section__header');
        const before = new Map(moving.map((el) => [el, el.getBoundingClientRect()]));
        change();
        row.classList.add('is-moving');
        const duration = motion() * 1.6;
        for (const el of moving) {
          const a = before.get(el);
          const b = el.getBoundingClientRect();
          const dx = a.left - b.left;
          const dy = a.top - b.top;
          if (dx === 0 && dy === 0) continue;
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
            duration,
            easing: EASE,
          });
        }
        await wait(duration);
        row.classList.remove('is-moving');
      } else if (variant === 'fundir') {
        await row.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: motion() * 0.6,
          fill: 'forwards',
        }).finished;
        change();
        for (const animation of row.getAnimations()) animation.cancel();
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion(), easing: 'ease-out' });
      } else {
        change();
      }
    },
  },

  alta: {
    list() {
      const title = $$('.list-section__header h2').find((h2) =>
        h2.textContent.startsWith('Quiero jugar'),
      );
      return { title, list: $('.entry-list', title.closest('.list-section')) };
    },
    reset() {
      main.innerHTML = mainHtml;
      this.list().list.lastElementChild.scrollIntoView({ block: 'center' });
    },
    async run() {
      const { title, list } = this.list();
      const row = list.lastElementChild.cloneNode(true);
      row.dataset.entryId = 'steam:1145360';
      $('.entry-row__title', row).textContent = 'Hades';
      $('.entry-row__rank', row).textContent = String(list.children.length + 1);
      $('.cover__img', row).src =
        'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg';
      $('.flag-badges', row)?.replaceChildren();
      row.classList.add('is-new');
      list.append(row);
      title.textContent = `Quiero jugar (${list.children.length})`;
    },
  },

  aviso: {
    reset() {
      this.toast ??= $('.toast');
      this.toaster ??= $('.toaster');
      this.toast.classList.remove('is-leaving');
      this.toast.remove();
    },
    async run(alive) {
      this.toaster.append(this.toast);
      await wait(2800);
      if (!alive()) return;
      if (variant !== 'ahora') {
        this.toast.classList.add('is-leaving');
        await wait(motion() * 0.75);
        if (!alive()) return;
      }
      this.toast.classList.remove('is-leaving');
      this.toast.remove();
    },
  },

  pantalla: {
    reset() {
      swapMain(mainHtml, 'list', false);
    },
    async run(alive) {
      swapMain(other.main, other.route);
      await wait(1500);
      if (alive()) swapMain(mainHtml, 'list');
    },
  },

  indicador: {
    reset() {
      swapMain(mainHtml, 'list', false);
    },
    async run(alive) {
      swapMain(other.main, 'catalog', false);
      await wait(1100);
      if (!alive()) return;
      swapMain('<div class="screen"><h1>Ajustes</h1></div>', 'settings', false);
      await wait(1100);
      if (alive()) swapMain(mainHtml, 'list', false);
    },
  },

  'ficha-movil': {
    reset() {
      swapMain(mainHtml, 'list', false);
    },
    async run(alive) {
      swapMain(other.main, 'game');
      await wait(2200);
      if (alive()) swapMain(mainHtml, 'list');
    },
  },

  'ficha-panel': {
    reset() {
      $('.sheet').classList.add('demo-off');
    },
    async run() {
      $('.sheet').classList.remove('demo-off');
    },
  },

  pulsar: {
    reset() {
      for (const el of $$('.is-pressed')) el.classList.remove('is-pressed');
    },
    async run(alive) {
      for (const button of $$('[data-press]')) {
        if (!alive()) return;
        button.classList.add('is-pressed');
        await wait(170);
        button.classList.remove('is-pressed');
        await wait(330);
      }
    },
  },

  marca: {
    reset() {
      main.innerHTML = mainHtml;
      $('[data-entry-id="steam:1030300"]').classList.add('demo-hover');
      scrollTo(0, 0);
    },
    async run() {
      const row = $('[data-entry-id="steam:1030300"]');
      const button = $('.flag-toggle--platinum', row);
      button.setAttribute('aria-pressed', 'true');
      button.classList.add('is-just');
      const chip = document.createElement('span');
      chip.className = 'chip chip--platinum is-new';
      chip.append($('svg', button).cloneNode(true), 'Platinado');
      $('.flag-badges', row).append(chip);
    },
  },
};

const demo = DEMOS[DEMO_ID];
// Nada de aquí navega: los enlaces de la instantánea no llevan a ningún sitio.
document.addEventListener(
  'click',
  (event) => {
    if (event.target.closest('a')) event.preventDefault();
  },
  true,
);
addEventListener('message', async (event) => {
  const data = event.data;
  if (data?.t !== 'play') return;
  root.dataset.theme = data.theme;
  $('#v').textContent = `:root { --motion: ${data.motion}ms; }\n${data.css}`;
  variant = data.variant;
  const mine = ++turn;
  demo.reset();
  if (data.resetOnly) return;
  await wait(500);
  if (mine !== turn) return;
  await demo.run(() => mine === turn);
});
demo.reset();
parent.postMessage({ t: 'ready', id: DEMO_ID }, '*');
