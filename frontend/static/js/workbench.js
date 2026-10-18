import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import { createElement, Compass, Plus, Download, Printer, Save, Trash2, LockKeyhole, LogOut, ExternalLink, MapPin, Clock, X, ArrowRight } from 'lucide';
import { z } from 'zod';
import { compileTrip, tripSchema, exportMarkdown } from './engine.js';
import '../css/workbench.css';

const BASE = import.meta.env.BASE_URL;
const STORAGE = 'travelbrain.trips.v1';
const secureURL = z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; });
const activitySchema = z.object({ id: z.string().max(30), title: z.string().max(150), time: z.string().max(8), category: z.string().max(30), cost_minor: z.number().int().nonnegative(), duration_minutes: z.number().int().positive(), detail: z.string().max(500), source: secureURL, access_review: z.boolean() });
const planSchema = z.object({ id: z.uuid(), revision: z.number().int().positive(), created_at: z.string().max(60), request: tripSchema, destination: z.string().max(80), country: z.string().max(80), timezone: z.string().max(80), catalog_version: z.string().max(30), days: z.array(z.object({ date: z.iso.date(), number: z.number().int(), activities: z.array(activitySchema).max(3), free_time: z.string().max(500) })).max(10), budget: z.object({ currency: z.enum(['EUR', 'USD', 'GBP']), lines: z.array(z.object({ label: z.string().max(100), amount_minor: z.number().int().nonnegative(), basis: z.string().max(250) })).max(8), total_minor: z.number().int().nonnegative(), remaining_minor: z.number().int(), over_budget: z.boolean() }), sources: z.array(secureURL).max(36), warnings: z.array(z.string().max(600)).max(20), ai_notes: z.object({ overview: z.string().max(1000), tips: z.array(z.string().max(400)).max(5), label: z.string().max(200), provider: z.string().max(50), model: z.string().max(100) }).nullable(), weather: z.object({ status: z.string().max(50), days: z.array(z.object({ date: z.iso.date(), low_c: z.number().finite(), high_c: z.number().finite(), rain_percent: z.number().min(0).max(100) })).max(10), source: secureURL }).passthrough(), flights: z.object({ status: z.string(), detail: z.string().max(500) }), hotels: z.object({ status: z.string(), detail: z.string().max(500) }) }).passthrough();
const placeSchema = z.object({ name: z.string().max(80), country: z.string().max(80), timezone: z.string().max(80), latitude: z.number().finite(), longitude: z.number().finite(), night_eur: z.number().int().positive(), source: secureURL, activities: z.array(z.tuple([z.string().max(150), z.enum(['history', 'art', 'food', 'outdoors']), z.number().int().nonnegative(), secureURL, z.boolean()])).max(12) });
const catalogSchema = z.object({ version: z.string(), destinations: z.object({ paris: placeSchema, lisbon: placeSchema, kyoto: placeSchema }) });
let catalog, samples, current, saved = [], token = '', serverSaved = false, view = 'Itinerary', busy = false;
let capabilities = { private_api: false, ai: false, weather: false };

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (['value', 'checked', 'disabled', 'open'].includes(key)) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function command(label, icon, action, extra = {}) {
  return element('button', { type: 'button', class: 'icon-button', title: label, 'aria-label': label, onClick: action, ...extra }, createElement(icon));
}
function link(text, href) { return element('a', { href: secureURL.parse(href), target: '_blank', rel: 'noreferrer' }, text, createElement(ExternalLink)); }
const money = value => new Intl.NumberFormat('en', { style: 'currency', currency: current.budget.currency, maximumFractionDigits: 2 }).format(value / 100);
const dateLabel = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { ...options, signal: AbortSignal.timeout(45000), headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  if (!response.ok) throw new Error(response.status === 401 ? 'Owner authentication failed.' : response.status === 409 ? 'This trip changed. Reopen it before saving.' : response.status === 502 ? 'The optional provider failed or is not configured. No trip was saved.' : `Request failed (${response.status}).`);
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length > 2000000) throw new Error('Response exceeds the workspace limit.');
  return JSON.parse(text);
}
function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function localTrips() {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return [];
  if (raw.length > 2000000) throw new Error('Saved browser data exceeds the workspace limit.');
  return z.array(planSchema).max(20).parse(JSON.parse(raw));
}
async function loadHistory() {
  saved = token ? await json('api/trips') : localTrips();
  renderHistory();
}

