import { describe, expect, it } from 'vitest';
import { distanceM, fromOsm, openStatus } from './places';

const KL = { lat: 3.1478, lng: 101.6953 };

describe('OpenStreetMap parsing', () => {
  it('turns an OSM restaurant into a card-ready restaurant', () => {
    const r = fromOsm(
      { id: 42, type: 'node', lat: 3.149, lon: 101.696, tags: { amenity: 'restaurant', name: 'Restoran Pelita', cuisine: 'indian;malaysian', 'diet:halal': 'yes', 'addr:street': 'Jalan Ampang' } },
      KL,
    )!;
    expect(r.id).toBe('osm:node/42');
    expect(r.food).toBe('Indian');
    expect(r.art).toBe('curry');
    expect(r.summary).toMatch(/halal/);
    expect(r.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Restoran%20Pelita/);
    expect(r.distanceM).toBeGreaterThan(100);
    expect(r.rating).toBeNull();
  });

  it('uses the centre point of buildings and skips nameless places', () => {
    expect(fromOsm({ id: 1, type: 'way', center: { lat: 3.15, lon: 101.7 }, tags: { amenity: 'cafe', name: 'Kopi Kita' } }, KL)!.food).toBe('Café');
    expect(fromOsm({ id: 2, type: 'node', lat: 3.15, lon: 101.7, tags: { amenity: 'restaurant' } }, KL)).toBeNull();
  });

  it('reads vegetarian tags', () => {
    const v = fromOsm({ id: 3, type: 'node', lat: 3.15, lon: 101.7, tags: { amenity: 'restaurant', name: 'Leaf', 'diet:vegan': 'only' } }, KL)!;
    expect(v.types).toContain('vegan_restaurant');
  });

  it('measures distance sensibly', () => {
    expect(distanceM(KL, { lat: 3.1568, lng: 101.6953 })).toBeGreaterThan(990);
    expect(distanceM(KL, { lat: 3.1568, lng: 101.6953 })).toBeLessThan(1010);
  });
});

describe('open now from Google opening periods', () => {
  const MYT = 480; // Malaysia is UTC+8
  // Thursday 24 Sep 2026, 21:30 in Malaysia = 13:30 UTC
  const THU_930PM = new Date('2026-09-24T13:30:00Z');
  const daily = (oh: number, ch: number) =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: oh, minute: 0 }, close: { day: ch <= oh ? (d + 1) % 7 : d, hour: ch, minute: 0 } }));

  it('knows a place open 5pm–4am is open at 9:30pm, until 4 am', () => {
    expect(openStatus(daily(17, 4), MYT, THU_930PM)).toEqual({ open: true, until: 'until 4 am', minsLeft: 390 });
  });

  it('knows a lunch-only place is closed at night', () => {
    expect(openStatus(daily(11, 15), MYT, THU_930PM)).toEqual({ open: false });
  });

  it('handles 24-hour places and missing hours', () => {
    expect(openStatus([{ open: { day: 0, hour: 0, minute: 0 } }], MYT, THU_930PM)).toEqual({ open: true, until: '24 hours' });
    expect(openStatus(undefined, MYT, THU_930PM)).toEqual({ open: null });
  });

  it('handles a Saturday-night period that closes on Sunday', () => {
    const satLate = [{ open: { day: 6, hour: 18, minute: 0 }, close: { day: 0, hour: 2, minute: 30 } }];
    expect(openStatus(satLate, MYT, new Date('2026-09-26T17:00:00Z'))).toEqual({ open: true, until: 'until 2:30 am', minsLeft: 90 }); // Sun 1am MYT
  });
});
