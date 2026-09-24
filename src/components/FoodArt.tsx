import type { JSX } from 'preact';
import type { ArtKind } from '../lib/types';

// Original "grainy gouache" food illustrations, drawn as SVG and passed through
// shared filters (see <ArtDefs/>): a low-frequency displacement gives painted,
// imperfect edges; streaky noise adds brushwork; fine noise adds pigment grain.

const C = {
  cream: '#FBF3E4',
  rice: '#FFFCF3',
  tomato: '#D8452B',
  tomatoDeep: '#A8321D',
  mustard: '#E3A72F',
  mustardLight: '#F4CB63',
  olive: '#7A8450',
  oliveDeep: '#56603A',
  oliveLight: '#AAB27A',
  brown: '#8A5A3B',
  soy: '#5B3524',
  toast: '#C98A45',
  yolk: '#F2A516',
  white: '#FFF9EE',
  broth: '#D98B3C',
  blush: '#EFC6A8',
  ink: '#3A2E27',
};

type Pt = [number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;
const mid = (a: Pt, b: Pt): string => `${r1((a[0] + b[0]) / 2)} ${r1((a[1] + b[1]) / 2)}`;

/** An irregular, hand-painted looking ellipse. */
export function blob(cx: number, cy: number, rx: number, ry: number, seed = 1, wobble = 0.07, n = 12): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wobble * (Math.sin(a * 3 + seed) * 0.6 + Math.sin(a * 5 + seed * 1.7) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  let d = `M${mid(pts[n - 1], pts[0])}`;
  for (let i = 0; i < n; i++) d += ` Q${r1(pts[i][0])} ${r1(pts[i][1])} ${mid(pts[i], pts[(i + 1) % n])}`;
  return `${d}Z`;
}

/** A wavy line, used for noodles and brush marks. */
function wave(x0: number, y0: number, x1: number, y1: number, amp: number, waves: number): string {
  const steps = waves * 2;
  let d = `M${r1(x0)} ${r1(y0)}`;
  for (let i = 1; i <= steps; i++) {
    const t0 = (i - 0.5) / steps;
    const t1 = i / steps;
    const cx = x0 + (x1 - x0) * t0;
    const cy = y0 + (y1 - y0) * t0 + (i % 2 ? -amp : amp);
    d += ` Q${r1(cx)} ${r1(cy)} ${r1(x0 + (x1 - x0) * t1)} ${r1(y0 + (y1 - y0) * t1)}`;
  }
  return d;
}

/** Deterministic scatter of small dots (seeds, specks, chilli flakes). */
function specks(cx: number, cy: number, rx: number, ry: number, count: number, seed: number, r: number, fill: string) {
  const out: JSX.Element[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i * 2.399 + seed) % (Math.PI * 2);
    const d = Math.sqrt(((i * 7 + seed * 13) % count) / count);
    out.push(<ellipse key={i} cx={r1(cx + Math.cos(a) * rx * d)} cy={r1(cy + Math.sin(a) * ry * d)} rx={r} ry={r * 0.8} fill={fill} />);
  }
  return out;
}

function Backdrop({ fill, seed = 2 }: { fill: string; seed?: number }) {
  return <path d={blob(100, 104, 88, 84, seed, 0.06)} fill={fill} opacity={0.55} />;
}

function Bowl({ body, rim, inner }: { body: string; rim: string; inner: string }) {
  return (
    <>
      <ellipse cx="100" cy="166" rx="48" ry="8" fill={C.ink} opacity="0.12" />
      <path d="M38 100 C40 142 70 164 100 164 C130 164 160 142 162 100 Z" fill={body} />
      <path d="M52 112 C60 138 78 150 96 152" stroke={C.white} stroke-width="5" fill="none" opacity="0.35" stroke-linecap="round" />
      <path d="M84 162 L116 162 L113 169 L87 169 Z" fill={body} />
      <path d={blob(100, 100, 62, 19, 3, 0.02)} fill={rim} />
      <path d={blob(100, 100, 55, 15, 5, 0.02)} fill={inner} />
    </>
  );
}

function Plate({ rim = C.cream, edge = C.tomato, y = 124 }: { rim?: string; edge?: string; y?: number }) {
  return (
    <>
      <ellipse cx="100" cy={y + 10} rx="80" ry="30" fill={C.ink} opacity="0.12" />
      <path d={blob(100, y, 82, 34, 4, 0.02)} fill={edge} />
      <path d={blob(100, y - 2, 76, 30, 6, 0.02)} fill={rim} />
      <path d={blob(100, y, 58, 21, 8, 0.03)} fill={C.white} opacity="0.6" />
    </>
  );
}

