import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ArtDefs } from './components/FoodArt';
import { GroupSheet, HistorySheet, SettingsSheet, type SheetProps } from './components/Sheets';
import { CardFace, SwipeCard, type SwipeDir } from './components/SwipeCard';
import { ExploreGrid, resetExplore } from './components/ExploreGrid';
import { JoinScreen, RoomScreen } from './components/RoomScreen';
import { Button, Icon, PillSelect, Sheet } from './components/ui';
import { DIETS, dietQuery } from './lib/diet';
import { AccessCodeError, currentSource, findRestaurants, geocode, getLocation, hasMorePages, PROXY_URL, setAccessCode, takeCodeFromLink, type LatLng } from './lib/places';
import { buildDeck, effectiveConstraints, type Card } from './lib/rank';
import { play } from './lib/sound';
import { STORAGE_KEY, loadData, newId, saveData } from './lib/storage';
import { createRoom, loadSession, ROOM_CODE, roomFromHash, saveSession, type Session } from './lib/room';
import type { AppData, Distance, Restaurant } from './lib/types';

const TOAST_MS = 2600;
const SHUFFLE_MS = 700;
const ROLL_MS = 900;
/** Feeling lucky picks from the best few remaining places, never a poor one. */
const LUCKY_POOL = 6;
const MAX_SKIPS = 300;
const HINT_KEY = 'eat-what:swipe-hint-seen';
const VIEW_KEY = 'eat-what:view';

const DISTANCES: { value: Distance; label: string; short: string }[] = [
  { value: 'walk', label: 'Walk · within 800 m', short: 'Walk' },
  { value: 'near', label: 'Nearby · within 2 km', short: 'Nearby' },
  { value: 'drive', label: 'Short drive · within 6 km', short: 'Drive' },
];
const BUDGETS: { value: AppData['prefs']['budget']; label: string; short: string }[] = [
  { value: null, label: 'Any price', short: 'Any $' },
  { value: 1, label: '$ · under RM 20', short: '$' },
  { value: 2, label: '$$ · up to RM 40', short: '$$' },
  { value: 3, label: '$$$ · RM 40+', short: '$$$' },
];
const OPEN_FILTER: { value: boolean; label: string; short: string }[] = [
  { value: false, label: 'Open now', short: 'Open now' },
  { value: true, label: 'Any time (include closed places)', short: 'Any time' },
];
/** Load the next page of places when this many cards are left. */
const LOAD_AHEAD = 5;
/** Stop digging after this many pages in a row add nothing new. */
const EMPTY_PAGES_LIMIT = 3;

