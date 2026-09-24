import { useRef, useState } from 'preact/hooks';
import { DIETS, DIET_IDS } from '../lib/diet';
import { SOURCE } from '../lib/places';
import { priceLabel } from '../lib/rank';
import { freshData, makeBackup, newId, parseBackup } from '../lib/storage';
import type { AppData, Budget, DietId, Person } from '../lib/types';
import { FoodArt } from './FoodArt';
import { Button, Chip, ChoiceChips, Icon, Sheet } from './ui';

export interface SheetProps {
  data: AppData;
  update: (change: (d: AppData) => AppData) => void;
  toast: (msg: string) => void;
  confirm: (o: { title: string; body?: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
  onClose: () => void;
}

export const BUDGETS: { value: Budget; label: string }[] = [
  { value: null, label: 'Any budget' },
  { value: 1, label: '$ cheap' },
  { value: 2, label: '$$ mid' },
  { value: 3, label: '$$$ treat' },
];

function DietChips({ value, onChange }: { value: DietId[]; onChange: (v: DietId[]) => void }) {
  return (
    <div class="chip-row">
      {DIET_IDS.map((d) => (
        <Chip key={d} selected={value.includes(d)} onClick={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d])}>
          {DIETS[d].label}
        </Chip>
      ))}
    </div>
  );
}

// ---------- Group ----------