const status = element('p', { class: 'status-message', role: 'status', 'aria-live': 'polite' });
const main = element('main', { id: 'trip', class: 'workspace', 'aria-label': 'Trip workspace' });
const history = element('div', { class: 'history' });
const mode = element('span', { class: 'mode' }, 'Browser workspace');
const connectButton = command('Connect private planner', LockKeyhole, () => { dialog.showModal(); tokenInput.focus(); });
const form = element('form', { id: 'trip-form', onSubmit: event => { event.preventDefault(); build(); } });
const fields = {};
function field(label, name, type, attributes = {}) {
  const input = element('input', { id: name, name, type, ...attributes });
  fields[name] = input;
  return element('label', { class: 'field', for: name }, element('span', {}, label), input);
}
function select(label, name, options) {
  const input = element('select', { id: name, name }, options.map(([value, text]) => element('option', { value }, text)));
  fields[name] = input;
  return element('label', { class: 'field', for: name }, element('span', {}, label), input);
}
const interests = element('fieldset', { class: 'interests' }, element('legend', {}, 'Interests'), ['history', 'art', 'food', 'outdoors'].map(name => element('label', {}, element('input', { type: 'checkbox', name: 'interest', value: name }), name[0].toUpperCase() + name.slice(1))));
const stepFree = field('Prefer step-free options', 'step_free', 'checkbox');
const ai = field('AI travel notes', 'ai', 'checkbox', { disabled: true });
const weather = field('Live weather', 'live_weather', 'checkbox', { disabled: true });
const notes = element('textarea', { id: 'notes', name: 'notes', rows: 2, maxlength: 600 });
fields.notes = notes;
const buildButton = element('button', { class: 'primary', type: 'submit' }, 'Build itinerary', createElement(ArrowRight));
form.append(select('Destination', 'destination', [['paris', 'Paris, France'], ['lisbon', 'Lisbon, Portugal'], ['kyoto', 'Kyoto, Japan']]), field('Traveling from (optional)', 'origin', 'text', { maxlength: 80, placeholder: 'Your departure city' }), field('Start date', 'start_date', 'date', { required: true, min: '2000-01-01', max: '2100-12-31' }), element('div', { class: 'field-row' }, field('Days', 'days', 'number', { min: 1, max: 10, required: true }), field('Travelers', 'travelers', 'number', { min: 1, max: 8, required: true })), element('div', { class: 'field-row' }, field('Trip budget', 'budget', 'text', { inputmode: 'decimal', required: true, pattern: '[0-9]+([.][0-9]{1,2})?', maxlength: 12 }), select('Currency', 'currency', [['EUR', 'EUR'], ['USD', 'USD'], ['GBP', 'GBP']])), select('Pace', 'pace', [['relaxed', 'Relaxed'], ['balanced', 'Balanced'], ['busy', 'Busy']]), interests, stepFree, element('label', { class: 'field', for: 'notes' }, element('span', {}, 'Personal notes'), notes), element('div', { class: 'provider-options' }, ai, weather), buildButton);
fields.destination.addEventListener('change', () => { form.dataset.excluded = '[]'; });
const details = element('details', { class: 'trip-details', open: innerWidth >= 900 }, element('summary', {}, 'Trip details'), form);
const sidebar = element('aside', { class: 'sidebar' }, details, element('section', { class: 'saved-section' }, element('div', { class: 'section-heading' }, element('h2', {}, 'Saved trips'), element('span', { id: 'history-scope' }, 'This browser')), history));
const tokenInput = element('input', { id: 'owner-token', type: 'password', autocomplete: 'off', minlength: 32, maxlength: 256, required: true });
const dialogError = element('p', { role: 'alert', class: 'error' });
const dialog = element('dialog', {}, element('div', { class: 'dialog-heading' }, element('h2', {}, 'Private planner'), command('Close connection dialog', X, () => dialog.close())), element('form', { onSubmit: async event => { event.preventDefault(); token = tokenInput.value; try { if (!capabilities.private_api) throw new Error('Private planning is not enabled on this site.'); await loadHistory(); mode.textContent = 'Private owner workspace'; connectButton.replaceWith(disconnectButton); fields.ai.disabled = !capabilities.ai; fields.live_weather.disabled = !capabilities.weather; buildButton.firstChild.textContent = 'Build & save'; dialog.close(); message('Connected to the private planner.'); } catch (error) { token = ''; dialogError.textContent = error.message; } } }, element('label', { class: 'field', for: 'owner-token' }, element('span', {}, 'Owner token'), tokenInput), dialogError, element('button', { class: 'primary', type: 'submit' }, 'Connect')));
dialog.addEventListener('close', () => { tokenInput.value = ''; dialogError.textContent = ''; });
const disconnectButton = command('Disconnect private planner', LogOut, async () => { token = ''; serverSaved = false; mode.textContent = 'Browser workspace'; disconnectButton.replaceWith(connectButton); fields.ai.disabled = true; fields.live_weather.disabled = true; fields.ai.checked = false; fields.live_weather.checked = false; buildButton.firstChild.textContent = 'Build itinerary'; current = structuredClone(samples[0]); fillForm(current.request); render(); try { await loadHistory(); } catch { saved = []; renderHistory(); } message('Disconnected. Private data and token were cleared from this view.'); });

