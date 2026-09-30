import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCommentary, type CommentaryEntry } from '../../../engine/battle/commentary';
import { buildArmy, simulate, type Arena, type BattleResult, type Side } from '../../../engine/battle/sim';
import type { Quality } from '../../../engine/battle/types';
import { hasWebGL } from '../../shell/webgl';
import type { Speed } from './clock';
import { mountField, type FieldHandle } from './mountField';
import { CMD_SLOT, MODE_FIELD, Replay, blendedPos } from './replay';
import {
  badgeOf,
  hudModel,
  metaOf,
  pinnedEntry,
  sourceOf,
  tagModels,
  visibleEntries,
  type Filter,
  type HudModel,
  type TagModel,
  type Tone,
} from './view';
import './engage.css';

export interface EngageScreenProps {
  a: Quality;
  b: Quality;
  match: number;
  prior: { a: number; b: number };
  onDone(result: BattleResult): void;
  onBack(): void;
}

interface Snapshot {
  tick: number;
  hud: HudModel;
  tags: TagModel[];
  paused: boolean;
  speed: Speed;
  done: boolean;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function snapshotOf(r: Replay): Snapshot {
  return {
    tick: r.battle.tick,
    hud: hudModel(r.battle),
    tags: tagModels(r.battle),
    paused: r.clock.paused,
    speed: r.clock.speed,
    done: r.done,
  };
}

export function EngageScreen({ a, b, match, prior, onDone, onBack }: EngageScreenProps) {
  const pa = prior.a;
  const pb = prior.b;
  const pre = useMemo(() => {
    const result = simulate(a, b, match, { record: true });
    const commentary = buildCommentary({ result, armies: { a: buildArmy(a), b: buildArmy(b) }, quality: { a, b }, prior: { a: pa, b: pb } });
    return { result, entries: commentary.entries };
  }, [a, b, match, pa, pb]);

  const [reduced] = useState(prefersReducedMotion);
  const [failed, setFailed] = useState(false);
  const [webgl] = useState(() => !reduced && hasWebGL());
  const live = webgl && !reduced && !failed;

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [focused, setFocused] = useState<Arena | null>(null);

  const fieldEl = useRef<HTMLDivElement>(null);
  const replayRef = useRef<Replay | null>(null);
  const fieldRef = useRef<FieldHandle | null>(null);
  const tagsRef = useRef<TagModel[]>([]);
  const tagEls = useRef(new Map<string, HTMLElement>());

  const names: Record<Side, string> = { a: a.name, b: b.name };

  useEffect(() => {
    if (!live || !fieldEl.current) return;
    const replay = new Replay(a, b, match, pre.result.ticks, pre.result.final.tick);
    let field: FieldHandle;
    try {
      field = mountField(fieldEl.current, replay);
    } catch {
      setFailed(true);
      return;
    }
    replayRef.current = replay;
    fieldRef.current = field;
    const first = snapshotOf(replay);
    tagsRef.current = first.tags;
    setSnap(first);

    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (replay.update(dt)) {
        field.effects(replay.drain(), replay, now);
        const s = snapshotOf(replay);
        tagsRef.current = s.tags;
        setSnap(s);
      }
      field.draw(replay, now);
      placeTags(replay, field, tagsRef.current, tagEls.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      field.dispose();
      replayRef.current = null;
      fieldRef.current = null;
    };
  }, [live, a, b, match, pre]);

  const publish = useCallback(() => {
    const r = replayRef.current;
    if (!r) return;
    const s = snapshotOf(r);
    tagsRef.current = s.tags;
    setSnap(s);
  }, []);

  const togglePause = useCallback(() => {
    replayRef.current?.togglePause();
    publish();
  }, [publish]);

  const toggleSpeed = () => {
    const r = replayRef.current;
    if (!r) return;
    r.setSpeed(r.clock.speed === 2 ? 1 : 2);
    publish();
  };

  const skipToFinal = () => {
    const r = replayRef.current;
    if (!r) return;
    if (r.skipToFinal()) fieldRef.current?.effects(r.drain(), r, performance.now());
    publish();
  };

  const focus = (arena: Arena | null) => {
    const next = arena === focused ? null : arena;
    setFocused(next);
    fieldRef.current?.focus(next, performance.now());
  };

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const el = e.target as HTMLElement | null;
      if (el && el.closest('button, input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, togglePause]);

  const tick = live ? (snap?.tick ?? 0) : pre.result.ticks;
  const pinned = pinnedEntry(pre.entries, tick);
  const list = visibleEntries(pre.entries, tick, filter);
  const anyRevealed = pinned !== null || pre.entries.some((e) => e.tick <= tick);
  const showResult = !live || (snap?.done ?? false);

  const resultButton = (
    <button type="button" className="rb-btn rb-btn-primary rb-eng-result" onClick={() => onDone(pre.result)}>
      결과 보기
    </button>
  );

  return (
    <div className="rb-engage">
      <h1 className="rb-eng-sr" tabIndex={-1} data-screen-focus>
        전투 장면
      </h1>
      <section className="rb-eng-field" aria-label="전장">
        {live ? (
          <>
            <div className="rb-eng-stage" ref={fieldEl} />
            <div className="rb-eng-tags">
              {snap?.tags.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`rb-eng-tag rb-eng-tag-${t.side}${t.squad < 0 ? ' rb-eng-tag-cmd' : ''}`}
                  ref={(el) => {
                    if (el) tagEls.current.set(t.key, el);
                    else tagEls.current.delete(t.key);
                  }}
                  onClick={() => focus(t.arena)}
                  aria-label={`${names[t.side]} ${t.label}, ${t.count}. 누르면 ${t.arena === 'final' ? '가운데로' : '이 레인으로'} 카메라가 이동해요`}
                >
                  <span className="rb-eng-tag-row">
                    <span className="rb-eng-tag-name">
                      <span className="rb-eng-dot" aria-hidden="true" />
                      {t.label}
                    </span>
                    <span className="rb-eng-tag-count">{t.count}</span>
                  </span>
                  <span className="rb-eng-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(t.hp * 100)}%` }} />
                  </span>
                </button>
              ))}
            </div>
            {snap && (
              <div className="rb-eng-hud">
                <div className="rb-eng-round">
                  <p className="rb-eng-round-title">{snap.hud.title}</p>
                  <p className="rb-eng-round-sub">{snap.hud.subtitle}</p>
                </div>
                <div className="rb-eng-score" role="group" aria-label={`남은 부대 ${names.a} ${snap.hud.remaining.a}, ${names.b} ${snap.hud.remaining.b}`}>
                  <div className="rb-eng-score-row">
                    <span className="rb-eng-name rb-eng-name-a" title={names.a}>{names.a}</span>
                    <span className="rb-eng-score-num">
                      {snap.hud.remaining.a} <span className="rb-eng-colon">:</span> {snap.hud.remaining.b}
                    </span>
                    <span className="rb-eng-name rb-eng-name-b" title={names.b}>{names.b}</span>
                  </div>
                  <span className="rb-eng-score-label">남은 부대</span>
                </div>
                <p className="rb-eng-time" aria-label={`경과 시간 ${snap.hud.time}`}>{snap.hud.time}</p>
              </div>
            )}
            {snap && (
              <div className="rb-eng-controls">
                <div className="rb-eng-controls-left">
                  {!snap.done && (
                  <>
                  <button
                    type="button"
                    className="rb-btn rb-btn-secondary rb-eng-icon"
                    onClick={togglePause}
                    aria-label={snap.paused ? '다시 재생' : '일시정지'}
                    aria-keyshortcuts="Space"
                  >
                    {snap.paused ? <PlayIcon /> : <PauseIcon />}
                  </button>
                  <button type="button" className="rb-btn rb-btn-secondary" onClick={toggleSpeed} aria-pressed={snap.speed === 2}>
                    {snap.speed === 2 ? '1배속' : '2배속'}
                  </button>
                  </>
                  )}
                  {focused !== null && (
                    <button type="button" className="rb-btn rb-btn-secondary" onClick={() => focus(null)}>
                      전장 전체
                    </button>
                  )}
                </div>
                {showResult ? (
                  resultButton
                ) : snap.hud.phase === 'lanes' ? (
                  <button type="button" className="rb-btn rb-btn-secondary" onClick={skipToFinal}>
                    최종전으로 건너뛰기
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="rb-eng-fallback">
            <p className="rb-eng-fallback-title">
              <span className="rb-eng-name-a">{names.a}</span>
              <span className="rb-eng-fallback-sep">대</span>
              <span className="rb-eng-name-b">{names.b}</span>
            </p>
            <p className="rb-eng-fallback-note">
              {reduced
                ? '동작 줄이기 설정이 켜져 있어 전투 장면 대신 해설을 바로 보여 드려요.'
                : '이 브라우저에서는 3D 전장을 그릴 수 없어요. 전투 결과와 해설은 그대로 볼 수 있어요.'}
            </p>
            {resultButton}
          </div>
        )}
      </section>

      <aside className="rb-eng-panel" aria-label="전투 해설">
        <div className="rb-eng-panel-head">
          <h2 className="rb-eng-panel-title">전투 해설</h2>
          <button type="button" className="rb-eng-back" onClick={onBack}>
            브리핑으로
          </button>
        </div>
        <div className="rb-eng-seg" role="group" aria-label="해설 거르기">
          {(['all', 'highlight', 'a', 'b'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="rb-eng-seg-btn"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              title={f === 'a' || f === 'b' ? names[f] : undefined}
            >
              {f === 'all' ? '전체' : f === 'highlight' ? '명장면' : names[f]}
            </button>
          ))}
        </div>
        {pinned && (
          <button type="button" className="rb-eng-pin" onClick={() => focus(pinned.arena)} disabled={!live}>
            <span className="rb-eng-row">
              <span className="rb-eng-pill">{pinned.badgeText}</span>
              <span className="rb-eng-meta">{metaOf(pinned, true)}</span>
            </span>
            <span className="rb-eng-pin-title">{pinned.title}</span>
            <span className="rb-eng-pin-body">{pinned.body}</span>
          </button>
        )}
        {list.length === 0 && (
          <p className="rb-eng-empty">
            {anyRevealed ? '이 조건에 맞는 해설이 아직 없어요.' : '교전이 시작되면 여기에 해설이 쌓여요.'}
          </p>
        )}
        <ol className="rb-eng-log" aria-live={live ? 'polite' : undefined}>
          {list.map((e) => (
            <Entry key={e.id} entry={e} names={names} onFocus={live ? () => focus(e.arena) : undefined} />
          ))}
        </ol>
      </aside>
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  a: 'rb-eng-tone-a',
  b: 'rb-eng-tone-b',
  highlight: 'rb-eng-tone-hl',
  warn: 'rb-eng-tone-warn',
  muted: 'rb-eng-tone-muted',
};

function Entry({ entry, names, onFocus }: { entry: CommentaryEntry; names: Record<Side, string>; onFocus?: () => void }) {
  const badge = badgeOf(entry, names);
  const source = sourceOf(entry);
  const body = (
    <>
      <span className="rb-eng-row">
        <span className={`rb-eng-badge ${TONE_CLASS[badge.tone]}`}>
          {badge.tone === 'highlight' ? (
            <span className="rb-eng-pill">{badge.text}</span>
          ) : (
            <>
              <span className="rb-eng-dot" aria-hidden="true" />
              {badge.text}
            </>
          )}
        </span>
        <span className="rb-eng-meta">{metaOf(entry)}</span>
      </span>
      <span className="rb-eng-title">{entry.title}</span>
      <span className="rb-eng-body">{entry.body}</span>
      {source && (
        <span className="rb-eng-source" title={entry.source?.path}>
          {source}
        </span>
      )}
    </>
  );
  return (
    <li>
      {onFocus ? (
        <button type="button" className="rb-eng-entry" onClick={onFocus}>
          {body}
        </button>
      ) : (
        <div className="rb-eng-entry">{body}</div>
      )}
    </li>
  );
}

function placeTags(replay: Replay, field: FieldHandle, tags: readonly TagModel[], els: Map<string, HTMLElement>): void {
  const t = replay.blend;
  for (const tag of tags) {
    const el = els.get(tag.key);
    if (!el) continue;
    const prev = replay.prev[tag.side];
    const cur = replay.cur[tag.side];
    let x = 0;
    let z = 0;
    let lift = 3.4;
    if (tag.squad < 0) {
      [x, z] = blendedPos(prev, cur, CMD_SLOT, t);
    } else {
      const info = replay.battle.armies[tag.side].squads[tag.squad];
      let n = 0;
      let minZ = Infinity;
      for (let i = info.from; i < info.to; i++) {
        if (cur.mode[i] !== MODE_FIELD) continue;
        const [ux, uz] = blendedPos(prev, cur, i, t);
        x += ux;
        z += uz;
        if (uz < minZ) minZ = uz;
        n++;
      }
      if (n === 0) {
        el.style.visibility = 'hidden';
        continue;
      }
      x /= n;
      z = minZ;
      lift = 1.2;
    }
    // Tags sit on their own side of the fight so the two tags of a duel never cover each other.
    const sign = replay.sign[tag.side];
    const outward = tag.squad >= 0 || replay.battle.phase !== 'lanes';
    if (outward) x += sign * 0.8;
    const p = field.project(x, lift, z);
    const box = el.offsetParent as HTMLElement | null;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Keep tags out of the HUD band and the control row, and inside the panel.
    if (!p || !box || p.y - h < TAG_TOP || p.y > box.clientHeight - TAG_BOTTOM) {
      el.style.visibility = 'hidden';
      continue;
    }
    const left = outward ? (sign < 0 ? p.x - w : p.x) : p.x - w / 2;
    const clamped = Math.max(TAG_EDGE, Math.min(box.clientWidth - w - TAG_EDGE, left));
    el.style.visibility = 'visible';
    el.style.transform = `translate(${clamped.toFixed(1)}px, ${(p.y - h).toFixed(1)}px)`;
  }
}

const TAG_TOP = 128;
const TAG_BOTTOM = 96;
const TAG_EDGE = 12;

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="3" x2="5" y2="13" />
      <line x1="11" y1="3" x2="11" y2="13" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 3.2v9.6c0 .5.5.8.9.5l7.2-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z" />
    </svg>
  );
}
