import { useEffect, useRef, useState } from 'preact/hooks';
import { DIETS, DIET_IDS } from '../lib/diet';
import { getAccessCode } from '../lib/places';
import { buildDeck, type Card } from '../lib/rank';
import { decide, inviteLink, joinRoom, leaveRoom, roomState, RoomGone, saveSession, startTimer, vote, type RoomView, type Session } from '../lib/room';
import { play } from '../lib/sound';
import type { AppData, DietId } from '../lib/types';
import { MEMBER_COLOURS, PickBoard, resetBoard, type Wanter } from './PickBoard';
import { CardFace } from './PlaceCard';
import { Button, Chip, Icon } from './ui';

const POLL_MS = 2500;
/** Faster polling while a countdown runs, so everyone sees taps land. */
const COUNTDOWN_POLL_MS = 1200;
const TICK_MS = 250;
const COUNTDOWN_S = 60;
const LEADERBOARD_SIZE = 2;
const NAME_KEY = 'eat-what:name';

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
  } catch {
    /* optional */
  }
}

// ---------- Join ----------

export function JoinScreen({ roomId, data, onJoined, onCancel }: { roomId: string; data: AppData; onJoined: (s: Session) => void; onCancel: () => void }) {
  const [name, setName] = useState(savedName());
  const [diets, setDiets] = useState<DietId[]>(data.prefs.diets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasCode = Boolean(getAccessCode());
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await joinRoom(roomId, name, diets);
      saveName(name);
      const s = { roomId, token: res.token };
      saveSession(s);
      onJoined(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
      setBusy(false);
    }
  };
  return (
    <section class="start room-join">
      <h2 class="h-sm">Pick together</h2>
      <p class="lede">
        You're joining session <strong class="room-code">{roomId}</strong>. Everyone taps the places they fancy on the same photo board — you'll see each other's picks live.
      </p>
      <form class="join-form" onSubmit={submit}>
        <label class="field-label" for="join-name">
          Your name
        </label>
        <input id="join-name" class="text-input" placeholder="e.g. Aina" maxLength={24} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <p class="field-label">I don't eat… (optional)</p>
        <div class="chip-row">
          {DIET_IDS.map((d) => (
            <Chip key={d} selected={diets.includes(d)} onClick={() => setDiets(diets.includes(d) ? diets.filter((x) => x !== d) : [...diets, d])}>
              {DIETS[d].label}
            </Chip>
          ))}
        </div>
        <p class="muted small">{hasCode ? "You have an access code, so you'll join straight away." : 'The host will need to let you in — it takes a tap on their side.'}</p>
        {error && (
          <p class="field-error" role="alert">
            {error}
          </p>
        )}
        <div class="action-main">
          <Button variant="primary" size="lg" type="submit" icon="people" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </Button>
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Not now
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---------- In a room ----------

interface Props {
  session: Session;
  data: AppData;
  toast: (m: string) => void;
  onExit: () => void;
}

type Approved = Extract<RoomView, { status: 'approved' }>;

export function RoomScreen({ session, data, toast, onExit }: Props) {
  const [view, setView] = useState<Approved | Exclude<RoomView, Approved> | null>(null);
  const [offline, setOffline] = useState(false);
  /** My taps not yet confirmed by the server (placeId → 'yes' or null for un-tap). */
  const [optimistic, setOptimistic] = useState<Record<string, 'yes' | null>>({});
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [, setTick] = useState(0);
  /** Server clock minus phone clock, so everyone's countdown ends together. */
  const clockOffset = useRef(0);
  const celebrated = useRef<string | null>(null);
  const alive = useRef(true);

  const refresh = async () => {
    try {
      const v = await roomState(session);
      if (!alive.current) return;
      if (v.status === 'approved') clockOffset.current = v.now - Date.now();
      setView(v);
      setOffline(false);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof RoomGone) {
        saveSession(null);
        toast('That session has ended.');
        onExit();
      } else setOffline(true);
    }
  };

  const deadline = view?.status === 'approved' ? view.deadline : null;
  const counting = Boolean(deadline && !(view?.status === 'approved' && view.decided));

  useEffect(() => resetBoard(), []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = window.setInterval(() => document.visibilityState === 'visible' && refresh(), counting ? COUNTDOWN_POLL_MS : POLL_MS);
    // Coming back to the app (e.g. from WhatsApp after sharing the link): update right away.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session.token, counting]);

  // Countdown: re-render a few times a second; fetch the result the moment it hits zero.
  useEffect(() => {
    if (!counting || !deadline) return;
    const t = window.setInterval(() => {
      setTick((n) => n + 1);
      if (Date.now() + clockOffset.current >= deadline) {
        clearInterval(t);
        refresh();
      }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [counting, deadline]);

  const decidedId = view?.status === 'approved' ? view.decided : null;
  useEffect(() => {
    if (!decidedId) celebrated.current = null;
    else if (celebrated.current !== decidedId) {
      celebrated.current = decidedId;
      setShowBoard(false);
      play(data.prefs.sound, 'celebrate');
      navigator.vibrate?.(30);
    }
  }, [decidedId]);

  const exit = async () => {
    try {
      await leaveRoom(session);
    } catch {
      /* leaving anyway */
    }
    saveSession(null);
    onExit();
  };

  if (!view) return <p class="status">Joining the table…</p>;

  if (view.status === 'pending') {
    return (
      <section class="start">
        <div class="waiting-dot" aria-hidden="true" />
        <h2 class="h-sm">Waiting for {view.hostName}</h2>
        <p class="lede">They'll get a tap to let you in. This page updates by itself.</p>
        <Button variant="secondary" onClick={exit}>
          Cancel
        </Button>
      </section>
    );
  }
  if (view.status !== 'approved') {
    return (
      <section class="start">
        <h2 class="h-sm">Not this time</h2>
        <p class="lede">{view.hostName} didn't let you into this session.</p>
        <Button
          variant="primary"
          onClick={() => {
            saveSession(null);
            onExit();
          }}
        >
          Back to picking solo
        </Button>
      </section>
    );
  }

  const approved = view.members.filter((m) => m.status === 'approved');
  const pending = view.members.filter((m) => m.status === 'pending');
  const others = approved.filter((m) => m.id !== view.you.id);
  const me = view.you.id;

  // Everyone's diets apply to everyone's board; budget is left open for the group.
  const roomData: AppData = {
    ...data,
    prefs: { ...data.prefs, budget: null, showClosed: true, diets: view.members.find((m) => m.id === me)?.diets ?? data.prefs.diets },
    group: others.map((m) => ({ id: m.id, name: m.name, diets: m.diets, budget: null })),
  };
  const order = new Map(view.list.map((r, i) => [r.id, i]));
  const deck = buildDeck(view.list, roomData, view.roomId, new Date()).cards.sort((a, b) => (order.get(a.r.id) ?? 0) - (order.get(b.r.id) ?? 0));
  const mine = view.members.find((m) => m.id === me)?.diets ?? data.prefs.diets;
  const diets = [...new Set([...mine, ...others.flatMap((m) => m.diets)])];

  // Who wants what, with my unconfirmed taps applied on top.
  const wanterOf = new Map<string, Wanter>(
    approved.map((m, i) => [m.id, { id: m.id, name: m.id === me ? 'You' : m.name, initial: (m.name.trim()[0] ?? '?').toUpperCase(), colour: MEMBER_COLOURS[i % MEMBER_COLOURS.length] }]),
  );
  const yesOf = (placeId: string) => {
    const yes = (view.tally[placeId]?.yes ?? []).filter((id) => id !== me);
    const myTap = placeId in optimistic ? optimistic[placeId] : view.myVotes[placeId] === 'yes' ? 'yes' : null;
    return myTap === 'yes' ? [me, ...yes] : yes;
  };
  const wanters = new Map(deck.map((c) => [c.r.id, yesOf(c.r.id).flatMap((id) => wanterOf.get(id) ?? [])]));
  const wanted = new Set(deck.filter((c) => yesOf(c.r.id).includes(me)).map((c) => c.r.id));
  // Leaderboard: most taps first, ties to the better-ranked (earlier) place — same rule as the server.
  const board = deck
    .map((c) => ({ c, n: yesOf(c.r.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || (order.get(a.c.r.id) ?? 0) - (order.get(b.c.r.id) ?? 0));
  const everyone = approved.length > 1 ? board.find((x) => x.n === approved.length) : undefined;
  const decided = view.decided ? deck.find((c) => c.r.id === view.decided) ?? null : null;
  const secondsLeft = counting && deadline ? Math.max(0, Math.ceil((deadline - Date.now() - clockOffset.current) / 1000)) : null;

  const toggle = (c: Card) => {
    if (decided) return;
    const on = !wanted.has(c.r.id);
    play(data.prefs.sound, on ? 'reveal' : 'skip');
    setOptimistic((o) => ({ ...o, [c.r.id]: on ? 'yes' : null }));
    const settle = () =>
      setOptimistic((o) => {
        const { [c.r.id]: _, ...rest } = o;
        return rest;
      });
    vote(session, c.r.id, on ? 'yes' : null)
      .then(refresh)
      .catch((err) => toast(err instanceof Error && !err.message.startsWith('Connection') ? err.message : "Couldn't save that tap — check your connection."))
      .finally(settle);
  };

  const go = (seconds = COUNTDOWN_S) =>
    startTimer(session, seconds)
      .then(() => {
        setShowBoard(true);
        return refresh();
      })
      .catch((err) => toast(err instanceof Error ? err.message : "Couldn't start the countdown."));

  const invite = async () => {
    const link = inviteLink(view.roomId);
    const text = `Help pick where we eat — join my Eat What? session (${view.roomId})`;
    try {
      if (navigator.share) await navigator.share({ title: 'Eat What?', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}: ${link}`);
        toast('Invite link copied');
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const decidedFor = decided ? (wanters.get(decided.r.id) ?? []).map((w) => w.name) : [];

  return (
    <div class="room">
      <div class="room-bar">
        <span class="room-who">
          <strong class="room-code">{view.roomId}</strong>
          <span class="avatars avatars-inline" aria-label={`${approved.length} ${approved.length === 1 ? 'person' : 'people'}: ${approved.map((m) => m.name).join(', ')}`}>
            {approved.map((m) => {
              const w = wanterOf.get(m.id)!;
              return (
                <span key={m.id} class="avatar" style={{ background: w.colour }} title={m.name} aria-hidden="true">
                  {w.initial}
                </span>
              );
            })}
          </span>
        </span>
        <button type="button" class="pill" onClick={invite}>
          <Icon name="plus" size={15} /> Invite
        </button>
        <button type="button" class="icon-btn" aria-label="Leave session" onClick={exit}>
          <Icon name="x" size={18} />
        </button>
      </div>

      {view.you.host && pending.length > 0 && (
        <ul class="requests" aria-label="People waiting to join">
          {pending.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong> wants to join
              </span>
              <Button size="sm" variant="primary" onClick={() => decide(session, m.id, true).then(refresh)}>
                Let in
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide(session, m.id, false).then(refresh)}>
                No
              </Button>
            </li>
          ))}
        </ul>
      )}
      {offline && <p class="notice notice-warn">Connection problem — trying again…</p>}

      {decided && !showBoard ? (
        <section class="deck-area">
          <div class="stack">
            <article class="card is-chosen">
              <CardFace card={decided} diets={diets} stamp="Decided!" />
            </article>
          </div>
          <p class="remaining">{decidedFor.length ? `Wanted by ${decidedFor.join(', ')}` : 'The group has decided.'}</p>
          <div class="action-main chosen-actions">
            <a class="btn btn-primary btn-lg" href={decided.r.mapsUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="map" size={22} />
              <span>Take us there</span>
            </a>
            <Button variant="secondary" size="lg" icon="grid" onClick={() => setShowBoard(true)}>
              See the board
            </Button>
          </div>
          {view.you.host && (
            <p class="chosen-links">
              <button type="button" class="link small" onClick={() => go()}>
                Not feeling it? Another {COUNTDOWN_S}-second round
              </button>
            </p>
          )}
        </section>
      ) : (
        <>
          <PickBoard cards={deck} diets={diets} wanted={wanted} onToggle={toggle} wanters={wanters} locked={Boolean(decided)} />
          <div class={`tray tray-room ${secondsLeft !== null ? 'is-counting' : ''}`} role="region" aria-label="Group picks">
            {everyone && !decided && dismissedMatch !== everyone.c.r.id ? (
              <div class="tray-match">
                <p class="tray-lead">
                  🎉 <strong>Everyone wants {everyone.c.r.name}</strong>
                </p>
                <div class="tray-actions">
                  <Button variant="ghost" size="sm" onClick={() => setDismissedMatch(everyone.c.r.id)}>
                    Keep looking
                  </Button>
                  <a class="btn btn-primary btn-sm" href={everyone.c.r.mapsUrl} target="_blank" rel="noopener noreferrer">
                    <Icon name="map" size={16} />
                    <span>Take us there</span>
                  </a>
                </div>
              </div>
            ) : (
              <>
                <ol class="leaders" aria-live="polite">
                  {board.length === 0 ? (
                    <li class="tray-hint">
                      <Icon name="heart" size={16} /> {others.length ? 'Tap every place you fancy' : 'Invite friends, then tap what you fancy'}
                    </li>
                  ) : (
                    board.slice(0, LEADERBOARD_SIZE).map((x, i) => (
                      <li key={x.c.r.id} class={i === 0 ? 'is-top' : ''}>
                        <span aria-hidden="true">{i === 0 ? '🔥' : '·'}</span> <strong>{x.c.r.name}</strong> {x.n}/{approved.length}
                      </li>
                    ))
                  )}
                </ol>
                {decided ? (
                  <Button variant="primary" size="sm" onClick={() => setShowBoard(false)}>
                    Decided: {decided.r.name}
                  </Button>
                ) : secondsLeft !== null ? (
                  <span class="countdown" role="timer" aria-label={`${secondsLeft} seconds left`}>
                    {secondsLeft}
                    <small>s</small>
                  </span>
                ) : view.you.host ? (
                  <Button variant="primary" size="sm" icon="clock" onClick={() => go()} disabled={board.length === 0}>
                    {COUNTDOWN_S}s — go!
                  </Button>
                ) : (
                  <span class="muted small tray-wait">{view.hostName} starts the clock</span>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