function fillForm(request) {
  for (const [name, input] of Object.entries(fields)) {
    if (name === 'budget') input.value = (request.budget_minor / 100).toFixed(2);
    else if (input.type === 'checkbox') input.checked = Boolean(request[name]);
    else input.value = request[name] ?? '';
  }
  for (const input of interests.querySelectorAll('input')) input.checked = request.interests.includes(input.value);
  form.dataset.excluded = JSON.stringify(request.excluded_ids);
}
function readForm() {
  const [whole, fraction = ''] = fields.budget.value.split('.');
  return tripSchema.parse({ destination: fields.destination.value, origin: fields.origin.value,
    start_date: fields.start_date.value, days: Number(fields.days.value), travelers: Number(fields.travelers.value),
    budget_minor: Number(whole) * 100 + Number(fraction.padEnd(2, '0')), currency: fields.currency.value,
    pace: fields.pace.value, interests: [...interests.querySelectorAll('input:checked')].map(input => input.value),
    step_free: fields.step_free.checked, notes: fields.notes.value, ai: fields.ai.checked,
    live_weather: fields.live_weather.checked, excluded_ids: JSON.parse(form.dataset.excluded || '[]') });
}
async function build(save = false) {
  if (busy || !form.reportValidity()) return;
  busy = true;
  const disabledBefore = [...document.querySelectorAll('button,input,select,textarea')].map(node => [node, node.disabled]);
  for (const [node] of disabledBefore) node.disabled = true;
  main.setAttribute('aria-busy', 'true'); message('Building your itinerary...');
  try {
    const request = readForm();
    if (token) {
      const path = serverSaved ? `api/trips/${current.id}` : 'api/trips';
      current = planSchema.parse(await json(path, { method: serverSaved ? 'PUT' : 'POST', body: JSON.stringify(serverSaved ? { expected_revision: current.revision, request } : request) }));
      serverSaved = true;
      await loadHistory();
    } else {
      if (request.ai || request.live_weather) throw new Error('Optional providers require a connected private planner.');
      const previous = current;
      current = planSchema.parse(compileTrip(request, catalog));
      if (save) {
        const trips = localTrips();
        if (trips.some(trip => trip.id === previous.id)) { current.id = previous.id; current.revision = previous.revision + 1; }
        localStorage.setItem(STORAGE, JSON.stringify([current, ...trips.filter(trip => trip.id !== current.id)].slice(0, 20)));
        await loadHistory();
      }
    }
    render(); message(token ? 'Trip saved privately.' : save ? 'Trip saved in this browser.' : 'Itinerary ready. Costs are illustrative.');
    if (innerWidth < 900) details.open = false;
  } catch (error) { message(error instanceof z.ZodError ? 'Check dates, budget and interests. At least one interest is required.' : error.message, true); }
  finally { busy = false; for (const [node, disabled] of disabledBefore) if (node.isConnected) node.disabled = disabled; main.removeAttribute('aria-busy'); }
}
function renderHistory() {
  document.getElementById('history-scope').textContent = token ? 'Private server' : 'This browser';
  history.replaceChildren(...(saved.length ? saved.map(trip => element('div', { class: 'history-row' }, element('button', { type: 'button', onClick: async () => { if (busy) return; try { current = planSchema.parse(token ? await json(`api/trips/${trip.id}`) : structuredClone(trip)); serverSaved = Boolean(token); fillForm(current.request); render(); message('Saved trip reopened.'); } catch (error) { message(error.message, true); } } }, element('strong', {}, trip.destination), element('span', {}, trip.start_date || trip.request.start_date)), command(`Delete ${trip.destination} trip`, Trash2, async () => { if (!confirm('Delete this saved trip?')) return; try { if (token) await json(`api/trips/${trip.id}`, { method: 'DELETE' }); else localStorage.setItem(STORAGE, JSON.stringify(localTrips().filter(item => item.id !== trip.id))); if (current.id === trip.id) serverSaved = false; await loadHistory(); message('Saved trip deleted.'); } catch (error) { message(error.message, true); } }))) : [element('p', { class: 'muted' }, 'No saved trips.') ]));
}
function download(kind) {
  const blob = new Blob([kind === 'json' ? JSON.stringify(current, null, 2) : exportMarkdown(current)], { type: kind === 'json' ? 'application/json' : 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: `travelbrain-${current.request.destination}.${kind === 'json' ? 'json' : 'md'}` });
  anchor.click(); URL.revokeObjectURL(url); message('Trip export downloaded.');
}
function render() {
  const request = current.request;
  const tabbar = element('nav', { class: 'tabs', 'aria-label': 'Trip views' }, ['Itinerary', 'Budget', 'Travel & weather', 'Sources'].map(name => element('button', { type: 'button', role: 'tab', 'aria-selected': view === name, class: view === name ? 'active' : '', onClick: () => { view = name; render(); } }, name)));
  const content = element('section', { class: 'view-content', 'aria-label': view });
  if (view === 'Itinerary') {
    for (const day of current.days) {
      const activities = element('div', { class: 'activities' });
      for (const item of day.activities) {
        const body = element('div', { class: 'activity-body' },
          element('span', { class: 'category' }, item.category),
          element('h4', {}, item.title), element('p', {}, item.detail),
          element('div', { class: 'activity-meta' }, element('span', {}, '90 min'),
            element('span', {}, money(item.cost_minor), ' group allowance'), link('Source', item.source)));
        const exclude = command(`Exclude ${item.title}`, X, () => {
          if (busy) return;
          const excluded = JSON.parse(form.dataset.excluded || '[]');
          if (!excluded.includes(item.id)) excluded.push(item.id);
          form.dataset.excluded = JSON.stringify(excluded);
          build();
        });
        activities.append(element('article', { class: 'activity' },
          element('div', { class: 'activity-time' }, createElement(Clock), item.time), body, exclude));
      }
      activities.append(element('p', { class: 'free-time' }, day.free_time));
      const heading = element('div', { class: 'day-heading' },
        element('span', { class: 'day-number' }, String(day.number).padStart(2, '0')),
        element('div', {}, element('h3', {}, `Day ${day.number}`), element('span', { class: 'muted' }, dateLabel(day.date))));
      content.append(element('section', { class: 'day' }, heading, activities));
    }
  } else if (view === 'Budget') {
    const rows = element('tbody');
    for (const line of current.budget.lines) {
      rows.append(element('tr', {}, element('th', { scope: 'row' }, line.label),
        element('td', {}, line.basis), element('td', {}, money(line.amount_minor))));
    }
    const head = element('thead', {}, element('tr', {}, element('th', {}, 'Category'),
      element('th', {}, 'Basis'), element('th', {}, 'Group estimate')));
    const table = element('table', { class: 'budget-table' }, head, rows);
    const total = element('div', { class: `budget-total ${current.budget.over_budget ? 'over-budget' : ''}` },
      element('strong', {}, 'Estimated total'), element('strong', {}, money(current.budget.total_minor)));
    const balance = current.budget.over_budget ? `Over budget by ${money(-current.budget.remaining_minor)}.`
      : `${money(current.budget.remaining_minor)} remaining in your planning budget.`;
    content.append(element('h2', {}, 'Destination budget'),
      element('p', { class: 'muted' }, 'Illustrative allowances. Flights and booking charges are excluded.'),
      table, total, element('p', {}, balance));
  } else if (view === 'Travel & weather') {
    for (const [title, data] of [['Flights', current.flights], ['Accommodation', current.hotels]]) content.append(element('section', { class: 'essential' }, element('h2', {}, title), element('span', { class: 'category' }, data.status.replaceAll('_', ' ')), element('p', {}, data.detail)));
    content.append(element('section', { class: 'essential' }, element('h2', {}, 'Weather'), element('p', {}, current.weather.status === 'outside_forecast_window' ? 'Trip dates are outside the forecast window. No forecast is shown.' : current.weather.status === 'not_requested' ? 'No live forecast requested.' : 'Live forecast; conditions can change.'), current.weather.days.map(day => element('p', {}, `${day.date}: ${day.low_c} to ${day.high_c} C, ${day.rain_percent}% rain probability`)), link('Open-Meteo / CC BY 4.0', current.weather.source)));
  } else {
    content.append(element('h2', {}, 'Sources & limitations'), element('p', { class: 'muted' }, `Editorial catalog ${current.catalog_version}. Sources identify places, not verified prices, opening hours or accessibility.`), element('ul', { class: 'source-list' }, current.sources.map(source => element('li', {}, link(new URL(source).hostname, source)))), element('ul', { class: 'warnings' }, current.warnings.map(warning => element('li', {}, warning))), element('h3', {}, 'Personal notes'), element('p', { class: 'user-notes' }, request.notes || 'No personal notes.'));
  }
  if (current.ai_notes) content.append(element('section', { class: 'essential ai-notes' }, element('h2', {}, 'AI travel notes'), element('p', { class: 'muted' }, `${current.ai_notes.label} ${current.ai_notes.provider} / ${current.ai_notes.model}`), element('p', {}, current.ai_notes.overview), element('ul', {}, current.ai_notes.tips.map(tip => element('li', {}, tip)))));
  const imageCaption = element('span', { class: 'image-caption' }, current.destination);
  if (request.destination === 'lisbon') imageCaption.append(' / ', link('Utilisateur ouikipedia (CC BY 4.0)', 'https://commons.wikimedia.org/wiki/File:Panorama_of_Pra%C3%A7a_do_comercio.jpg'));
  main.replaceChildren(element('div', { class: 'workspace-heading' }, element('div', {}, element('p', { class: 'eyebrow' }, 'YOUR TRIP'), element('h1', {}, `${current.destination}, ${current.country}`)), element('div', { class: 'tools' }, command('Save trip', Save, () => build(true)), command('Download Markdown', Download, () => download('markdown')), command('Download JSON', Download, () => download('json')), command('Print trip', Printer, () => window.print()))), element('div', { class: `destination-banner ${request.destination}` }, element('img', { src: `${BASE}assets/${request.destination}.jpg`, alt: request.destination === 'paris' ? 'Eiffel Tower in Paris' : request.destination === 'lisbon' ? 'Praca do Comercio in Lisbon' : 'Kyoto cityscape' }), imageCaption), element('div', { class: 'trip-strip' }, element('span', {}, createElement(MapPin), `${request.days} days / ${request.travelers} travelers`), element('span', {}, `${dateLabel(request.start_date)} - ${dateLabel(current.days.at(-1).date)}`), element('span', { class: current.budget.over_budget ? 'over-budget' : '' }, money(current.budget.total_minor), ' estimated')), element('div', { class: 'estimate-label' }, 'Illustrative planning allowances. No bookings or live prices.'), tabbar, content);
}

