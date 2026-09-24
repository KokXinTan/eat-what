import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { FoodArt, ArtDefs } from './components/FoodArt';
import { Deal, Splats } from './components/Flair';
import { CardFace } from './components/PlaceCard';
import { facts, PickBoard, resetBoard } from './components/PickBoard';
import { JoinScreen, RoomScreen } from './components/RoomScreen';
import { GroupSheet, HistorySheet, SettingsSheet, type SheetProps } from './components/Sheets';
import { Button, Icon, PillSelect, Sheet } from './components/ui';
import { DIETS, dietQuery } from './lib/diet';
import { AccessCodeError, currentSource, findRestaurants, geocode, getLocation, hasMorePages, PROXY_URL, setAccessCode, takeCodeFromLink, type LatLng } from './lib/places';
import { buildDeck, effectiveConstraints, type Card } from './lib/rank';
import { createRoom, loadSession, ROOM_CODE, roomFromHash, saveSession, type Session } from './lib/room';
import { play } from './lib/sound';
import { STORAGE_KEY, loadData, newId, saveData } from './lib/storage';
import type { AppData, Distance, Restaurant } from './lib/types';

const TOAST_MS = 2600;
const LOADING_MS = 700;
const ROLL_MS = 900;
/** "Pick for me" with nothing tapped picks from the best few places, never a poor one. */
const LUCKY_POOL = 6;
const MAX_SKIPS = 300;
const TRAY_THUMBS = 4;
/** Places offered to a new group session. */
const ROOM_PLACES = 20;

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
/** Stop digging after this many pages in a row add nothing new. */
const EMPTY_PAGES_LIMIT = 3;

