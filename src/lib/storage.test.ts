import { describe, expect, it } from 'vitest';
import { freshData, makeBackup, parseBackup } from './storage';
import type { AppData } from './types';

function sample(): AppData {
  const d = freshData();
  d.prefs = { diets: ['halal'], budget: 2, distance: 'walk', sound: true };
  d.picks = [{ id: 'p1', placeId: 'g:abc', name: 'Nasi Lemak Corner', food: 'Malaysian', art: 'nasiLemak', mapsUrl: 'https://maps.google.com/?cid=1', date: '2026-09-20T12:00:00.000Z', verdict: 'up' }];
  d.skips = [{ placeId: 'osm:node/1', date: '2026-09-21T12:00:00.000Z' }];
  d.group = [{ id: 'g1', name: 'Aina', diets: ['vegetarian'], budget: 1 }];
  return d;
}

describe('backup export & import', () => {
  it('round-trips an export exactly', () => {
    const d = sample();
    expect(parseBackup(makeBackup(d))).toEqual({ ok: true, data: d });
  });

  it('rejects non-JSON, other apps and other versions', () => {
    expect(parseBackup('nope {').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: 'other', data: {} })).ok).toBe(false);
    const r = parseBackup(JSON.stringify({ app: 'eat-what', data: { ...sample(), version: 1 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version/);
  });

  it('names the broken record', () => {
    const d = sample() as unknown as { picks: Record<string, unknown>[] };
    d.picks[0].verdict = 'meh';
    const r = parseBackup(JSON.stringify(d));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Pick #1/);
  });

  it('only accepts Google Maps links, so a backup cannot plant other URLs', () => {
    const d = sample();
    d.picks[0].mapsUrl = 'javascript:alert(1)';
    expect(parseBackup(JSON.stringify(d)).ok).toBe(false);
    d.picks[0].mapsUrl = 'https://evil.example/maps';
    expect(parseBackup(JSON.stringify(d)).ok).toBe(false);
  });

  it('rejects unknown diets, budgets and distances', () => {
    const base = sample();
    expect(parseBackup(JSON.stringify({ ...base, prefs: { ...base.prefs, diets: ['keto'] } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...base, prefs: { ...base.prefs, budget: 9 } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...base, prefs: { ...base.prefs, distance: 'fly' } })).ok).toBe(false);
  });

  it('fills safe defaults for missing optional parts', () => {
    const r = parseBackup(JSON.stringify({ version: 2 }));
    expect(r).toEqual({ ok: true, data: freshData() });
  });
});
