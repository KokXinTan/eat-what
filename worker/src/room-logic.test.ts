import { describe, expect, it } from 'vitest';
import { createRoom, decide, join, leave, matches, MAX_MEMBERS, RoomError, view, vote } from './room-logic';

const NOW = 1_800_000_000_000;
const LIST = [
  { id: 'g:a', name: 'Nasi Lemak Corner' },
  { id: 'g:b', name: 'Shin Zushi SS2' },
];

function room() {
  return createRoom('ABC234', { name: 'Kok', diets: ['halal', 'keto'], list: LIST }, 'host-token', 'host', NOW);
}

describe('joining', () => {
  it('lets people with an access code straight in', () => {
    const s = room();
    const m = join(s, { name: 'Aina' }, true, 't1', 'm1', NOW);
    expect(m.status).toBe('approved');
  });

  it('makes people without a code wait for the host, and shows them nothing', () => {
    const s = room();
    join(s, { name: 'Ben' }, false, 't2', 'm2', NOW);
    const v = view(s, 't2');
    expect(v).toEqual({ status: 'pending', hostName: 'Kok', roomId: 'ABC234' });
    expect(() => vote(s, 't2', 'g:a', 'yes')).toThrow(RoomError);
  });

  it('only the host can approve or deny', () => {
    const s = room();
    join(s, { name: 'Aina' }, true, 't1', 'm1', NOW);
    join(s, { name: 'Ben' }, false, 't2', 'm2', NOW);
    expect(() => decide(s, 't1', 'm2', true)).toThrow(/Only the host/);
    decide(s, 'host-token', 'm2', true);
    expect(view(s, 't2').status).toBe('approved');
    decide(s, 'host-token', 'm2', false);
    expect(view(s, 't2').status).toBe('denied');
  });

  it('shows pending requests to the host only', () => {
    const s = room();
    join(s, { name: 'Aina' }, true, 't1', 'm1', NOW);
    join(s, { name: 'Ben' }, false, 't2', 'm2', NOW);
    const hostView = view(s, 'host-token');
    const ainaView = view(s, 't1');
    if (hostView.status !== 'approved' || ainaView.status !== 'approved') throw new Error('expected approved views');
    expect(hostView.members.map((m) => m.name)).toEqual(['Kok', 'Aina', 'Ben']);
    expect(ainaView.members.map((m) => m.name)).toEqual(['Kok', 'Aina']);
  });

  it('caps the room size and cleans names and diets', () => {
    const s = room();
    expect(s.members[0].diets).toEqual(['halal']); // unknown "keto" dropped
    const m = join(s, { name: '   a very very very long name that keeps going  ' }, true, 't', 'm', NOW);
    expect(m.name.length).toBeLessThanOrEqual(24);
    for (let i = 0; i < MAX_MEMBERS; i++) {
      try {
        join(s, {}, true, `x${i}`, `x${i}`, NOW);
      } catch {
        /* full */
      }
    }
    expect(() => join(s, {}, true, 'late', 'late', NOW)).toThrow(/full/);
  });

  it('rejects strangers without a member token', () => {
    const s = room();
    expect(() => view(s, 'nope')).toThrow(/Not a member/);
  });
});

describe('voting and matches', () => {
  it('finds a match only when every approved member said yes', () => {
    const s = room();
    join(s, { name: 'Aina' }, true, 't1', 'm1', NOW);
    join(s, { name: 'Ben' }, false, 't2', 'm2', NOW); // pending: doesn't block matches
    vote(s, 'host-token', 'g:a', 'yes');
    expect(matches(s)).toEqual([]);
    vote(s, 't1', 'g:a', 'yes');
    vote(s, 't1', 'g:b', 'yes');
    vote(s, 'host-token', 'g:b', 'no');
    expect(matches(s)).toEqual(['g:a']);
    const v = view(s, 't1');
    if (v.status !== 'approved') throw new Error('expected approved');
    expect(v.tally['g:b']).toEqual({ yes: ['m1'], no: 1 });
    expect(v.myVotes).toEqual({ 'g:a': 'yes', 'g:b': 'yes' });
  });

  it('a solo host never "matches" alone', () => {
    const s = room();
    vote(s, 'host-token', 'g:a', 'yes');
    expect(matches(s)).toEqual([]);
  });

  it('rejects votes on places not in the room', () => {
    const s = room();
    expect(() => vote(s, 'host-token', 'g:zzz', 'yes')).toThrow(/Unknown place/);
  });

  it('removes a leaver and their votes', () => {
    const s = room();
    join(s, { name: 'Aina' }, true, 't1', 'm1', NOW);
    vote(s, 't1', 'g:a', 'no');
    leave(s, 't1');
    expect(s.members.map((m) => m.id)).toEqual(['host']);
    expect(s.votes['g:a']).toEqual({});
  });

  it('refuses to create an empty room', () => {
    expect(() => createRoom('X', { list: [] }, 't', 'h', NOW)).toThrow(/needs some places/);
  });
});
