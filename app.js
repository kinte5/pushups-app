const STORAGE_KEY = 'pushup-coach-v1';
const REST_SECONDS = 60;

const defaultState = {
  sessions: [],
  plan: { currentMax: 10, target: 20 },
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.sessions) || !saved.plan) return structuredClone(defaultState);
    return {
      sessions: saved.sessions.filter((session) =>
        session && Number.isFinite(session.count) && typeof session.date === 'string'
      ),
      plan: {
        currentMax: clampNumber(saved.plan.currentMax, 1, 200, 10),
        target: clampNumber(saved.plan.target, 2, 200, 20),
      },
    };
  } catch (error) {
    console.error('No se pudo leer el progreso guardado.', error);
    return structuredClone(defaultState);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

let state = loadState();
let activeView = 'train-view';
let activeMode = 'free';
let freeSession = null;
let planSession = null;
let freeTimer = null;
let restTimer = null;
let toastTimer = null;
let audioContext = null;
let audioWarningShown = false;
let speechWarningShown = false;

const $ = (id) => document.getElementById(id);

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('No se pudo guardar el progreso.', error);
    showToast('No se pudo guardar. Revisa el espacio disponible en el iPhone.');
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function prepareAudio() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    if (!audioWarningShown) showToast('Este navegador no permite reproducir los avisos sonoros.');
    audioWarningShown = true;
    return;
  }
  try {
    if (!audioContext) audioContext = new AudioContextConstructor();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((error) => {
        console.error('No se pudo activar el audio.', error);
      });
    }
  } catch (error) {
    console.error('No se pudo iniciar el audio.', error);
    if (!audioWarningShown) showToast('No se pudo activar el sonido. Revisa los ajustes del navegador.');
    audioWarningShown = true;
  }
}

function playTone(frequency = 720, duration = 0.055, volume = 0.12) {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime;
    const end = start + duration;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  } catch (error) {
    console.error('No se pudo reproducir el aviso sonoro.', error);
  }
}

