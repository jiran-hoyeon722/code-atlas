import type { LaneView, Side } from './view';

// Style-frame geometry: a 500×320 table, lanes at y 60/160/260, squads 38 apart from the middle.
const W = 500;
const H = 320;
const LANE_Y = [60, 160, 260];
const SHOWN = 5;
const DOTS = 6;

const at = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

function squadDots(side: Side, lane: number, queue: string[]) {
  const dots = [];
  const n = Math.min(SHOWN, queue.length);
  for (let q = 0; q < n; q++) {
    const x0 = side === 'a' ? 214 - q * 38 : 286 + q * 38;
    for (let i = 0; i < DOTS; i++) {
      const x = x0 + (side === 'a' ? -(i % 3) : i % 3) * 8;
      const y = LANE_Y[lane] - 8 + Math.floor(i / 3) * 10;
      dots.push(<span key={`${q}-${i}`} className={`rb-field-dot rb-field-dot-${side}${q === 0 ? ' rb-field-dot-lead' : ''}`} style={at(x, y)} />);
    }
  }
  return dots;
}

export function Field({ lanes }: { lanes: LaneView[] }) {
  return (
    <div className="rb-field" aria-hidden="true">
      <div className="rb-field-plane">
        <span className="rb-field-line rb-field-line-h" style={{ top: `${(110 / H) * 100}%` }} />
        <span className="rb-field-line rb-field-line-h" style={{ top: `${(210 / H) * 100}%` }} />
        <span className="rb-field-line rb-field-line-v" style={{ left: `${(249 / W) * 100}%` }} />
        {lanes.map((l, i) => (
          <span key={l.lane} className="rb-field-lane">
            {squadDots('a', i, l.a)}
            {squadDots('b', i, l.b)}
          </span>
        ))}
        <span className="rb-field-commander rb-field-commander-a" style={at(14, 150)} />
        <span className="rb-field-commander rb-field-commander-b" style={at(472, 150)} />
      </div>
    </div>
  );
}
