import { z } from 'zod';

export const tripSchema = z.object({
  destination: z.enum(['paris', 'lisbon', 'kyoto']), origin: z.string().trim().max(80),
  start_date: z.iso.date().refine(value => value >= '2000-01-01' && value <= '2100-12-31'),
  days: z.number().int().min(1).max(10), travelers: z.number().int().min(1).max(8),
  budget_minor: z.number().int().min(5000).max(100000000), currency: z.enum(['EUR', 'USD', 'GBP']),
  pace: z.enum(['relaxed', 'balanced', 'busy']), interests: z.array(z.enum(['history', 'art', 'food', 'outdoors'])).min(1).max(4),
  step_free: z.boolean(), notes: z.string().trim().max(600), ai: z.boolean(), live_weather: z.boolean(),
  excluded_ids: z.array(z.string().max(30)).max(36),
}).strict().refine(value => new Set(value.interests).size === value.interests.length)
  .refine(value => new Set(value.excluded_ids).size === value.excluded_ids.length)
  .refine(value => addDays(value.start_date, value.days - 1) <= '2100-12-31');

export function addDays(value, offset) {
  const result = new Date(`${value}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

export function compileTrip(input, document) {
  const request = tripSchema.parse(input);
  const place = document.destinations[request.destination];
  const amount = euros => euros * ({ EUR: 100, USD: 110, GBP: 85 }[request.currency]);
  const catalog = place.activities.map(([title, category, cost, source, accessible], index) => ({
    id: `${request.destination}-${index}`, title, category, cost_minor: amount(cost) * request.travelers,
    source, access_review: accessible,
  }));
  if (request.excluded_ids.some(id => !catalog.some(item => item.id === id))) throw new Error('Excluded activity is not in this destination.');
  const candidates = catalog.filter(item => !request.excluded_ids.includes(item.id) && (!request.step_free || item.access_review))
    .sort((left, right) => Number(!request.interests.includes(left.category)) - Number(!request.interests.includes(right.category)));
  const perDay = { relaxed: 1, balanced: 2, busy: 3 }[request.pace];
  const days = Array.from({ length: request.days }, (_, index) => ({
    date: addDays(request.start_date, index), number: index + 1,
    activities: candidates.slice(index * perDay, (index + 1) * perDay).map((item, position) => ({
      ...item, time: ['09:30', '13:00', '16:00'][position], duration_minutes: 90,
      detail: 'Flexible visit; check opening times, access and reservations at the source.',
    })), free_time: 'Unallocated time for meals, transfers and independent exploration.',
  }));
  const rooms = Math.ceil(request.travelers / 2);
  const lines = [
    { label: 'Accommodation', amount_minor: amount(place.night_eur) * Math.max(request.days - 1, 0) * rooms, basis: `${Math.max(request.days - 1, 0)} nights, ${rooms} room(s), illustrative nightly allowance` },
    { label: 'Meals', amount_minor: amount(40) * request.days * request.travelers, basis: 'Illustrative daily allowance per traveler; tastings are additional' },
    { label: 'Local transport', amount_minor: amount(12) * request.days * request.travelers, basis: 'Illustrative daily allowance per traveler, not route quotes' },
    { label: 'Activities and tastings', amount_minor: days.flatMap(day => day.activities).reduce((total, item) => total + item.cost_minor, 0), basis: 'Planning placeholders, not verified ticket prices' },
  ];
  lines.push({ label: 'Contingency', amount_minor: Math.ceil(lines.reduce((total, line) => total + line.amount_minor, 0) / 10), basis: '10% of the estimated subtotal, rounded up' });
  const total = lines.reduce((sum, line) => sum + line.amount_minor, 0);
  const warnings = [
    'All costs are illustrative planning allowances, not live prices or offers.',
    'Flights, intercity travel, insurance, taxes and booking charges are excluded.',
    'Opening hours, reservations, weather and route accessibility need independent confirmation.',
    'EUR/USD/GBP conversions use fixed illustrative ratios (1 / 1.10 / 0.85), not market exchange rates.',
    'Schedule slots allow breaks but are not a route or opening-hours feasibility guarantee.',
  ];
  if (request.step_free) warnings.push('Known stair-heavy options were excluded; step-free access is NOT independently verified.');
  if (candidates.length < request.days * perDay) warnings.push('The bounded catalog has fewer activities than requested slots; remaining time is deliberately unallocated.');
  if (request.start_date < new Date().toISOString().slice(0, 10)) warnings.push('The selected trip starts in the past.');
  if (total > request.budget_minor) warnings.push('Estimated destination costs exceed your budget; no costs were silently reduced.');
  if (request.notes) warnings.push('Free-text notes are retained for review; the deterministic planner does not interpret them as constraints.');
  return {
    id: crypto.randomUUID(), revision: 1, created_at: new Date().toISOString(), request,
    destination: place.name, country: place.country, timezone: place.timezone, catalog_version: document.version,
    days, budget: { currency: request.currency, lines, total_minor: total, remaining_minor: request.budget_minor - total, over_budget: total > request.budget_minor },
    sources: [...new Set(days.flatMap(day => day.activities.map(item => item.source)))].sort(), warnings, ai_notes: null,
    weather: { status: 'not_requested', days: [], source: 'https://open-meteo.com/' },
    flights: { status: 'unavailable', detail: 'No live flight fares or availability are provided. Arrange origin travel separately.' },
    hotels: { status: 'estimate_only', detail: 'Accommodation is a room/night allowance, not a property listing or availability check.' },
  };
}

export function exportMarkdown(plan) {
  const lines = [`# ${plan.destination} trip`, '', 'Planning reference; no booking or price guarantee.', ''];
  for (const day of plan.days) {
    lines.push(`## Day ${day.number} - ${day.date}`, ...day.activities.map(item => `- ${item.time}: ${item.title} (${item.source})`), day.free_time, '');
  }
  lines.push('## Budget', `Currency: ${plan.budget.currency} (illustrative)`, ...plan.budget.lines.map(line => `- ${line.label}: ${(line.amount_minor / 100).toFixed(2)}`), `Total: ${(plan.budget.total_minor / 100).toFixed(2)}`, '', '## Limitations', ...plan.warnings.map(warning => `- ${warning}`));
  return `${lines.join('\n')}\n`;
}