function EggHalf({ x, y, s = 1, rot = 0 }: { x: number; y: number; s?: number; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d={blob(0, 0, 15, 11, 2, 0.05)} fill={C.white} />
      <path d={blob(0, 1, 8, 6.5, 4, 0.08)} fill={C.yolk} />
      <ellipse cx="-2" cy="-1" rx="3" ry="2" fill={C.mustardLight} opacity="0.8" />
    </g>
  );
}

function FriedEgg({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={blob(0, 0, 26, 17, 7, 0.16, 16)} fill={C.white} />
      <path d={blob(0, 0, 26, 17, 7, 0.16, 16)} fill="none" stroke={C.toast} stroke-width="2.5" opacity="0.6" />
      <path d={blob(3, -2, 10, 8, 3, 0.05)} fill={C.yolk} />
      <ellipse cx="0" cy="-5" rx="3.5" ry="2" fill={C.mustardLight} />
    </g>
  );
}

function Chopsticks() {
  return (
    <g stroke-linecap="round">
      <path d="M150 40 L72 118" stroke={C.brown} stroke-width="5" />
      <path d="M162 48 L80 124" stroke={C.soy} stroke-width="5" />
    </g>
  );
}

function Steam() {
  return (
    <g class="art-steam" stroke={C.white} stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8">
      <path d="M80 70 C72 58 88 50 80 36" />
      <path d="M102 66 C94 52 112 44 104 28" />
      <path d="M124 70 C116 58 132 50 124 38" />
    </g>
  );
}

function Scallions({ cx, cy, rx, ry, count = 7, seed = 1 }: { cx: number; cy: number; rx: number; ry: number; count?: number; seed?: number }) {
  const out: JSX.Element[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.4 + seed;
    const d = ((i * 5 + seed) % count) / count;
    out.push(
      <circle key={i} cx={r1(cx + Math.cos(a) * rx * d)} cy={r1(cy + Math.sin(a) * ry * d)} r="3.4" fill="none" stroke={C.olive} stroke-width="2.4" />,
    );
  }
  return <>{out}</>;
}

function Chilli({ x, y, rot = 0 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <ellipse rx="4.5" ry="3.8" fill={C.tomato} />
      <ellipse rx="2" ry="1.6" fill={C.mustardLight} opacity="0.8" />
    </g>
  );
}

const RICE_TOPPINGS: Record<string, () => JSX.Element> = {
  tomatoEgg: () => (
    <>
      <path d={blob(108, 94, 32, 11, 3, 0.18)} fill={C.tomato} />
      <path d={blob(98, 92, 12, 6, 2, 0.2)} fill={C.yolk} />
      <path d={blob(120, 96, 10, 5, 5, 0.2)} fill={C.mustardLight} />
      <path d={blob(112, 90, 8, 4, 7, 0.2)} fill={C.tomatoDeep} />
      <Scallions cx={104} cy={92} rx={26} ry={6} count={5} seed={3} />
    </>
  ),
  tuna: () => (
    <>
      <path d={blob(106, 92, 28, 10, 2, 0.2)} fill="#EAD3A8" />
      {specks(106, 92, 22, 7, 12, 3, 1.8, '#C9A77A')}
      <path d="M76 90 l14 -8 l3 6 l-14 8z M124 86 l16 -4 l1 7 l-16 3z" fill="#2F3A2A" />
      <Scallions cx={104} cy={90} rx={22} ry={5} count={5} seed={5} />
    </>
  ),
  omelette: () => (
    <>
      <path d={blob(104, 92, 38, 12, 4, 0.14)} fill="#C98A45" />
      <path d={blob(104, 91, 33, 10, 6, 0.12)} fill="#F2B84B" />
      {specks(104, 91, 26, 7, 8, 2, 2.2, '#F7D38A')}
      <path d={wave(78, 90, 128, 92, 2, 3)} stroke={C.soy} stroke-width="2.6" fill="none" stroke-linecap="round" />
      <Chilli x={92} y={94} />
      <Chilli x={120} y={88} rot={30} />
    </>
  ),
  tofu: () => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(${80 + i * 11} ${88 + (i % 2) * 6}) rotate(${i * 11 - 20})`}>
          <rect x="-7" y="-6" width="14" height="12" rx="2.5" fill="#B9742F" />
          <rect x="-5" y="-5" width="10" height="7" rx="2" fill="#E9B25A" />
        </g>
      ))}
      <Scallions cx={104} cy={90} rx={24} ry={5} count={5} seed={7} />
      <Chilli x={126} y={88} rot={10} />
    </>
  ),
  chicken: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${84 + i * 12} ${91 + (i % 2) * 2}) rotate(-8)`}>
          <path d={blob(0, 0, 8, 10, i, 0.08)} fill="#F4E2C4" />
          <path d="M-7 -6 q7 -6 14 0" stroke="#C98A45" stroke-width="3.2" fill="none" stroke-linecap="round" />
        </g>
      ))}
      <g transform="translate(132 94)">
        <ellipse rx="7" ry="4.5" fill="#CFE0A6" />
        <ellipse rx="7" ry="4.5" fill="none" stroke={C.oliveDeep} stroke-width="1.4" />
      </g>
      <Scallions cx={100} cy={88} rx={20} ry={4} count={4} seed={2} />
    </>
  ),
};