export function GroupSheet({ data, update, onClose }: SheetProps) {
  const setGroup = (group: Person[]) => update((d) => ({ ...d, group }));
  const patch = (id: string, change: Partial<Person>) => setGroup(data.group.map((p) => (p.id === id ? { ...p, ...change } : p)));
  const add = () => setGroup([...data.group, { id: newId(), name: '', diets: [], budget: null }]);
  return (
    <Sheet
      open
      title="Who's eating?"
      onClose={onClose}
      footer={
        <>
          {data.group.length > 0 && (
            <Button variant="ghost" class="push-left" onClick={() => setGroup([])}>
              Just me
            </Button>
          )}
          <Button variant="primary" icon="check" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p class="muted small">Add everyone at the table. I'll skip places that clash with anyone's diet and stick to the tightest budget. Names are optional.</p>
      <ol class="people">
        <li class="person person-me">
          <span class="person-dot" style={{ background: '#D8452B' }} aria-hidden="true">
            Me
          </span>
          <span class="muted small">
            You — {data.prefs.diets.length ? data.prefs.diets.map((d) => DIETS[d].label).join(', ') : 'no diet set'} (change in settings)
          </span>
        </li>
        {data.group.map((p, i) => (
          <li key={p.id} class="person">
            <div class="person-head">
              <span class="person-dot" aria-hidden="true" style={{ background: ['#E3A72F', '#7A8450', '#A8321D', '#C98A45'][i % 4] }}>
                {(p.name.trim() || String(i + 2)).charAt(0).toUpperCase()}
              </span>
              <input
                class="person-name"
                aria-label={`Person ${i + 2} name (optional)`}
                placeholder={`Friend ${i + 1}`}
                value={p.name}
                maxLength={24}
                onInput={(e) => patch(p.id, { name: (e.target as HTMLInputElement).value })}
              />
              <button type="button" class="icon-btn" aria-label={`Remove ${p.name || `friend ${i + 1}`}`} onClick={() => setGroup(data.group.filter((x) => x.id !== p.id))}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <DietChips value={p.diets} onChange={(diets) => patch(p.id, { diets })} />
            <ChoiceChips label={`Budget for ${p.name || `friend ${i + 1}`}`} value={p.budget} onChange={(budget) => patch(p.id, { budget })} options={BUDGETS} />
          </li>
        ))}
      </ol>
      {data.group.length < 7 && (
        <Button icon="plus" onClick={add}>
          Add a person
        </Button>
      )}
    </Sheet>
  );
}

// ---------- History ----------

const DAY_FMT = new Intl.DateTimeFormat('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });

export function HistorySheet({ data, update, confirm, onClose }: SheetProps) {
  const picks = [...data.picks].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const setVerdict = (id: string, verdict: 'up' | 'down') =>
    update((d) => ({ ...d, picks: d.picks.map((p) => (p.id === id ? { ...p, verdict: p.verdict === verdict ? null : verdict } : p)) }));
  const clear = async () => {
    if (await confirm({ title: 'Clear your history?', body: 'Your picks and thumbs will be forgotten, so repeats may come back.', confirmLabel: 'Clear history', danger: true })) {
      update((d) => ({ ...d, picks: [], skips: [] }));
    }
  };
  return (
    <Sheet
      open
      title="Your picks"
      onClose={onClose}
      footer={
        picks.length > 0 && (
          <Button variant="ghost" class="danger-text push-left" icon="trash" onClick={clear}>
            Clear history
          </Button>
        )
      }
    >
      {picks.length === 0 ? (
        <div class="empty">
          <div class="empty-art">
            <FoodArt kind="toast" size={140} />
          </div>
          <p>Nothing yet. Swipe right on something and it'll show up here.</p>
        </div>
      ) : (
        <>
          <p class="muted small">Thumbs up and I'll bring it back now and then. Thumbs down and it's gone for good.</p>
          <ul class="pick-list">
            {picks.map((p) => (
              <li key={p.id} class="pick">
                <FoodArt kind={p.art} size={48} />
                <a class="pick-main" href={p.mapsUrl} target="_blank" rel="noopener noreferrer">
                  <strong>{p.name}</strong>
                  <span class="muted small">
                    {p.food ? `${p.food} · ` : ''}
                    {DAY_FMT.format(new Date(p.date))}
                  </span>
                </a>
                <div class="thumbs" role="group" aria-label={`Rate ${p.name}`}>
                  <button type="button" class={`thumb ${p.verdict === 'up' ? 'is-on' : ''}`} aria-pressed={p.verdict === 'up'} aria-label="Thumbs up" onClick={() => setVerdict(p.id, 'up')}>
                    👍
                  </button>
                  <button type="button" class={`thumb ${p.verdict === 'down' ? 'is-on' : ''}`} aria-pressed={p.verdict === 'down'} aria-label="Thumbs down" onClick={() => setVerdict(p.id, 'down')}>
                    👎
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

// ---------- Settings ----------

export function SettingsSheet({ data, update, toast, confirm, onClose }: SheetProps) {
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const setPrefs = (change: Partial<AppData['prefs']>) => update((d) => ({ ...d, prefs: { ...d.prefs, ...change } }));

  const exportData = () => {
    const url = URL.createObjectURL(new Blob([makeBackup(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `eat-what-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded');
  };

  const importFile = async (file: File) => {
    setImportError('');
    if (file.size > 2_000_000) return setImportError('That file is too large to be an Eat What? backup.');
    const result = parseBackup(await file.text());
    if (!result.ok) return setImportError(result.error);
    const ok = await confirm({
      title: 'Replace your data with this backup?',
      body: `It has ${result.data.picks.length} picks. Your current settings and history on this device will be replaced.`,
      confirmLabel: 'Replace my data',
      danger: true,
    });
    if (!ok) return;
    update(() => result.data);
    toast(`Imported ${result.data.picks.length} picks`);
  };

  const erase = async () => {
    if (await confirm({ title: 'Erase everything?', body: 'Settings, picks and group on this device will be deleted.', confirmLabel: 'Erase everything', danger: true })) {
      update(() => freshData());
      toast('All data erased');
    }
  };

  return (
    <Sheet open title="Settings" onClose={onClose}>
      <section class="panel">
        <h3 class="section-title">I don't eat…</h3>
        <p class="muted small">
          Clear clashes are never shown. Map data can't confirm things like halal, so anything unsure is marked <strong>unverified</strong> — check at the shop.
        </p>
        <DietChips value={data.prefs.diets} onChange={(diets) => setPrefs({ diets })} />
      </section>

      <section class="panel">
        <label class="check">
          <input type="checkbox" checked={data.prefs.sound} onChange={() => setPrefs({ sound: !data.prefs.sound })} />
          <span>Soft sounds on swipes</span>
        </label>
      </section>

      <section class="panel">
        <h3 class="section-title">Your data</h3>
        <p class="small">
          <Icon name="leaf" size={16} /> Your settings and picks stay <strong>on this device</strong> and don't sync anywhere. To find restaurants, your approximate location is sent to{' '}
          {SOURCE === 'google' ? 'Google Maps' : 'OpenStreetMap'} — it isn't saved.
        </p>
        <div class="btn-row">
          <Button icon="download" onClick={exportData}>
            Export backup
          </Button>
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Import backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="visually-hidden"
            aria-label="Choose a backup file to import"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) importFile(file);
              input.value = '';
            }}
          />
        </div>
        {importError && (
          <p class="field-error" role="alert">
            Couldn't import: {importError}
          </p>
        )}
        <div class="btn-row">
          <Button variant="ghost" class="danger-text" icon="trash" onClick={erase}>
            Erase everything
          </Button>
        </div>
      </section>

      <p class="fine">
        {SOURCE === 'google'
          ? 'Restaurants, ratings and prices from Google Maps.'
          : 'Restaurants © OpenStreetMap contributors (ODbL). Free map data has no ratings, prices or reliable hours — those are one tap away on Google Maps.'}{' '}
        Budget is per person and rough: {priceLabel(1)} ≈ under RM 20, {priceLabel(2)} ≈ RM 20–40, {priceLabel(3)} ≈ RM 40+.
      </p>
    </Sheet>
  );
}
