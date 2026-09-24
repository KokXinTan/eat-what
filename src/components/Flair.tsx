// Small shared bits of delight: the card-shuffle loader and the celebration splats.

export function Deal({ label = "Sniffing out what's nearby…" }: { label?: string }) {
  return (
    <div class="deck" role="status" aria-label={label}>
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

export function Splats() {
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