const ART: Record<ArtKind, (variant?: string) => JSX.Element> = {
  noodleSoup: () => (
    <>
      <Backdrop fill={C.mustardLight} />
      <Steam />
      <Bowl body={C.olive} rim={C.cream} inner={C.broth} />
      <g clip-path="url(#ew-bowl)" fill="none" stroke-linecap="round">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={wave(48, 96 + i * 3, 152, 92 + i * 4, 4, 5)} stroke={i % 2 ? C.mustardLight : '#F7D98A'} stroke-width="3.2" />
        ))}
        <path d={blob(76, 97, 16, 7, 2)} fill={C.oliveLight} stroke="none" />
        <path d={blob(78, 96, 10, 4, 5)} fill={C.olive} stroke="none" />
      </g>
      <EggHalf x={118} y={96} s={1.05} rot={-8} />
      <Scallions cx={96} cy={102} rx={30} ry={7} count={6} seed={2} />
      <Chilli x={138} y={104} rot={20} />
      <Chopsticks />
    </>
  ),
  friedNoodles: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={4} />
      <Plate edge={C.tomato} />
      <path d={blob(100, 112, 58, 24, 3, 0.1)} fill="#B8783A" />
      <g fill="none" stroke-linecap="round">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <path key={i} d={wave(50 + (i % 3) * 4, 100 + i * 3, 150 - (i % 2) * 6, 98 + i * 3.4, 4 + (i % 3), 5)} stroke={i % 3 === 0 ? C.soy : i % 3 === 1 ? '#D9A355' : '#C88A42'} stroke-width="3.4" />
        ))}
      </g>
      <path d={blob(70, 104, 10, 5, 3)} fill={C.olive} />
      <path d={blob(128, 116, 12, 5, 6)} fill={C.oliveDeep} />
      <EggHalf x={96} y={98} s={1.1} rot={6} />
      <EggHalf x={120} y={102} s={0.95} rot={-10} />
      <Chilli x={78} y={118} rot={10} />
      <Chilli x={140} y={104} rot={40} />
      <path d="M150 128 L166 116 L170 130 Z" fill={C.oliveLight} />
      <Scallions cx={104} cy={112} rx={38} ry={8} count={6} seed={4} />
    </>
  ),
  nasiLemak: () => (
    <>
      <Backdrop fill={C.blush} seed={6} />
      <Plate edge={C.oliveDeep} rim={C.cream} />
      <path d="M36 122 C60 92 140 90 168 118 C140 146 62 150 36 122 Z" fill={C.olive} />
      <path d="M40 122 C80 116 124 116 164 118" stroke={C.oliveDeep} stroke-width="2" fill="none" />
      <path d={blob(84, 108, 30, 20, 2, 0.05)} fill={C.rice} />
      <path d="M62 102 C72 88 96 86 108 98" stroke={C.cream} stroke-width="3" fill="none" opacity="0.8" />
      {specks(84, 110, 24, 14, 10, 3, 1.2, '#EFE4CF')}
      <path d={blob(128, 104, 16, 11, 8, 0.12)} fill={C.tomatoDeep} />
      <path d={blob(126, 102, 9, 6, 2, 0.1)} fill={C.tomato} />
      <FriedEgg x={112} y={128} s={0.9} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${56 + i * 12} ${130 + i * 2})`}>
          <ellipse rx="8" ry="5" fill="#CFE0A6" />
          <ellipse rx="8" ry="5" fill="none" stroke={C.oliveDeep} stroke-width="1.6" />
          <ellipse rx="3" ry="1.8" fill="#E8F0CC" />
        </g>
      ))}
      {specks(148, 124, 10, 6, 7, 1, 2.6, '#D8A86A')}
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${140 + i * 4} ${138 - (i % 2) * 4} q4 -3 8 0`} stroke={C.toast} stroke-width="2.4" fill="none" stroke-linecap="round" />
      ))}
    </>
  ),
  friedRice: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={1} />
      <Plate edge={C.mustard} />
      <path d={blob(100, 110, 56, 28, 5, 0.08)} fill="#E9C27A" />
      <path d={blob(96, 104, 40, 18, 2, 0.08)} fill="#F2D597" />
      {specks(100, 110, 50, 22, 26, 2, 1.6, C.rice)}
      {specks(100, 110, 46, 20, 9, 5, 3.4, C.yolk)}
      {specks(100, 112, 44, 20, 8, 9, 2.8, C.olive)}
      {specks(98, 108, 40, 18, 5, 4, 2.2, C.tomato)}
      <path d="M140 72 C150 90 148 100 132 108" stroke={C.brown} stroke-width="0" fill="none" />
      <g transform="translate(150 96) rotate(35)">
        <ellipse cx="0" cy="0" rx="10" ry="14" fill="#C9C1B3" />
        <rect x="-2.5" y="-46" width="5" height="34" rx="2.5" fill="#B7AE9E" />
      </g>
    </>
  ),
  riceBowl: (v) => (
    <>
      <Backdrop fill={C.oliveLight} seed={3} />
      <Bowl body={C.mustard} rim={C.cream} inner={C.rice} />
      <path d={blob(100, 92, 48, 16, 4, 0.08)} fill={C.rice} />
      {specks(100, 96, 44, 10, 14, 6, 1.3, '#EDE3D0')}
      <g transform="translate(104 86) scale(1.3) translate(-104 -90)">{(RICE_TOPPINGS[v ?? ''] ?? RICE_TOPPINGS.tomatoEgg)()}</g>
      <Steam />
    </>
  ),
  curry: (v) => (
    <>
      <Backdrop fill={C.mustardLight} seed={5} />
      <Steam />
      <Bowl body={v === 'dhal' ? C.olive : C.tomatoDeep} rim={C.cream} inner={v === 'dhal' ? '#E8B546' : '#D9772B'} />
      <g clip-path="url(#ew-bowl)">
        <path d={blob(84, 100, 14, 7, 1, 0.1)} fill={C.mustardLight} />
        {v !== 'dhal' && <path d={blob(116, 98, 13, 7, 3, 0.1)} fill={C.brown} />}
        <path d={blob(132, 104, 10, 5, 6, 0.1)} fill={C.mustardLight} />
        {v !== 'dhal' && <path d={blob(100, 106, 11, 5, 8, 0.1)} fill={C.soy} opacity="0.8" />}
        <path d={wave(62, 96, 90, 104, 3, 2)} stroke={C.cream} stroke-width="3" fill="none" opacity="0.7" />
        <path d={wave(110, 108, 140, 96, 3, 2)} stroke={C.cream} stroke-width="2.5" fill="none" opacity="0.6" />
        {specks(100, 100, 44, 10, 8, 4, 1.6, C.tomatoDeep)}
      </g>
      <path d="M70 92 q8 -10 18 -4 q-8 8 -18 4Z" fill={C.oliveDeep} />
      <path d="M78 90 q10 -8 18 0 q-10 6 -18 0Z" fill={C.olive} />
    </>
  ),
  roti: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={8} />
      <Plate edge={C.olive} />
      <path d={blob(88, 118, 48, 24, 2, 0.14, 16)} fill="#E7B865" />
      <path d={blob(88, 116, 38, 18, 5, 0.16, 14)} fill="#EFC77A" />
      {[0, 1, 2].map((i) => (
        <path key={i} d={blob(88, 116, 30 - i * 9, 14 - i * 4, i + 3, 0.2)} fill="none" stroke={C.toast} stroke-width="2.2" opacity="0.8" />
      ))}
      {specks(88, 118, 40, 18, 8, 3, 2.2, '#B97A35')}
      <path d={blob(146, 106, 22, 10, 3, 0.03)} fill={C.cream} />
      <path d="M124 106 C126 122 166 122 168 106 Z" fill={C.cream} />
      <path d={blob(146, 106, 18, 7, 4, 0.04)} fill={C.mustard} />
      {specks(146, 106, 14, 4, 5, 2, 1.6, C.olive)}
    </>
  ),
  toast: (v) => (
    <>
      <Backdrop fill={C.blush} seed={9} />
      <Plate edge={C.olive} y={128} />
      <g transform="translate(80 114) rotate(-8)">
        <path d="M-40 18 L-24 -26 C-20 -38 4 -40 10 -28 L28 18 Z" fill={C.toast} />
        <path d="M-33 14 L-19 -22 C-15 -32 1 -33 6 -24 L22 14 Z" fill="#F0D19A" />
        {v === 'sardine' ? (
          <>
            <path d={blob(-8, -14, 20, 12, 3, 0.2)} fill="#C8502E" />
            <path d={blob(-12, -17, 9, 5, 5, 0.2)} fill="#8C8C84" />
            <path d={blob(2, -11, 8, 4, 2, 0.2)} fill="#A3A197" />
            <path d="M-20 -22 q5 -3 10 0 M-4 -24 q5 -3 10 1" stroke={C.cream} stroke-width="2" fill="none" />
            {specks(-8, -14, 14, 7, 5, 2, 1.6, C.oliveDeep)}
          </>
        ) : (
          <>
            <path d="M-30 4 L20 4 L22 12 L-33 12 Z" fill={C.oliveLight} />
            <path d="M-28 -2 L18 -2 L20 5 L-30 5 Z" fill="#FBEBB0" />
          </>
        )}
      </g>
      <g transform="translate(96 120) rotate(10)">
        <path d="M-36 18 L-20 -24 C-16 -34 6 -36 12 -26 L28 18 Z" fill="#B87A38" />
        <path d="M-29 14 L-16 -20 C-12 -29 3 -30 8 -22 L22 14 Z" fill="#EBC687" />
      </g>
      <path d={blob(146, 126, 24, 10, 2, 0.03)} fill={C.cream} />
      <path d="M122 126 C124 142 168 142 170 126 Z" fill={C.cream} />
      <path d={blob(146, 126, 20, 7, 5, 0.06)} fill={C.soy} />
      <path d={blob(142, 124, 10, 5, 3, 0.15)} fill={C.white} opacity="0.9" />
      <path d={blob(143, 124, 5, 3.5, 3, 0.1)} fill={C.yolk} />
      <path d={blob(154, 128, 7, 3.5, 6, 0.15)} fill={C.white} opacity="0.8" />
    </>
  ),
  porridge: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={2} />
      <Steam />
      <Bowl body={C.tomato} rim={C.cream} inner="#F3EAD6" />
      <g clip-path="url(#ew-bowl)">
        <path d={wave(56, 100, 144, 100, 2, 3)} stroke={C.white} stroke-width="4" fill="none" opacity="0.8" />
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M${86 + i * 6} ${94 + (i % 2) * 4} l12 3`} stroke={C.blush} stroke-width="3.4" stroke-linecap="round" />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${66 + i * 5} ${98 + (i % 2) * 3} l9 -2`} stroke={C.mustardLight} stroke-width="2" stroke-linecap="round" />
        ))}
        {specks(122, 98, 16, 5, 9, 2, 2, C.brown)}
      </g>
      <Scallions cx={100} cy={100} rx={30} ry={6} count={6} seed={6} />
      <g transform="translate(140 76) rotate(30)">
        <ellipse cx="0" cy="22" rx="9" ry="12" fill={C.cream} />
        <rect x="-3" y="-20" width="6" height="34" rx="3" fill={C.cream} />
      </g>
    </>
  ),
  pasta: () => (
    <>
      <Backdrop fill={C.mustardLight} seed={7} />
      <Plate edge={C.oliveDeep} />
      <path d={blob(100, 110, 52, 28, 4, 0.1)} fill="#C98F34" />
      <path d={blob(98, 104, 42, 22, 2, 0.1)} fill="#E2AE4E" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={wave(52 + (i % 2) * 6, 96 + i * 4.5, 148 - (i % 3) * 5, 100 + i * 3.5, 5 + (i % 3), 4)}
          stroke={i % 2 ? '#F6D68A' : '#B97F2C'}
          stroke-width="3"
          fill="none"
          stroke-linecap="round"
        />
      ))}
      <path d={blob(100, 98, 20, 9, 5, 0.1)} fill="none" stroke="#F6D68A" stroke-width="3" />
      <path d={blob(100, 98, 10, 4.5, 3, 0.1)} fill="none" stroke="#B97F2C" stroke-width="2.6" />
      {specks(100, 106, 40, 18, 14, 3, 1.8, C.tomato)}
      {specks(100, 106, 36, 16, 8, 7, 3, C.olive)}
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx={74 + i * 17} cy={100 + (i % 2) * 12} rx="4.5" ry="3" fill={C.cream} stroke={C.mustardLight} stroke-width="1" />
      ))}
      <path d="M156 60 L126 104" stroke="#B7AE9E" stroke-width="5" stroke-linecap="round" />
      <path d="M126 104 l-6 9 M129 106 l-3 10 M132 107 l0 10" stroke="#B7AE9E" stroke-width="2.4" stroke-linecap="round" />
    </>
  ),
  grill: () => (
    <>
      <Backdrop fill={C.mustardLight} seed={10} />
      <Plate edge={C.tomato} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${70 + i * 18} ${96 + i * 8}) rotate(-24)`}>
          <rect x="-44" y="-1.6" width="96" height="3.2" rx="1.6" fill={C.toast} />
          {[0, 1, 2, 3].map((j) => (
            <path key={j} d={blob(-26 + j * 15, 0, 8, 6, j + i, 0.18)} fill={j % 2 ? C.brown : '#A5642E'} />
          ))}
          {[0, 1, 2, 3].map((j) => (
            <path key={j} d={`M${-30 + j * 15} -3 l4 4`} stroke={C.soy} stroke-width="2" stroke-linecap="round" />
          ))}
        </g>
      ))}
      <path d={blob(146, 134, 18, 8, 3, 0.03)} fill={C.cream} />
      <path d={blob(146, 133, 14, 5.5, 4, 0.08)} fill="#C27A36" />
      {specks(146, 133, 10, 3, 5, 2, 1.4, C.tomatoDeep)}
    </>
  ),
  burger: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={11} />
      <Plate edge={C.mustard} y={134} />
      <g transform="translate(92 0)">
        <path d="M-40 128 C-40 140 40 140 40 128 Z" fill="#D69A4E" />
        <path d={blob(0, 118, 42, 8, 2, 0.08)} fill={C.brown} />
        <path d="M-44 112 L44 112 L36 122 L-36 122 Z" fill={C.mustardLight} />
        <path d={wave(-44, 108, 44, 108, 4, 6)} stroke={C.olive} stroke-width="7" fill="none" stroke-linecap="round" />
        <path d={blob(-10, 104, 18, 5, 1)} fill={C.tomato} />
        <path d={blob(18, 104, 16, 5, 2)} fill={C.tomato} />
        <path d="M-40 100 C-40 64 40 64 40 100 Z" fill="#D69A4E" />
        <path d="M-28 82 C-20 72 -4 70 6 70" stroke="#EBC27E" stroke-width="5" fill="none" stroke-linecap="round" />
        {specks(0, 82, 26, 8, 8, 2, 1.8, C.cream)}
      </g>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={140 + i * 5} y={100 + (i % 2) * 6} width="5" height="34" rx="2" fill={C.mustardLight} transform={`rotate(${-8 + i * 4} ${142 + i * 5} 134)`} />
      ))}
    </>
  ),
  sushi: () => (
    <>
      <Backdrop fill={C.blush} seed={12} />
      <ellipse cx="100" cy="142" rx="80" ry="12" fill={C.ink} opacity="0.12" />
      <path d="M26 118 L170 104 L176 132 L32 146 Z" fill={C.toast} />
      <path d="M32 146 L176 132 L176 138 L34 152 Z" fill={C.brown} />
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${66 + i * 36} ${114 - i * 4})`}>
          <path d={blob(0, 4, 17, 8, i + 2, 0.06)} fill={C.rice} />
          <path d={blob(0, -2, 19, 8, i + 5, 0.08)} fill="#EE8A55" />
          <path d="M-12 -4 l6 6 M-2 -6 l6 7 M8 -5 l5 6" stroke={C.blush} stroke-width="2" stroke-linecap="round" />
        </g>
      ))}
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${140 + i * 16} ${104 - i * 2})`}>
          <ellipse rx="10" ry="10" fill="#2F3A2A" />
          <ellipse rx="7.5" ry="7.5" fill={C.rice} />
          <path d={blob(0, 0, 3.5, 3.5, i, 0.15)} fill={i ? C.olive : '#EE8A55'} />
        </g>
      ))}
      <path d={blob(52, 132, 8, 4, 3, 0.15)} fill={C.olive} />
      <path d="M30 70 L150 88" stroke={C.soy} stroke-width="4.5" stroke-linecap="round" />
      <path d="M30 78 L150 94" stroke={C.brown} stroke-width="4.5" stroke-linecap="round" />
    </>
  ),
  dessert: () => (
    <>
      <Backdrop fill={C.oliveLight} seed={13} />
      <Plate edge={C.tomato} y={138} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <path d={blob(100, 128 - i * 13, 44, 12, i + 1, 0.04)} fill="#C98A45" />
          <path d={blob(100, 124 - i * 13, 42, 10, i + 3, 0.04)} fill="#EFC77A" />
        </g>
      ))}
      <path d="M68 86 C72 96 70 104 74 112 C76 104 78 96 84 90 L116 86 C120 96 118 110 124 116 C126 104 128 94 132 86 Z" fill={C.brown} opacity="0.9" />
      <path d={blob(100, 84, 36, 8, 3, 0.1)} fill={C.brown} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${86 + i * 14} ${80 - (i % 2) * 2})`}>
          <ellipse rx="7" ry="4" fill="#F7E7B4" />
          <ellipse rx="2.5" ry="1.4" fill="#D6BF7A" />
        </g>
      ))}
    </>
  ),
  greens: () => (
    <>
      <Backdrop fill={C.mustardLight} seed={14} />
      <Plate edge={C.tomato} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path key={i} d={wave(46 + (i % 3) * 6, 104 + i * 4, 150 - (i % 2) * 8, 110 + (i % 4) * 3, 3, 3)} stroke={i % 2 ? '#9FB26A' : '#8BA45A'} stroke-width="4" fill="none" stroke-linecap="round" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={blob(58 + i * 16, 104 + (i % 3) * 8, 13, 5, i + 2, 0.2)} fill={i % 2 ? C.olive : C.oliveDeep} transform={`rotate(${-20 + i * 9} ${58 + i * 16} ${104 + (i % 3) * 8})`} />
      ))}
      <Chilli x={82} y={116} rot={20} />
      <Chilli x={118} y={108} />
      <Chilli x={136} y={120} rot={60} />
      {specks(100, 112, 44, 14, 10, 3, 1.8, '#F6E7C4')}
      {specks(100, 114, 40, 12, 6, 6, 2, C.tomatoDeep)}
    </>
  ),
};

