// Local presentation state only. Routing owns and disposes each carousel instance.
export function bindFeaturedCarousel(root, {
  interval = 6000, doc = document, motion = window.matchMedia('(prefers-reduced-motion: reduce)'),
  later = setTimeout, cancel = clearTimeout,
} = {}) {
  const carousel = root.querySelector('[data-featured-carousel]');
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll('[data-featured-slide]')];
  if (slides.length < 2) return;
  const stage = carousel.querySelector('[data-featured-stage]');
  let current = Math.max(0, slides.indexOf(carousel.querySelector('[data-featured-slide].is-active')));
  let timer, stopped = false, hovered = false, focused = false;
  let paused = motion.matches;
  function schedule() {
    cancel(timer);
    if (!stopped && slides.length > 1 && !paused && !hovered && !focused && !doc.hidden) {
      timer = later(() => show(current + 1), interval);
    }
  }
  function show(index) {
    if (stopped) return;
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.inert = !active;
    });
    schedule();
  }
  function syncPause() {
    stage.setAttribute('aria-live', paused || focused || hovered ? 'polite' : 'off');
    const toggle = carousel.querySelector('[data-featured-action="pause"], [data-featured-action="play"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.dataset.featuredAction = paused ? 'play' : 'pause';
      toggle.setAttribute('aria-label', paused ? toggle.dataset.playLabel || 'Play featured films' : toggle.dataset.pauseLabel || 'Pause featured films');
      if (toggle.dataset.pauseText && toggle.dataset.playText) {
        toggle.textContent = paused ? toggle.dataset.playText : toggle.dataset.pauseText;
      }
    }
    schedule();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || !carousel.contains(button)) return;
    if (button.dataset.featuredAction === 'prev') show(current - 1);
    else if (button.dataset.featuredAction === 'next') show(current + 1);
    else if (button.dataset.featuredAction === 'pause') { paused = true; syncPause(); }
    else if (button.dataset.featuredAction === 'play') { paused = false; syncPause(); }
  }
  const enter = () => { hovered = true; syncPause(); };
  const leave = () => { hovered = false; syncPause(); };
  const focus = () => { focused = true; syncPause(); };
  const blur = event => { focused = carousel.contains(event.relatedTarget); syncPause(); };
  const visibility = () => schedule();
  const preference = () => { paused = motion.matches; syncPause(); };
  const handlers = { click, mouseenter: enter, mouseleave: leave, focusin: focus, focusout: blur };
  Object.entries(handlers).forEach(([type, handler]) => carousel.addEventListener(type, handler));
  doc.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', preference);
  syncPause();
  return () => {
    stopped = true;
    cancel(timer);
    Object.entries(handlers).forEach(([type, handler]) => carousel.removeEventListener(type, handler));
    doc.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener('change', preference);
  };
}
