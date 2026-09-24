import { FoodArt } from './components/FoodArt';
import type { ArtKind } from './lib/types';

const KINDS: ArtKind[] = ['noodleSoup', 'friedNoodles', 'nasiLemak', 'friedRice', 'riceBowl', 'curry', 'roti', 'toast', 'porridge', 'pasta', 'grill', 'burger', 'sushi', 'dessert', 'greens'];

/** Dev-only illustration sheet (open /#gallery with `npm run dev`). */
export function Gallery() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, padding: 8 }}>
      {[...KINDS.map((k) => [k, ''] as const), ...(['tuna', 'omelette', 'tofu', 'chicken'] as const).map((v) => ['riceBowl', v] as const), ['toast', 'sardine'] as const, ['curry', 'dhal'] as const].map(([k, v]) => (
        <figure key={k + v} style={{ margin: 0, textAlign: 'center', background: '#FBF5EA', borderRadius: 12 }}>
          <FoodArt kind={k as ArtKind} variant={v} size={260} />
          <figcaption>{k} {v}</figcaption>
        </figure>
      ))}
    </div>
  );
}