type Phase = 'start' | 'locating' | 'where' | 'loading' | 'rolling' | 'board' | 'chosen' | 'error';
type ConfirmOptions = { title: string; body?: string; confirmLabel: string; danger?: boolean };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [phase, setPhase] = useState<Phase>('start');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [list, setList] = useState<Restaurant[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  /** Places tapped on the board (the shortlist), in tap order. */
  const [wanted, setWanted] = useState<string[]>([]);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  // Paging: show a first batch, load more only when you scroll near the end.
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [emptyPages, setEmptyPages] = useState(0);
  const [pendingLucky, setPendingLucky] = useState(false);
  /** The diet/budget/group the board was ranked for. */
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

  /** Rank the places for the board. */
  const deal = (source: Restaurant[], d: AppData = data) => {
    const ranked = buildDeck(source, d, newId(), new Date());
    setDealtFor(JSON.stringify(effectiveConstraints(d)));
    setCards(ranked.cards);
    setRemoved(ranked.removed);
    // Keep taps on places that are still on the board.
    setWanted((w) => w.filter((id) => ranked.cards.some((c) => c.r.id === id)));
  };

  const search = async (at: LatLng, d: AppData = data) => {
    setPhase('loading');
    setError('');
    try {
      const { diets: ds } = effectiveConstraints(d);
      const [found] = await Promise.all([findRestaurants(at, d.prefs.distance, dietQuery(ds)), sleep(LOADING_MS)]);
      setList(found);
      setWanted([]);
      deal(found, d);
      setPage(0);
      setEmptyPages(0);
      resetBoard();
      setExhausted(!hasMorePages(0));
      setPhase('board');
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

  const findFood = async () => {
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

  // Filters: distance needs a new search; price and opening hours just re-rank.
  const setDistance = (distance: Distance) => {
    const next = { ...data, prefs: { ...data.prefs, distance } };
    setData(next);
    if (center && (phase === 'board' || phase === 'chosen')) search(center, next);
  };
  const setBudget = (b: AppData['prefs']['budget']) => {
    const next = { ...data, prefs: { ...data.prefs, budget: b } };
    setData(next);
    if (phase === 'board') deal(list, next);
  };
  const setShowClosed = (showClosed: boolean) => {
    const next = { ...data, prefs: { ...data.prefs, showClosed } };
    setData(next);
    if (phase === 'board') deal(list, next);
  };
  // Diet or group edits in a sheet: re-search when the sheet closes (diet words change the query).
  const closeSheet = () => {
    const was = sheet;
    setSheet(null);
    if ((was === 'group' || was === 'settings') && center && phase === 'board') search(center);
  };

  /** Fetch the next page of places and add only new ones to the end of the board. */
  const loadMore = async () => {
    if (!center || loadingMore) return;
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

  // "Pick for me" from the start screen: roll as soon as the board is ready.
  useEffect(() => {
    if (pendingLucky && phase === 'board' && cards.length) {
      setPendingLucky(false);
      lucky();
    }
  }, [pendingLucky, phase, cards.length]);

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

  /** Start a group board with the best places near you. */
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
      const top = buildDeck(found, data, newId(), new Date()).cards.slice(0, ROOM_PLACES).map((c) => c.r);
      if (!top.length) throw new Error('No places nearby to choose from — try a bigger distance.');
      const s = await createRoom(top, name, data.prefs.diets);
      saveSession(s);
      setSession(s);
      setPhase('start');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a group.');
      setPhase('error');
    }
  };

  const wantedCards = wanted.map((id) => cards.find((c) => c.r.id === id)).filter((c): c is Card => Boolean(c));

  const toggleWant = (c: Card) => {
    const on = !wanted.includes(c.r.id);
    setWanted((w) => (on ? [...w, c.r.id] : w.filter((id) => id !== c.r.id)));
    play(data.prefs.sound, on ? 'reveal' : 'skip');
  };

  const choose = (c: Card, stamp = "Let's go!") => {
    const pickId = newId();
    update((d) => ({
      ...d,
      picks: [{ id: pickId, placeId: c.r.id, name: c.r.name, food: c.r.typeLabel, art: c.r.art, mapsUrl: c.r.mapsUrl, date: new Date().toISOString(), verdict: null }, ...d.picks],
    }));
    setShortlistOpen(false);
    setChosen({ card: c, pickId, stamp });
    setPhase('chosen');
    play(data.prefs.sound, 'celebrate');
    navigator.vibrate?.(30);
  };

  /** 🎲 Let fate pick: from your shortlist if you have one, else from the best few places. */
  const lucky = () => {
    const pool = wantedCards.length ? wantedCards : cards.slice(0, LUCKY_POOL);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setShortlistOpen(false);
    setPhase('rolling');
    play(data.prefs.sound, 'skip');
    window.setTimeout(() => choose(pick, wantedCards.length ? 'Fate picked!' : 'Feeling lucky!'), reducedMotion() ? 0 : ROLL_MS);
  };

  /** Back to the board after a pick (your shortlist is kept). */
  const keepLooking = () => {
    setChosen(null);
    setPhase('board');
    // Group or diet edited meanwhile: re-rank so clashing places drop out.
    if (JSON.stringify(effectiveConstraints(data)) !== dealtFor) deal(list);
  };

  // "Not this one": undo the pick; it sinks for a few days and leaves your shortlist.
  const changedMind = () => {
    if (chosen) {
      update((d) => ({
        ...d,
        picks: d.picks.filter((p) => p.id !== chosen.pickId),
        skips: [{ placeId: chosen.card.r.id, date: new Date().toISOString() }, ...d.skips].slice(0, MAX_SKIPS),
      }));
      setWanted((w) => w.filter((id) => id !== chosen.card.r.id));
    }
    play(data.prefs.sound, 'skip');
    keepLooking();
  };

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
                  <p class="lede">Everything good nearby, as photos. Tap what tempts you — then decide in a tap.</p>
                  <Button variant="primary" size="lg" class="btn-surprise" icon="grid" onClick={findFood}>
                    Show me food nearby
                  </Button>
                  <Button
                    variant="secondary"
                    icon="dice"
                    onClick={() => {
                      setPendingLucky(true);
                      findFood();
                    }}
                  >
                    Just pick for me
                  </Button>
                  <button type="button" class="link small" onClick={() => setSheet('group')}>
                    Deciding with friends? Pick together →
                  </button>
                  {PROXY_URL && currentSource() === 'osm' && (
                    <button type="button" class="link small" onClick={() => setSheet('settings')}>
                      Have an access code? Unlock photos & ratings
                    </button>
                  )}
                </section>
              )}

              {phase === 'locating' && (
                <p class="status" role="status">
                  Finding where you are…
                </p>
              )}
              {phase === 'loading' && <Deal />}
              {phase === 'rolling' && <Deal label="Rolling the dice…" />}

              {phase === 'where' && (
                <section class="start">
                  <h2 class="h-sm">Where are you eating?</h2>
                  <p class="lede">{error || 'Location is off, so tell me the area instead.'}</p>
                  <form class="where" onSubmit={searchArea}>
                    <input aria-label="Area" placeholder="e.g. SS2 Petaling Jaya" value={area} maxLength={80} onInput={(e) => setArea((e.target as HTMLInputElement).value)} autoFocus />
                    <Button variant="primary" type="submit" icon="search">
                      Go
                    </Button>
                  </form>
                  <button type="button" class="link small" onClick={findFood}>
                    Try my location again
                  </button>
                </section>
              )}

              {phase === 'error' && (
                <section class="start">
                  <h2 class="h-sm">Hmm, that didn't work</h2>
                  <p class="lede">{error}</p>
                  <Button variant="primary" size="lg" icon="shuffle" onClick={() => (center ? search(center) : findFood())}>
                    Try again
                  </Button>
                </section>
              )}

              {(phase === 'start' || phase === 'board') && (
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

              {phase === 'board' && cards.length > 0 && (
                <>
                  <PickBoard
                    cards={cards}
                    diets={diets}
                    wanted={new Set(wanted)}
                    onToggle={toggleWant}
                    pickedIds={new Set(data.picks.map((p) => p.placeId))}
                    loadingMore={loadingMore}
                    canLoadMore={!exhausted && !!center}
                    onLoadMore={loadMore}
                  />
                  <Tray picks={wantedCards} onOpen={() => (wantedCards.length === 1 ? choose(wantedCards[0]) : setShortlistOpen(true))} onLucky={lucky} />
                </>
              )}

              {phase === 'board' && cards.length === 0 && (
                <section class="start">
                  <h2 class="h-sm">Nothing nearby fits</h2>
                  <p class="lede">
                    {list.length
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
                    {!data.prefs.showClosed && (
                      <Button variant="secondary" size="lg" onClick={() => setShowClosed(true)}>
                        Include closed places
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
                    <Button variant="secondary" size="lg" icon="grid" onClick={keepLooking}>
                      Keep looking
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
                  <p class="remaining">Saved in your picks (🕐). Your shortlist is kept if you keep looking.</p>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {shortlistOpen && (
        <Sheet
          open
          title={`Your shortlist · ${wantedCards.length}`}
          onClose={() => setShortlistOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setShortlistOpen(false)}>
                Keep looking
              </Button>
              <Button variant="primary" icon="dice" onClick={lucky}>
                Let fate pick
              </Button>
            </>
          }
        >
          <p class="muted small">Tap the one you want, or let fate pick between them.</p>
          <ul class="shortlist">
            {wantedCards.map((c) => (
              <li key={c.r.id}>
                <button type="button" class="short-row" onClick={() => choose(c)} aria-label={`Go with ${c.r.name}`}>
                  {c.r.photos[0] ? <img src={c.r.photos[0].url} alt="" /> : <FoodArt kind={c.r.art} size={72} />}
                  <span class="short-main">
                    <strong>{c.r.name}</strong>
                    <span class="muted small">{facts(c).join(' · ')}</span>
                    <span class="short-why">{c.reasons[0]}</span>
                  </span>
                  <span class="short-go">Go</span>
                </button>
                <button type="button" class="icon-btn" aria-label={`Remove ${c.r.name} from shortlist`} onClick={() => toggleWant(c)}>
                  <Icon name="x" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {sheet === 'group' && (
        <GroupSheet
          {...sheetProps}
          together={
            PROXY_URL
              ? {
                  canStart: currentSource() === 'google',
                  start: startTogether,
                  join: (code) => {
                    if (!ROOM_CODE.test(code)) return toast('Group codes are 6 letters/numbers, like K7XQ2M');
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

/** The decision tray: your shortlist at a glance, and the way to decide. */
function Tray({ picks, onOpen, onLucky }: { picks: Card[]; onOpen: () => void; onLucky: () => void }) {
  const extra = picks.length - TRAY_THUMBS;
  return (
    <div class={`tray ${picks.length ? 'has-picks' : ''}`} role="region" aria-label="Your shortlist">
      {picks.length === 0 ? (
        <>
          <p class="tray-hint">
            <Icon name="heart" size={16} /> Tap the ones that tempt you
          </p>
          <Button variant="secondary" size="sm" icon="dice" onClick={onLucky}>
            Pick for me
          </Button>
        </>
      ) : (
        <>
          <button type="button" class="tray-thumbs" onClick={onOpen} aria-label={`Your shortlist: ${picks.map((c) => c.r.name).join(', ')}`}>
            {picks.slice(0, TRAY_THUMBS).map((c) => (
              <span key={c.r.id} class="tray-thumb">
                {c.r.photos[0] ? <img src={c.r.photos[0].url} alt="" /> : <FoodArt kind={c.r.art} size={40} />}
              </span>
            ))}
            {extra > 0 && <span class="tray-thumb tray-more">+{extra}</span>}
          </button>
          <button type="button" class="round round-lucky" aria-label="Let fate pick from my shortlist" title="Let fate pick" onClick={onLucky}>
            <Icon name="dice" size={20} />
          </button>
          <Button variant="primary" onClick={onOpen}>
            {picks.length === 1 ? 'Go with this' : `Decide · ${picks.length}`}
          </Button>
        </>
      )}
    </div>
  );
}