document.getElementById('app').append(element('header', { class: 'topbar' }, element('a', { class: 'brand', href: BASE }, createElement(Compass), element('strong', {}, 'TravelBrain'), element('span', {}, 'Trip workbench')), element('div', { class: 'top-actions' }, mode, command('New trip', Plus, () => { if (busy) return; serverSaved = false; current = structuredClone(samples[0]); fillForm(current.request); view = 'Itinerary'; render(); message('New trip.'); }), connectButton)), element('div', { class: 'app-layout' }, sidebar, main), status, element('footer', {}, link('GPLv3 source & attribution', 'https://github.com/Sushant-Nemade/TravelBrain'), element('span', {}, 'Independent planning, not a booking service.'), element('a', { href: `${BASE}licenses.json` }, 'Asset & dependency notices')), dialog);

try {
  [catalog, samples] = await Promise.all([json('catalog.json').then(value => catalogSchema.parse(value)), json('demo.json').then(value => z.array(planSchema).length(3).parse(value))]);
  current = structuredClone(samples[0]); fillForm(current.request); render();
  try { await loadHistory(); } catch { message('Saved browser trips could not be read. Existing data was not deleted.', true); }
  try { capabilities = await json('api/config'); } catch { capabilities = { private_api: false, ai: false, weather: false }; }
} catch { main.replaceChildren(element('h1', {}, 'Workspace unavailable'), element('p', {}, 'The planning catalog could not be loaded.'), element('button', { type: 'button', onClick: () => location.reload() }, 'Retry')); }