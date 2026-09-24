import { useEffect, useState } from 'preact/hooks';
import { DIETS } from '../lib/diet';
import { distanceLabel, priceLabel, type Card } from '../lib/rank';
import type { DietId } from '../lib/types';
import { FoodArt } from './FoodArt';
import { Icon } from './ui';

const MOSAIC = 3;
/** Some networks can't reach Google's photo host; fall back to the illustration. */
const PHOTO_TIMEOUT_MS = 8000;

/**
 * The place's own Google photos as a mosaic (one large, two small) — Google doesn't say
 * which photo shows food, so three at once usually includes a dish. Tap the right side for
 * the next photos, the left side to go back.
 */
export function Gallery({ r }: { r: Card['r'] }) {
  const [start, setStart] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), PHOTO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);
  const photos = r.photos.filter((p) => !failed.includes(p.url));
  if (!photos.length || (timedOut && !loaded)) return <FoodArt kind={r.art} label={`Illustration for ${r.name}`} />;
  const shown = Array.from({ length: Math.min(MOSAIC, photos.length) }, (_, n) => photos[(start + n) % photos.length]);
  const step = (d: number) => setStart((s) => (s + d + photos.length) % photos.length);
  const credits = [...new Set(shown.map((p) => p.credit))];
  return (
    <figure class={`photo mosaic-${shown.length}`}>
      <div
        class={`mosaic ${loaded ? 'is-loaded' : ''}`}
        onClick={(e) => {
          // Taps page the photos: left third = back, the rest = next.
          if (photos.length < 2) return;
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
          step(e.clientX < box.left + box.width * 0.35 ? -1 : 1);
        }}
      >
        {!loaded && <FoodArt kind={r.art} class="mosaic-wait" />}
        {shown.map((p, n) => (
          <img
            key={p.url}
            src={p.url}
            alt={n === 0 ? `Photos of ${r.name} from Google Maps` : ''}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed((f) => [...f, p.url])}
          />
        ))}
        {photos.length > 1 && (
          <>
            {/* Keyboard-only buttons: pointer taps go through the photo area above. */}
            <button type="button" class="photo-tap photo-prev" aria-label="Previous photos" onClick={(e) => (e.stopPropagation(), step(-1))} />
            <button type="button" class="photo-tap photo-next" aria-label="Next photos" onClick={(e) => (e.stopPropagation(), step(1))} />
            <span class="photo-count" aria-hidden="true">
              {start + 1}/{photos.length} ›
            </span>
          </>
        )}
      </div>
      <figcaption>
        Photos: {credits.map((c, n) => {
          const link = shown.find((p) => p.credit === c)?.creditUrl;
          return (
            <span key={c}>
              {n > 0 && ', '}
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {c}
                </a>
              ) : (
                c
              )}
            </span>
          );
        })}{' '}
        · Google Maps
      </figcaption>
    </figure>
  );
}

function Meta({ r }: { r: Card['r'] }) {
  return (
    <ul class="meta" aria-label="Details">
      {r.rating !== null && (
        <li>
          ★ {r.rating.toFixed(1)}
          <span class="muted"> ({r.ratingCount.toLocaleString('en-MY')})</span>
        </li>
      )}
      {r.priceText ? <li>{r.priceText}</li> : r.price !== null && <li>{priceLabel(r.price)}</li>}
      <li>
        <Icon name="pin" size={14} /> {distanceLabel(r.distanceM)}
      </li>
      {r.openNow === true && <li class="open">Open {r.hoursToday ?? 'now'}</li>}
    </ul>
  );
}

/** The chips already show rating and distance, so lead with a reason that adds something. */
const REPEATS_META = /^★|away —|^Close by|^Worth the short trip|^Open (now|right now|24 hours)/;
/** A reason that adds to the chips; else Google's description; else nothing (no repeats). */
const frontLine = (card: Card) =>
  card.reasons.find((x) => !REPEATS_META.test(x)) ?? (card.r.id.startsWith('g:') && card.r.summary ? card.r.summary : '');

const dietLine = (card: Card, diets: DietId[]) =>
  `${card.diet.status === 'ok' ? 'Looks suitable' : 'Unverified'}: ${diets.map((d) => DIETS[d].label).join(', ')}`;

const FRONT_CHIPS = 4;

