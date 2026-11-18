const videos = [...document.querySelectorAll('.background-video')];
const control = document.querySelector('#video-control');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeIndex = 0;
let userPaused = false;
let switching = false;
const canPlay = () => !userPaused && !document.hidden && !reducedMotion.matches;
const currentVideo = () => videos[activeIndex];
function syncControl() {
  const paused = userPaused || currentVideo().paused;
  control.setAttribute('aria-label', paused ? 'Включить фоновое видео' : 'Приостановить фоновое видео');
  control.setAttribute('aria-pressed', String(paused));
  control.querySelector('.control-icon').textContent = paused ? '▶' : 'Ⅱ';
  control.querySelector('.control-label').textContent = paused ? 'ПУСК' : 'ПАУЗА';
}
async function resume() {
  if (!canPlay()) return;
  try { await currentVideo().play(); } catch { /* Keep the poster when playback is blocked. */ }
  if (!canPlay()) currentVideo().pause();
  syncControl();
}
async function advance() {
  if (switching || !canPlay()) return;
  switching = true;
  const previous = currentVideo();
  const nextIndex = (activeIndex + 1) % videos.length;
  const next = videos[nextIndex];
  try {
    next.currentTime = 0;
    await next.play();
    if (!canPlay()) { next.pause(); switching = false; return; }
    activeIndex = nextIndex;
    next.classList.add('is-active');
    previous.classList.remove('is-active');
    syncControl();
    window.setTimeout(() => { previous.pause(); switching = false; }, 750);
  } catch {
    next.pause();
    // If one clip cannot load, retain a working background rather than a blank screen.
    previous.currentTime = 0;
    switching = false;
    resume();
  }
}
videos.forEach((video, index) => {
  video.muted = true;
  video.addEventListener('timeupdate', () => {
    if (index === activeIndex && Number.isFinite(video.duration) && video.duration - video.currentTime <= .8) advance();
  });
  video.addEventListener('ended', () => { if (index === activeIndex) advance(); });
  video.addEventListener('play', () => { if (index === activeIndex) syncControl(); });
  video.addEventListener('pause', () => { if (index === activeIndex) syncControl(); });
});
control.addEventListener('click', () => {
  if (currentVideo().paused) { userPaused = false; resume(); }
  else { userPaused = true; videos.forEach(video => video.pause()); syncControl(); }
});
function applyPreference() {
  control.hidden = reducedMotion.matches;
  if (reducedMotion.matches) videos.forEach(video => video.pause());
  else resume();
  syncControl();
}
reducedMotion.addEventListener('change', applyPreference);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) videos.forEach(video => video.pause());
  else resume();
});
applyPreference();

// Reveal project facts on scroll; content remains visible without JavaScript.
if ('IntersectionObserver' in window && !reducedMotion.matches) {
  document.documentElement.classList.add('motion-ready');
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
}

// Accessible preview tabs. Only the selected clip may keep playing.
const placementTabs = [...document.querySelectorAll('.placement-tabs [role="tab"]')];
function selectPlacement(index, moveFocus = false) {
  placementTabs.forEach((tab, position) => {
    const selected = position === index;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
    if (!selected) panel.querySelectorAll('video').forEach(video => video.pause());
  });
  if (moveFocus) placementTabs[index].focus();
}
placementTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectPlacement(index));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % placementTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + placementTabs.length) % placementTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = placementTabs.length - 1;
    else return;
    event.preventDefault();
    selectPlacement(next, true);
  });
});