type Phase = 'start' | 'locating' | 'where' | 'loading' | 'rolling' | 'deck' | 'chosen' | 'error';
type ConfirmOptions = { title: string; body?: string; confirmLabel: string; danger?: boolean };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [phase, setPhase] = useState<Phase>('start');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [list, setList] = useState<Restaurant[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  // Paging: load a few places first, more only when the deck runs low.
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [emptyPages, setEmptyPages] = useState(0);
  const [pendingLucky, setPendingLucky] = useState(false);
  // Swipe one at a time, or Explore everything nearby as a grid. Remembered on this phone.
  const [view, setViewState] = useState<'swipe' | 'explore'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'explore' ? 'explore' : 'swipe';
    } catch {
      return 'swipe';
    }
  });
  const setView = (v: 'swipe' | 'explore') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* convenience only */
    }
  };
  const [removed, setRemoved] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  /** The diet/budget/group the current deck was ranked for. */
  const [dealtFor, setDealtFor] = useState('');
  const [chosen, setChosen] = useState<{ card: Card; pickId: string; stamp: string } | null>(null);
  const [error, setError] = useState('');
  const [area, setArea] = useState('');
  const [sheet, setSheet] = useState<'group' | 'history' | 'settings' | null>(null);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [joinId, setJoinId] = useState<string | null>(roomFromHash);
  const [toastMsg, setToastMsg] = useState<{ text: string; id: number } | null>(null);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [showHint, setShowHint] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return true;
    }
  });
  const toastTimer = useRef<number>();

  useEffect(() => setStorageOk(saveData(data)), [data]);
  // A personal setup link (#code=…) unlocks Google data on this phone in one tap.
  useEffect(() => {
    takeCodeFromLink().then((r) => {
      if (r === 'ok') toast('Access code saved — Google photos & ratings unlocked');
      else if (r === 'invalid') toast("That link's access code isn't valid");
      else if (r) toast("Couldn't check the access code — try the link again");
    });
  }, []);

  // Another tab saved newer data: pick it up instead of overwriting it later.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setData(loadData());
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((change: (d: AppData) => AppData) => setData((d) => change(d)), []);
  const toast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToastMsg({ text, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToastMsg(null), TOAST_MS);
  }, []);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), []);
  const closeConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  const { diets, budget, people } = effectiveConstraints(data);

  /** Rank a restaurant list into a fresh deck. */
  const deal = (source: Restaurant[], d: AppData = data) => {
    const deck = buildDeck(source, d, newId(), new Date());
    setDealtFor(JSON.stringify(effectiveConstraints(d)));
    setCards(deck.cards);
    setRemoved(deck.removed);
    setIndex(0);
  };

  const search = async (at: LatLng, d: AppData = data) => {
    setPhase('loading');
    setError('');
    try {
      const { diets: ds } = effectiveConstraints(d);
      const [found] = await Promise.all([findRestaurants(at, d.prefs.distance, dietQuery(ds)), sleep(SHUFFLE_MS)]);
      setList(found);
      deal(found, d);
      setPage(0);
      setEmptyPages(0);
      resetExplore();
      setExhausted(!hasMorePages(0));
      setPhase('deck');
      if (found.length) play(d.prefs.sound, 'reveal');
    } catch (e) {
      if (e instanceof AccessCodeError) {
        // Code revoked or mistyped: carry on with free map data rather than failing.
        setAccessCode('');
        toast("That access code isn't valid — showing free map data.");
        return search(at, d);
      }
      setError(e instanceof Error ? e.message : 'Something went wrong finding restaurants.');
      setPhase('error');
    }
  };

  const surprise = async () => {
    if (center) return search(center);
    setPhase('locating');
    try {
      const at = await getLocation();
      setCenter(at);
      search(at);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'denied' ? e.message : '');
      setPhase('where');
    }
  };

  const searchArea = async (e: Event) => {
    e.preventDefault();
    if (!area.trim()) return;
    setPhase('loading');
    const at = await geocode(area.trim()).catch(() => null);
    if (!at) {
      setError(`Couldn't find “${area.trim()}”. Try a neighbourhood and city, like “SS2 Petaling Jaya”.`);
      setPhase('where');
      return;
    }
    setCenter(at);
    search(at);
  };

  // Settings that change the deck: distance needs a new search, the rest re-rank.
  const setDistance = (distance: Distance) => {
    const next = { ...data, prefs: { ...data.prefs, distance } };
    setData(next);
    if (center && (phase === 'deck' || phase === 'chosen')) search(center, next);
  };
  const setShowClosed = (showClosed: boolean) => {
    const next = { ...data, prefs: { ...data.prefs, showClosed } };
    setData(next);
    if (phase === 'deck') deal(list, next);
  };

  /** Fetch the next page of places and add only new ones to the end of the deck. */
  const loadMore = async () => {
    if (!center) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const found = await findRestaurants(center, data.prefs.distance, dietQuery(diets), next);
      const known = new Set(list.map((r) => r.id));
      const fresh = found.filter((r) => !known.has(r.id));
      const streak = fresh.length ? 0 : emptyPages + 1;
      setPage(next);
      setEmptyPages(streak);
      if (fresh.length) {
        setList((l) => [...l, ...fresh]);
        const added = buildDeck(fresh, data, newId(), new Date()).cards;
        setCards((cs) => [...cs, ...added.filter((c) => !cs.some((x) => x.r.id === c.r.id))]);
      }
      if (!hasMorePages(next) || streak >= EMPTY_PAGES_LIMIT) setExhausted(true);
    } catch {
      setExhausted(true); // quietly stop digging; what's already here still works
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // In Explore, scrolling to the end loads more instead.
    if (phase !== 'deck' || view !== 'swipe' || loadingMore || exhausted || !center) return;
    if (cards.length - index <= LOAD_AHEAD) loadMore();
  }, [phase, index, cards.length, loadingMore, exhausted]);

  // "Feeling lucky" from the start screen: roll as soon as the deck is ready.
  useEffect(() => {
    if (pendingLucky && phase === 'deck' && cards.length) {
      setPendingLucky(false);
      lucky();
    }
  }, [pendingLucky, phase, cards.length]);

  const setBudget = (b: AppData['prefs']['budget']) => {
    const next = { ...data, prefs: { ...data.prefs, budget: b } };
    setData(next);
    if (phase === 'deck') deal(list, next);
  };
  // Diet or group edits in a sheet: re-search when the sheet closes (diet words change the query).
  const closeSheet = () => {
    const was = sheet;
    setSheet(null);
    if ((was === 'group' || was === 'settings') && center && phase === 'deck') search(center);
  };

  // Invite links (#join=XXXXXX) open the join screen, even if the app is already open.
  useEffect(() => {
    const onHash = () => setJoinId(roomFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const clearJoin = () => {
    setJoinId(null);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  };

  /** Start a shared session with the best ~20 places near you. */
  const startTogether = async (name: string) => {
    setSheet(null);
    try {
      let at = center;
      if (!at) {
        setPhase('locating');
        at = await getLocation();
        setCenter(at);
      }
      setPhase('loading');
      const found = list.length && center ? list : await findRestaurants(at, data.prefs.distance, dietQuery(diets));
      const top = buildDeck(found, data, newId(), new Date()).cards.slice(0, 20).map((c) => c.r);
      if (!top.length) throw new Error('No places nearby to swipe on — try a bigger distance.');
      const s = await createRoom(top, name, data.prefs.diets);
      saveSession(s);
      setSession(s);
      setPhase('start');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a session.');
      setPhase('error');
    }
  };

  const card = cards[index];
  const nextCard = cards[index + 1];

  const swipe = (dir: SwipeDir) => {
    if (!card) return;
    if (showHint) {
      setShowHint(false);
      try {
        localStorage.setItem(HINT_KEY, '1');
      } catch {
        /* convenience only */
      }
    }
    if (dir === 'left') {
      play(data.prefs.sound, 'skip');
      update((d) => ({ ...d, skips: [{ placeId: card.r.id, date: new Date().toISOString() }, ...d.skips].slice(0, MAX_SKIPS) }));
      setIndex((i) => i + 1);
      return;
    }
    choose(card);
  };

  const choose = (c: Card, stamp = "Let's go!") => {
    const pickId = newId();
    update((d) => ({
      ...d,
      picks: [{ id: pickId, placeId: c.r.id, name: c.r.name, food: c.r.typeLabel, art: c.r.art, mapsUrl: c.r.mapsUrl, date: new Date().toISOString(), verdict: null }, ...d.picks],
    }));
    setChosen({ card: c, pickId, stamp });
    setPhase('chosen');
    play(data.prefs.sound, 'celebrate');
    navigator.vibrate?.(30);
  };

  /** 🎲 Roll the dice: a quick shuffle, then land on one of the best few remaining places. */
  const lucky = () => {
    const pool = cards.slice(index, index + LUCKY_POOL);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // Put it at the current position so "Changed my mind" and ↺ behave as usual.
    setCards((cs) => [...cs.slice(0, index), pick, ...cs.slice(index).filter((c) => c !== pick)]);
    setPhase('rolling');
    play(data.prefs.sound, 'skip');
    window.setTimeout(() => choose(pick, 'Feeling lucky!'), reducedMotion() ? 0 : ROLL_MS);
  };

  /** 🔀 Reorder the cards you haven't seen yet. */
  const shuffleDeck = () => {
    setCards((cs) => {
      const rest = cs.slice(index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [...cs.slice(0, index), ...rest];
    });
    play(data.prefs.sound, 'skip');
    toast('Shuffled');
  };

  /** Back to the deck after a pick, continuing with the next place. */
  const continueDeck = () => {
    const fromDeck = view === 'swipe' && chosen && cards[index]?.r.id === chosen.card.r.id;
    setChosen(null);
    setPhase('deck');
    // Group or diet edited meanwhile: re-rank so clashing places drop out.
    if (JSON.stringify(effectiveConstraints(data)) !== dealtFor) deal(list);
    else if (fromDeck) setIndex((i) => i + 1);
  };

  // "Not this one": undo the pick. It counts as a skip, so ↺ can bring the place back.
  const changedMind = () => {
    if (chosen)
      update((d) => ({
        ...d,
        picks: d.picks.filter((p) => p.id !== chosen.pickId),
        skips: [{ placeId: chosen.card.r.id, date: new Date().toISOString() }, ...d.skips].slice(0, MAX_SKIPS),
      }));
    play(data.prefs.sound, 'skip');
    continueDeck();
  };

  const undoSkip = () => {
    if (index === 0) return;
    const back = cards[index - 1];
    setIndex((i) => i - 1);
    // Only forget the skip if it belongs to the card we're bringing back.
    update((d) => ({ ...d, skips: d.skips[0]?.placeId === back?.r.id ? d.skips.slice(1) : d.skips }));
  };

  useEffect(() => {
    if (phase !== 'deck' || view !== 'swipe' || sheet || confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') swipe('left');
      if (e.key === 'ArrowRight') swipe('right');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const sheetProps: SheetProps = { data, update, toast, confirm, onClose: closeSheet };
  const forLine = [people > 1 ? `For ${people}` : null, ...diets.map((d) => DIETS[d].label)].filter(Boolean).join(' · ');

  return (
    <>
      <ArtDefs />
      <div class="shell">
        <header class="topbar">
          <button type="button" class="logo" onClick={() => setPhase('start')} aria-label="Eat What? — back to start">
            <span class="logo-mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" width="34" height="34">
                <g filter="url(#ew-rough)">
                  <circle cx="20" cy="21" r="16" fill="#D8452B" />
                  <path d="M9 19 h22 a11 11 0 0 1 -22 0z" fill="#FBF3E4" />
                  <circle cx="20" cy="12" r="4" fill="#E3A72F" />
                </g>
              </svg>
            </span>
            <span class="logo-text">Eat What?</span>
          </button>
          {!session && !joinId && (phase === 'deck' || phase === 'chosen' || phase === 'rolling') && (
            <div class="view-switch" role="tablist" aria-label="View">
              {(['swipe', 'explore'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  class={view === v ? 'is-on' : ''}
                  onClick={() => {
                    setView(v);
                    if (phase === 'chosen') {
                      setChosen(null);
                      setPhase('deck');
                    }
                  }}
                >
                  <Icon name={v === 'swipe' ? 'cards' : 'grid'} size={16} /> {v === 'swipe' ? 'Swipe' : 'Explore'}
                </button>
              ))}
            </div>
          )}
          <nav class="top-actions" aria-label="More">
            <button type="button" class="icon-btn" aria-label={`Who's eating${people > 1 ? ` (${people} people)` : ''}`} onClick={() => setSheet('group')}>
              <Icon name="people" />
              {people > 1 && <span class="dot-badge">{people}</span>}
            </button>
            <button type="button" class="icon-btn" aria-label="Your picks" onClick={() => setSheet('history')}>
              <Icon name="clock" />
            </button>
            <button type="button" class="icon-btn" aria-label="Settings" onClick={() => setSheet('settings')}>
              <Icon name="user" />
            </button>
          </nav>
        </header>

        {!storageOk && (
          <p class="notice notice-warn" role="alert">
            This browser isn't letting me save (private mode or storage full). Your picks will be forgotten when you close the tab.
          </p>
        )}

        <main id="main">
          {session ? (
            <RoomScreen session={session} data={data} toast={toast} onExit={() => setSession(null)} />
          ) : joinId ? (
            <JoinScreen
              roomId={joinId}
              data={data}
              onJoined={(s) => {
                clearJoin();
                setSession(s);
              }}
              onCancel={clearJoin}
            />
          ) : (
          <>
          {phase === 'start' && (
            <section class="start">
              <h1>
                What are we <span class="brush">eating?</span>
              </h1>
              <p class="lede">A deck of what's good nearby. Swipe right if it tempts you, left to skip.</p>
              <Button variant="primary" size="lg" class="btn-surprise" icon="cards" onClick={surprise}>
                Start swiping
              </Button>
              <Button
                variant="secondary"
                icon="dice"
                onClick={() => {
                  setPendingLucky(true);
                  surprise();
                }}
              >
                I'm feeling lucky
              </Button>
              {PROXY_URL && currentSource() === 'osm' && (
                <button type="button" class="link small" onClick={() => setSheet('settings')}>
                  Have an access code? Unlock photos & ratings
                </button>
              )}
            </section>
          )}

          {phase === 'locating' && <Status text="Finding where you are…" />}
          {phase === 'loading' && <Deal />}
          {phase === 'rolling' && <Deal label="Rolling the dice…" />}

          {phase === 'where' && (
            <section class="start">
              <h2 class="h-sm">Where are you eating?</h2>
              <p class="lede">{error || "Location is off, so tell me the area instead."}</p>
              <form class="where" onSubmit={searchArea}>
                <input aria-label="Area" placeholder="e.g. SS2 Petaling Jaya" value={area} maxLength={80} onInput={(e) => setArea((e.target as HTMLInputElement).value)} autoFocus />
                <Button variant="primary" type="submit" icon="search">
                  Go
                </Button>
              </form>
              <button type="button" class="link small" onClick={surprise}>
                Try my location again
              </button>
            </section>
          )}

          {phase === 'error' && (
            <section class="start">
              <h2 class="h-sm">Hmm, that didn't work</h2>
              <p class="lede">{error}</p>
              <Button variant="primary" size="lg" icon="shuffle" onClick={() => (center ? search(center) : surprise())}>
                Try again
              </Button>
            </section>
          )}

          {(phase === 'start' || phase === 'deck' || phase === 'chosen') && (
            <div class="filters" aria-label="Filters">
              <PillSelect icon="pin" label="Distance" value={data.prefs.distance} onChange={setDistance} options={DISTANCES} />
              <PillSelect icon="wallet" label="Budget per person" value={data.prefs.budget} onChange={setBudget} options={BUDGETS} />
              <PillSelect icon="clock" label="Opening hours" value={data.prefs.showClosed} onChange={setShowClosed} options={OPEN_FILTER} />
              {forLine && (
                <button type="button" class="pill for-line" onClick={() => setSheet(people > 1 ? 'group' : 'settings')}>
                  <Icon name={people > 1 ? 'people' : 'leaf'} size={15} /> {forLine}
                </button>
              )}
            </div>
          )}

          {phase === 'deck' && view === 'explore' && (
            <ExploreGrid
              cards={cards}
              diets={diets}
              pickedIds={new Set(data.picks.map((p) => p.placeId))}
              loadingMore={loadingMore}
              canLoadMore={!exhausted && !!center}
              onLoadMore={loadMore}
              onChoose={(c) => choose(c)}
            />
          )}

          {phase === 'deck' && view === 'swipe' && card && (
            <section class="deck-area">
              <div class="stack">
                {[nextCard, card].map((c) => c && <SwipeCard key={c.r.id} card={c} diets={diets} onSwipe={swipe} top={c === card} />)}
                {showHint && (
                  <p class="swipe-hint" aria-hidden="true">
                    <span>← not today</span>
                    <span>let's go →</span>
                  </p>
                )}
              </div>
              <div class="swipe-buttons">
                <button type="button" class="round round-small" aria-label={`Shuffle the ${cards.length - index} places left`} title="Shuffle" onClick={shuffleDeck} disabled={cards.length - index < 3}>
                  <Icon name="shuffle" size={18} />
                </button>
                <button type="button" class="round round-undo" aria-label="Undo last skip" onClick={undoSkip} disabled={index === 0}>
                  <Icon name="undo" size={18} />
                </button>
                <button type="button" class="round round-no" aria-label="Not today" onClick={() => swipe('left')}>
                  <Icon name="x" size={28} />
                </button>
                <button type="button" class="round round-yes" aria-label="Let's go here" onClick={() => swipe('right')}>
                  <Icon name="check" size={30} />
                </button>
                <button type="button" class="round round-lucky" aria-label="I'm feeling lucky — pick one for me" title="I'm feeling lucky" onClick={lucky}>
                  <Icon name="dice" size={22} />
                </button>
              </div>
            </section>
          )}

          {phase === 'deck' && view === 'swipe' && !card && loadingMore && <Deal label="Finding more places…" />}
          {phase === 'deck' && view === 'swipe' && !card && !loadingMore && (
            <section class="start">
              <h2 class="h-sm">{cards.length ? "That's everything nearby" : 'Nothing nearby fits'}</h2>
              <p class="lede">
                {cards.length
                  ? `You've seen all ${cards.length}.`
                  : list.length
                    ? `I found ${list.length} places, but:`
                    : currentSource() === 'osm'
                      ? 'The free map has no restaurants listed this close.'
                      : 'No restaurants found this close.'}
              </p>
              {removed.length > 0 && (
                <ul class="blockers">
                  {removed.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <div class="action-main">
                {data.prefs.distance !== 'drive' && (
                  <Button variant="primary" size="lg" onClick={() => setDistance('drive')}>
                    Look further
                  </Button>
                )}
                {cards.length > 0 && (
                  <Button variant="secondary" size="lg" icon="shuffle" onClick={() => deal(list)}>
                    Shuffle again
                  </Button>
                )}
                {budget !== null && (
                  <Button variant="secondary" size="lg" onClick={() => setBudget(null)}>
                    Any budget
                  </Button>
                )}
              </div>
            </section>
          )}

          {phase === 'chosen' && chosen && (
            <section class="deck-area">
              <div class="stack">
                <article class="card is-chosen">
                  <CardFace card={chosen.card} diets={diets} stamp={chosen.stamp} />
                  <Splats />
                </article>
              </div>
              <div class="action-main chosen-actions">
                <a class="btn btn-primary btn-lg" href={chosen.card.r.mapsUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="map" size={22} />
                  <span>Take me there</span>
                </a>
                <Button variant="secondary" size="lg" icon="cards" onClick={continueDeck}>
                  Keep exploring
                </Button>
              </div>
              <p class="chosen-links">
                <button type="button" class="link small" onClick={changedMind}>
                  Not this one — undo
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  class="link small"
                  onClick={() => {
                    setChosen(null);
                    setPhase('start');
                  }}
                >
                  Done
                </button>
              </p>
              <p class="remaining">Saved in your picks (🕐) — keep exploring and it stays there.</p>
            </section>
          )}
          </>
          )}
        </main>
      </div>

      {sheet === 'group' && (
        <GroupSheet
          {...sheetProps}
          together={
            PROXY_URL
              ? {
                  canStart: currentSource() === 'google',
                  start: startTogether,
                  join: (code) => {
                    if (!ROOM_CODE.test(code)) return toast('Session codes are 6 letters/numbers, like K7XQ2M');
                    setSheet(null);
                    setJoinId(code);
                  },
                }
              : undefined
          }
        />
      )}
      {sheet === 'history' && <HistorySheet {...sheetProps} />}
      {sheet === 'settings' && <SettingsSheet {...sheetProps} />}

      <div class="toast-wrap" aria-live="polite" role="status">
        {toastMsg && (
          <div class="toast" key={toastMsg.id}>
            {toastMsg.text}
          </div>
        )}
      </div>
      <Sheet
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        onClose={() => closeConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => closeConfirm(false)}>
              Cancel
            </Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>
              {confirmState?.confirmLabel}
            </Button>
          </>
        }
      >
        {confirmState?.body && <p>{confirmState.body}</p>}
      </Sheet>
    </>
  );
}

function Status({ text }: { text: string }) {
  return (
    <p class="status" role="status">
      {text}
    </p>
  );
}

function Deal({ label = "Sniffing out what's nearby…" }: { label?: string }) {
  return (
    <div class="deck" role="status" aria-label="Finding places nearby…">
      <span class="deck-card c1" />
      <span class="deck-card c2" />
      <span class="deck-card c3">
        <span>?</span>
      </span>
      <p class="deck-label">{label}</p>
    </div>
  );
}

const SPLAT_COLOURS = ['#D8452B', '#E3A72F', '#7A8450', '#F4CB63', '#A8321D', '#AAB27A'];

function Splats() {
  return (
    <div class="splats" aria-hidden="true">
      {SPLAT_COLOURS.concat(SPLAT_COLOURS).map((c, i) => {
        const angle = (i / 12) * Math.PI * 2 + 0.3;
        const dist = 110 + (i % 3) * 30;
        return (
          <span
            key={i}
            style={{
              background: c,
              '--dx': `${Math.round(Math.cos(angle) * dist)}px`,
              '--dy': `${Math.round(Math.sin(angle) * dist)}px`,
              '--s': `${0.6 + (i % 4) * 0.25}`,
              animationDelay: `${(i % 4) * 30}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