interface FoodArtProps {
  kind: ArtKind;
  /** Optional topping/variant, e.g. "tuna" for a rice bowl. */
  variant?: string;
  size?: number | string;
  class?: string;
  /** Decorative by default; pass a label when the art carries meaning. */
  label?: string;
}

export function FoodArt({ kind, variant, size = '100%', class: className, label }: FoodArtProps) {
  const draw = ART[kind] ?? ART.riceBowl;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      class={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <g filter="url(#ew-gouache)">{draw(variant)}</g>
    </svg>
  );
}

/** Shared SVG filters and clip paths. Render once near the app root. */
export function ArtDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="ew-bowl" clipPathUnits="userSpaceOnUse">
          <ellipse cx="100" cy="100" rx="55" ry="15" />
        </clipPath>
        <filter id="ew-gouache" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="5" xChannelSelector="R" yChannelSelector="G" result="shape" />
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.11" numOctaves="2" seed="9" result="streakNoise" />
          <feColorMatrix
            in="streakNoise"
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  1.3 0 0 0 -0.62"
            result="streakLight"
          />
          <feComposite in="streakLight" in2="shape" operator="in" result="streaks" />
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="grainNoise" />
          <feColorMatrix
            in="grainNoise"
            type="matrix"
            values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.12  1.25 0 0 0 -0.66"
            result="grainDark"
          />
          <feComposite in="grainDark" in2="shape" operator="in" result="grain" />
          <feMerge>
            <feMergeNode in="shape" />
            <feMergeNode in="streaks" />
            <feMergeNode in="grain" />
          </feMerge>
        </filter>
        <filter id="ew-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
