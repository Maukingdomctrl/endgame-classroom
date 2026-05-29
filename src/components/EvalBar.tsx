/**
 * EvalBar.tsx
 *
 * bar = 0–100 (White win%). 50 = equal. >50 = White better. <50 = Black better.
 *
 * FIX: When no eval has arrived yet (cp===null, mate===null), show "—" instead
 * of "0.0" which was misleading (implied a drawn position before any analysis).
 */

export const EVAL_W   = 16;
export const EVAL_GAP = 12;

interface EvalBarProps {
  bar:  number;
  cp:   number | null;
  mate: number | null;
  size: number;
}

export default function EvalBar({ bar, cp, mate, size }: EvalBarProps) {
  const pct       = Math.max(0, Math.min(100, bar));
  const barHeight = size - 24;

  // Show "—" until the first real eval arrives
  const noEval = cp === null && mate === null;

  let label: string;
  if (noEval) {
    label = '—';
  } else if (mate !== null) {
    label = mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  } else {
    const pawns = (cp as number) / 100;
    label = pawns > 0 ? `+${pawns.toFixed(1)}` : pawns < 0 ? pawns.toFixed(1) : '0.0';
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      width: EVAL_W, height: size, flexShrink: 0, marginRight: EVAL_GAP,
    }}>
      <div style={{
        width: '100%', height: barHeight,
        border: '1px solid #2b261f', borderRadius: 1,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        background: '#1c1813',
      }}>
        {/* Black portion — top */}
        <div style={{
          width: '100%',
          background: '#2b251f',
          height: `${100 - pct}%`,
          transition: 'height 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }} />
        {/* White portion — bottom */}
        <div style={{
          width: '100%',
          background: '#d9cb9e',
          height: `${pct}%`,
          transition: 'height 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }} />
      </div>
      <span style={{
        fontSize: 10, color: '#8c7e6b', marginTop: 4,
        whiteSpace: 'nowrap', fontFamily: 'Georgia, serif', fontStyle: 'italic',
      }}>
        {label}
      </span>
    </div>
  );
}