/**
 * A card fits the screen without scrolling: photos, name, key facts, what they offer and a line
 * from Google. Tap the text to expand the details in place (photos shrink to a strip).
 */
export function CardFace({ card, diets, stamp }: { card: Card; diets: DietId[]; stamp?: string | null }) {
  const r = card.r;
  const [expanded, setExpanded] = useState(false);
  const subtitle = [r.typeLabel, r.area].filter(Boolean).join(' · ');
  const line = frontLine(card);
  const description = r.id.startsWith('g:') ? r.summary : '';
  const chips = [...new Set([...r.serves, ...r.features])].filter((x) => x.toLowerCase() !== r.food.toLowerCase());
  const quote = description && description !== line ? description : r.review ? `“${r.review.text}”` : '';
  const toggle = () => setExpanded((x) => !x);
  return (
    <>
      <span class="tape tape-l" aria-hidden="true" />
      <span class="tape tape-r" aria-hidden="true" />
      <div class={`card-art ${r.photos.length ? 'has-photo' : ''} ${expanded ? 'is-strip' : ''}`}>
        {r.photos.length ? <Gallery key={r.id} r={r} /> : <FoodArt kind={r.art} label={`Illustration for ${r.name}`} />}
        {stamp && (
          <div class="stamp" role="status">
            {stamp}
          </div>
        )}
      </div>
      <div class={`card-text ${expanded ? 'is-expanded' : ''}`}>
        <button type="button" class="card-toggle" aria-expanded={expanded} onClick={toggle}>
          <h2 class="card-title">
            {r.name}
            {subtitle && <span class="at">{subtitle}</span>}
          </h2>
          <Meta r={r} />
          {line && (
            <span class="why-line">
              <span aria-hidden="true">→ </span>
              {line}
            </span>
          )}
          {!expanded && chips.length > 0 && (
            <span class="front-chips">
              {chips.slice(0, FRONT_CHIPS).map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          )}
          {!expanded && quote && <span class="front-quote">{quote}</span>}
          {diets.length > 0 && <span class={`diet-line diet-${card.diet.status}`}>{dietLine(card, diets)}</span>}
          {diets.length === 0 && card.headsUp[0] && <span class="diet-line diet-unverified">{card.headsUp[0]}</span>}
          <span class="more-hint" aria-hidden="true">
            {expanded ? 'Show less ▴' : 'More ▾'}
          </span>
        </button>
        {expanded && <CardDetails card={card} diets={diets} />}
      </div>
    </>
  );
}

/** The expanded part: description, everything they offer, reasons, review, diet notes, source. */
export function CardDetails({ card, diets, mapsLink = true }: { card: Card; diets: DietId[]; mapsLink?: boolean }) {
  const r = card.r;
  const description = r.id.startsWith('g:') ? r.summary : '';
  const chips = [...new Set([...r.serves, ...r.features])];
  return (
    <div class="details">
      {description && <p class="pitch">{description}</p>}
      {r.address && <p class="details-sub">{r.address}</p>}
      {chips.length > 0 && (
        <ul class="serves" aria-label="What they offer">
          {chips.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <section class="why" aria-label="Why this, today">
        <h3>Why this, today</h3>
        <ul>
          {card.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      {r.review && (
        <blockquote class="review">
          “{r.review.text}”<cite>— {r.review.author} on Google</cite>
        </blockquote>
      )}
      {(diets.length > 0 || card.headsUp.length > 0) && (
        <p class={`diet-badge diet-${card.diet.status}`}>
          <Icon name={card.diet.status === 'ok' ? 'check' : 'spark'} size={16} />
          <span>
            {diets.length > 0 && <strong>{dietLine(card, diets)}</strong>}
            {card.headsUp.length > 0 && <span class="diet-note">{card.headsUp.join(' · ')}</span>}
          </span>
        </p>
      )}
      {mapsLink && (
        <a class="btn btn-ghost btn-sm" href={r.mapsUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="map" size={16} />
          <span>Open in Google Maps</span>
        </a>
      )}
      <p class="fine">{r.id.startsWith('g:') ? 'Details from Google Maps.' : 'Map data © OpenStreetMap contributors. Reviews, hours and prices are on Google Maps.'}</p>
    </div>
  );
}

/** The top card of the deck: drag it left (skip) or right (let's go). */