function announce(message) {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
    if (!speechWarningShown) showToast('Este navegador no permite avisos por voz.');
    speechWarningShown = true;
    return;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'es-ES';
    utterance.rate = 1;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('No se pudo reproducir el aviso por voz.', error);
    if (!speechWarningShown) showToast('No se pudo activar la voz. Revisa los ajustes del navegador.');
    speechWarningShown = true;
  }
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todayLabel() {
  $('today-label').textContent = new Date().toLocaleDateString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function setView(viewId) {
  activeView = viewId;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === viewId));
  document.querySelectorAll('.nav-button').forEach((button) => {
    const selected = button.dataset.view === viewId;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (viewId === 'history-view') renderHistory();
  if (viewId === 'plan-view') renderPlanProgress();
}

function setMode(mode) {
  activeMode = mode;
  const freeSelected = mode === 'free';
  $('free-mode-button').classList.toggle('selected', freeSelected);
  $('free-mode-button').setAttribute('aria-selected', String(freeSelected));
  $('plan-mode-button').classList.toggle('selected', !freeSelected);
  $('plan-mode-button').setAttribute('aria-selected', String(!freeSelected));
  $('free-panel').classList.toggle('hidden', !freeSelected);
  $('plan-panel').classList.toggle('hidden', freeSelected);
  if (!freeSession && !planSession) {
    if (freeSelected) $('free-instruction').textContent = 'Toca el botón con la nariz al bajar';
    renderWorkout();
  }
}

function startFreeSession() {
  if (planSession) {
    showToast('Termina primero tu sesión del plan.');
    return;
  }
  prepareAudio();
  freeSession = { count: 0, startedAt: Date.now() };
  $('free-count').textContent = '0';
  $('free-time').textContent = '00:00';
  $('free-status').textContent = 'SESIÓN EN CURSO';
  $('free-status-dot').classList.add('running');
  $('free-instruction').textContent = 'Cada toque suma una push-up';
  $('free-tap').disabled = false;
  $('free-toggle').textContent = 'Terminar sesión';
  freeTimer = window.setInterval(() => {
    if (freeSession) $('free-time').textContent = formatDuration(Math.floor((Date.now() - freeSession.startedAt) / 1000));
  }, 250);
}

function stopFreeSession() {
  if (!freeSession) return;
  window.clearInterval(freeTimer);
  const session = {
    id: crypto.randomUUID(),
    mode: 'libre',
    count: freeSession.count,
    duration: Math.floor((Date.now() - freeSession.startedAt) / 1000),
    date: new Date().toISOString(),
  };
  freeSession = null;
  $('free-status').textContent = 'SESIÓN TERMINADA';
  $('free-status-dot').classList.remove('running');
  $('free-tap').disabled = true;
  $('free-toggle').textContent = 'Empezar sesión';
  if (session.count > 0) {
    state.sessions.unshift(session);
    saveState();
    showToast(`${session.count} push-ups guardadas en tu historial`);
    renderHistory();
  } else {
    showToast('Sesión terminada. La próxima vez sumamos repeticiones.');
  }
}

function countFreeRep() {
  if (!freeSession) return;
  freeSession.count += 1;
  $('free-count').textContent = String(freeSession.count);
  playTone();
  announce(String(freeSession.count));
}

function getTrainingCapacity(completedWorkouts) {
  const { currentMax, target } = state.plan;
  const progressPerWorkout = Math.max(1, Math.round(currentMax * 0.05));
  return Math.min(target, currentMax + completedWorkouts * progressPerWorkout);
}

function buildWorkout(completedWorkouts) {
  const workingCapacity = getTrainingCapacity(completedWorkouts);
  const setCount = Math.min(6, 3 + Math.ceil(completedWorkouts / 2));
  const effortBySet = [0.55, 0.75, 0.6, 0.55, 0.65, 0.55];
  return Array.from({ length: setCount }, (_, setIndex) =>
    Math.max(1, Math.round(workingCapacity * effortBySet[setIndex]))
  );
}

function completedPlanSessions() {
  return state.sessions.filter((session) => session.mode === 'plan' && !session.partial).length;
}

function renderWorkout() {
  const completed = completedPlanSessions();
  const sets = buildWorkout(completed);
  $('plan-day').textContent = `SESIÓN ${completed + 1}`;
  $('plan-summary').textContent = `Objetivo: ${state.plan.target} seguidas · ${REST_SECONDS} s entre series · deja 48 h para recuperarte`;
  $('set-indicator').innerHTML = sets.map((reps, index) =>
    `<span class="set-pill${index === 0 ? ' current' : ''}">SERIE ${index + 1} · ${reps}</span>`
  ).join('');
  $('plan-count').textContent = '0';
  $('plan-progress').textContent = `0 / ${sets[0]}`;
  $('plan-status').textContent = 'SERIES DE HOY';
  $('plan-instruction').textContent = 'Empieza cuando estés listo';
  $('plan-tap').disabled = true;
  $('plan-toggle').textContent = 'Empezar plan';
  $('rest-panel').classList.add('hidden');
  $('plan-status-dot').classList.remove('running');
}

function startPlanSession() {
  if (freeSession) {
    showToast('Termina primero tu sesión libre.');
    return;
  }
  prepareAudio();
  const sets = buildWorkout(completedPlanSessions());
  planSession = { sets, setIndex: 0, count: 0, total: 0, startedAt: Date.now() };
  $('plan-status').textContent = 'SESIÓN EN CURSO';
  $('plan-status-dot').classList.add('running');
  $('plan-tap').disabled = false;
  $('plan-toggle').textContent = 'Terminar sesión';
  $('plan-instruction').textContent = 'Toca una vez por cada push-up';
  updatePlanCounter();
  updateSetIndicator();
}

function updateSetIndicator() {
  if (!planSession) return;
  $('set-indicator').innerHTML = planSession.sets.map((reps, index) => {
    let status = '';
    if (index < planSession.setIndex) status = ' done';
    else if (index === planSession.setIndex) status = ' current';
    return `<span class="set-pill${status}">SERIE ${index + 1} · ${reps}</span>`;
  }).join('');
}

function updatePlanCounter() {
  if (!planSession) return;
  const target = planSession.sets[planSession.setIndex];
  $('plan-count').textContent = String(planSession.count);
  $('plan-progress').textContent = `${planSession.count} / ${target}`;
}

function countPlanRep() {
  if (!planSession) return;
  planSession.count += 1;
  planSession.total += 1;
  playTone();
  updatePlanCounter();
  if (planSession.count >= planSession.sets[planSession.setIndex]) completeSet();
}

function completeSet() {
  $('plan-tap').disabled = true;
  $('plan-instruction').textContent = '¡Serie completada!';
  playTone(950, 0.12, 0.16);
  planSession.setIndex += 1;
  updateSetIndicator();
  if (planSession.setIndex >= planSession.sets.length) {
    announce('Entrenamiento completado');
    finishPlanSession();
    return;
  }
  startRest();
}

function startRest() {
  let seconds = REST_SECONDS;
  $('rest-panel').classList.remove('hidden');
  $('rest-countdown').textContent = String(seconds);
  $('plan-status').textContent = 'DESCANSO';
  $('rest-message').textContent = 'RELÁJATE Y RECUPERA';
  announce('Descanso');
  restTimer = window.setInterval(() => {
    seconds -= 1;
    $('rest-countdown').textContent = String(Math.max(seconds, 0));
    if (seconds === 5) {
      $('rest-message').textContent = 'PREPÁRATE · 5 SEGUNDOS';
      announce('Prepárate');
    }
    if (seconds <= 5 && seconds > 0) playTone(850, 0.09, 0.16);
    if (seconds <= 0) {
      window.clearInterval(restTimer);
      $('rest-panel').classList.add('hidden');
      $('plan-status').textContent = 'SIGUIENTE SERIE';
      $('plan-instruction').textContent = '¡Vamos, tú puedes!';
      planSession.count = 0;
      $('plan-tap').disabled = false;
      updatePlanCounter();
      playTone(1100, 0.16, 0.18);
      announce('Empieza');
    }
  }, 1000);
}

function finishPlanSession() {
  if (!planSession) return;
  window.clearInterval(restTimer);
  const session = {
    id: crypto.randomUUID(),
    mode: 'plan',
    count: planSession.total,
    sets: planSession.sets,
    duration: Math.floor((Date.now() - planSession.startedAt) / 1000),
    date: new Date().toISOString(),
  };
  planSession = null;
  $('plan-status').textContent = '¡ENTRENAMIENTO COMPLETADO!';
  $('plan-status-dot').classList.remove('running');
  $('plan-instruction').textContent = '¡Buen trabajo! Tu progreso ya está guardado.';
  $('plan-tap').disabled = true;
  $('plan-toggle').textContent = 'Empezar otra sesión';
  $('plan-progress').textContent = `${session.count} repeticiones`;
  state.sessions.unshift(session);
  saveState();
  renderWorkout();
  renderPlanProgress();
  renderHistory();
  $('plan-status').textContent = '¡ENTRENAMIENTO COMPLETADO!';
  $('plan-instruction').textContent = '¡Buen trabajo! Tu progreso ya está guardado.';
  $('plan-progress').textContent = `${session.count} repeticiones`;
  showToast('¡Plan completado! Sesión guardada en tu historial.');
}

function stopPlanSession() {
  if (!planSession) return;
  window.clearInterval(restTimer);
  const session = {
    id: crypto.randomUUID(),
    mode: 'plan',
    count: planSession.total,
    sets: planSession.sets,
    duration: Math.floor((Date.now() - planSession.startedAt) / 1000),
    date: new Date().toISOString(),
    partial: true,
  };
  planSession = null;
  $('rest-panel').classList.add('hidden');
  $('plan-tap').disabled = true;
  $('plan-status-dot').classList.remove('running');
  if (session.count > 0) {
    state.sessions.unshift(session);
    saveState();
    showToast('Sesión parcial guardada. El próximo día retomas tu plan.');
  } else {
    showToast('Sesión cancelada.');
  }
  renderWorkout();
  renderHistory();
}

function renderPlanProgress() {
  const total = state.sessions.filter((session) => session.mode === 'plan' && !session.partial).length;
  const { currentMax, target } = state.plan;
  const level = getTrainingCapacity(total);
  const percent = Math.min(100, Math.round((level / target) * 100));
  $('current-max').value = String(state.plan.currentMax);
  $('target-max').value = String(state.plan.target);
  $('workout-count').textContent = `${total} ${total === 1 ? 'sesión' : 'sesiones'}`;
  $('progress-title').textContent = `Nivel estimado: ${level} de ${target}`;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-caption').textContent = `${total} sesiones completas · suben las repeticiones cada sesión y se añade una serie cada dos, hasta 6. Descansa 48 h entre entrenamientos.`;
}

function renderHistory() {
  const list = $('history-list');
  const totalReps = state.sessions.reduce((sum, session) => sum + session.count, 0);
  $('total-reps').textContent = String(totalReps);
  $('total-sessions').textContent = String(state.sessions.length);
  $('empty-history').classList.toggle('hidden', state.sessions.length > 0);
  $('clear-history').classList.toggle('hidden', state.sessions.length === 0);
  list.innerHTML = state.sessions.map((session) => {
    const label = session.mode === 'plan' ? (session.partial ? 'Plan · sesión parcial' : 'Plan diario') : 'Modo libre';
    const setDetail = session.sets ? ` · ${session.sets.length} series` : '';
    return `<article class="history-item">
      <div><div class="history-date">${escapeHtml(formatDate(session.date))}</div>
      <div class="history-detail">${label}${setDetail} · ${formatDuration(session.duration || 0)}</div></div>
      <div class="history-count">${session.count}<small> REP</small></div>
    </article>`;
  }).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});
