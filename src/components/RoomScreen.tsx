import { useEffect, useRef, useState } from 'preact/hooks';
import { DIETS, DIET_IDS } from '../lib/diet';
import { getAccessCode } from '../lib/places';
import { buildDeck, type Card } from '../lib/rank';
import { decide, inviteLink, joinRoom, leaveRoom, roomState, RoomGone, saveSession, vote, type RoomView, type Session } from '../lib/room';
import { play } from '../lib/sound';
import type { AppData, DietId } from '../lib/types';
import { FoodArt } from './FoodArt';
import { CardFace, SwipeCard, type SwipeDir } from './SwipeCard';
import { Button, Chip, Icon } from './ui';

const POLL_MS = 2500;
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
      <h2 class="h-sm">Swipe together</h2>
      <p class="lede">
        You're joining session <strong class="room-code">{roomId}</strong>. Everyone swipes the same places; when you all like one, it's a match.
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

export function RoomScreen({ session, data, toast, onExit }: Props) {
  const [view, setView] = useState<RoomView | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingVotes, setPendingVotes] = useState<Record<string, 'yes' | 'no'>>({});
  const [seenMatches, setSeenMatches] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  const alive = useRef(true);

  const refresh = async () => {
    try {
      const v = await roomState(session);
      if (!alive.current) return;
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

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = window.setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    // Coming back to the app (e.g. from WhatsApp after sharing the link): update right away.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session.token]);

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

  if (view.status !== 'approved' && view.status === 'pending') {
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
          Back to solo swiping
        </Button>
      </section>
    );
  }

  const approved = view.members.filter((m) => m.status === 'approved');
  const pending = view.members.filter((m) => m.status === 'pending');
  const others = approved.filter((m) => m.id !== view.you.id);
  const myVotes = { ...view.myVotes, ...pendingVotes };

  // Everyone's diets apply to everyone's deck; budget is left open for the group.
  const roomData: AppData = {
    ...data,
    prefs: { ...data.prefs, budget: null, diets: view.members.find((m) => m.id === view.you.id)?.diets ?? data.prefs.diets },
    group: others.map((m) => ({ id: m.id, name: m.name, diets: m.diets, budget: null })),
  };
  const order = new Map(view.list.map((r, i) => [r.id, i]));
  const deck = buildDeck(view.list, roomData, view.roomId, new Date()).cards.sort((a, b) => (order.get(a.r.id) ?? 0) - (order.get(b.r.id) ?? 0));
  // My diets are the ones I chose when joining (stored in the room), plus everyone else's.
  const mine = view.members.find((m) => m.id === view.you.id)?.diets ?? data.prefs.diets;
  const diets = [...new Set([...mine, ...others.flatMap((m) => m.diets)])];
  const card: Card | undefined = deck.find((c) => !myVotes[c.r.id]);
  const nextCard = card ? deck.find((c) => !myVotes[c.r.id] && c !== card) : undefined;
  const newMatch = view.matches.find((id) => !seenMatches.includes(id));
  const matchCard = newMatch ? deck.find((c) => c.r.id === newMatch) : undefined;

  const swipe = (dir: SwipeDir) => {
    if (!card) return;
    const v = dir === 'right' ? 'yes' : 'no';
    play(data.prefs.sound, dir === 'right' ? 'reveal' : 'skip');
    setPendingVotes((p) => ({ ...p, [card.r.id]: v }));
    vote(session, card.r.id, v)
      .then(refresh)
      .catch(() => toast("Couldn't save that swipe — check your connection."));
  };

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

  const nameOf = (id: string) => view.members.find((m) => m.id === id)?.name ?? 'Someone';

  return (
    <div class="room">
      <div class="room-bar">
        <span class="room-who">
          <Icon name="people" size={16} /> <strong class="room-code">{view.roomId}</strong> · {approved.length} {approved.length === 1 ? 'person' : 'people'}
        </span>
        <button type="button" class="pill" onClick={invite}>
          <Icon name="plus" size={15} /> Invite
        </button>
        <button type="button" class="pill" onClick={() => setShowResults((x) => !x)} aria-pressed={showResults}>
          <Icon name="check" size={15} /> Votes
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

      {matchCard ? (
        <section class="deck-area">
          <div class="stack">
            <article class="card is-chosen">
              <CardFace card={matchCard} diets={diets} stamp="It's a match!" />
            </article>
          </div>
          <p class="remaining">Everyone swiped right: {approved.map((m) => m.name).join(', ')}</p>
          <div class="action-main chosen-actions">
            <a class="btn btn-primary btn-lg" href={matchCard.r.mapsUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="map" size={22} />
              <span>Take us there</span>
            </a>
            <Button variant="secondary" size="lg" onClick={() => setSeenMatches((s) => [...s, matchCard.r.id])}>
              Keep swiping
            </Button>
          </div>
        </section>
      ) : showResults || !card ? (
        <Results view={view} deck={deck} nameOf={nameOf} done={!card} others={others.length} />
      ) : (
        <section class="deck-area">
          <div class="stack">
            {nextCard && (
              <article class="card is-next" aria-hidden="true">
                <CardFace card={nextCard} diets={diets} />
              </article>
            )}
            <SwipeCard key={card.r.id} card={card} diets={diets} onSwipe={swipe} />
          </div>
          <div class="swipe-buttons">
            <button type="button" class="round round-no" aria-label="Not for me" onClick={() => swipe('left')}>
              <Icon name="x" size={28} />
            </button>
            <button type="button" class="round round-yes" aria-label="I'd go here" onClick={() => swipe('right')}>
              <Icon name="check" size={30} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Results({ view, deck, nameOf, done, others }: { view: Extract<RoomView, { status: 'approved' }>; deck: Card[]; nameOf: (id: string) => string; done: boolean; others: number }) {
  const approved = view.members.filter((m) => m.status === 'approved').length;
  const rows = deck
    .map((c) => ({ c, yes: view.tally[c.r.id]?.yes ?? [] }))
    .filter((x) => x.yes.length > 0)
    .sort((a, b) => b.yes.length - a.yes.length);
  return (
    <section class="results">
      <h2 class="h-sm">{done ? (others ? 'You’re done — here’s the table so far' : 'Invite someone to swipe with you') : 'Votes so far'}</h2>
      {rows.length === 0 ? (
        <p class="lede">No right-swipes yet. {others ? 'Hang tight while the others swipe.' : 'Tap Invite to share the link.'}</p>
      ) : (
        <ul class="pick-list">
          {rows.map(({ c, yes }) => (
            <li key={c.r.id} class="pick">
              {c.r.photos[0] ? <img class="pick-thumb" src={c.r.photos[0].url} alt="" /> : <FoodArt kind={c.r.art} size={48} />}
              <a class="pick-main" href={c.r.mapsUrl} target="_blank" rel="noopener noreferrer">
                <strong>{c.r.name}</strong>
                <span class="muted small">{yes.map(nameOf).join(', ')}</span>
              </a>
              <span class={`tally ${yes.length === approved ? 'is-all' : ''}`}>
                {yes.length}/{approved}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