$('free-mode-button').addEventListener('click', () => setMode('free'));
$('plan-mode-button').addEventListener('click', () => {
  setMode('plan');
});
$('free-toggle').addEventListener('click', () => freeSession ? stopFreeSession() : startFreeSession());
$('free-tap').addEventListener('click', countFreeRep);
$('plan-toggle').addEventListener('click', () => planSession ? stopPlanSession() : startPlanSession());
$('plan-tap').addEventListener('click', countPlanRep);

$('plan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (freeSession || planSession) {
    showToast('Termina tu sesión antes de cambiar el plan.');
    return;
  }
  const currentMax = clampNumber($('current-max').value, 1, 200, 0);
  const target = clampNumber($('target-max').value, 2, 200, 0);
  if (!currentMax || !target) {
    showToast('Ingresa valores entre 1 y 200 repeticiones.');
    return;
  }
  if (target <= currentMax) {
    showToast('El objetivo debe ser mayor que tu nivel actual.');
    return;
  }
  state.plan = { currentMax, target };
  saveState();
  renderWorkout();
  renderPlanProgress();
  $('plan-save-message').textContent = 'Plan actualizado. ¡A por ello!';
  window.setTimeout(() => { $('plan-save-message').textContent = ''; }, 2500);
});

$('clear-history').addEventListener('click', () => {
  if (!window.confirm('¿Borrar todo tu historial? Esta acción no se puede deshacer.')) return;
  state.sessions = [];
  saveState();
  renderHistory();
  renderPlanProgress();
  renderWorkout();
});

todayLabel();
renderWorkout();
renderPlanProgress();
renderHistory();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('No se pudo activar el modo sin conexión.', error);
    });
  });
}
