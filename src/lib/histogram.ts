/**
 * Filling in the histogram.
 *
 * Kept out of the page so that the bars and the screen-reader table are written once, from
 * one set of numbers. Two implementations of "what does this column say" is how a chart and
 * its accessible equivalent end up disagreeing, and the one that ends up wrong is always the
 * one nobody looks at.
 *
 * Bar heights are a proportion of the tallest column, not of the total. A distribution where
 * the largest group is nine people out of forty would otherwise be a row of stubs, and the
 * shape — which is the entire point of showing a histogram rather than a number — would be
 * invisible.
 */
import { NO_OPINION_LABEL, SCALE_ANCHORS, SCALE_POINTS } from './propositions';
import type { Aggregate } from './propositions';

export function renderHistogram(
  root: HTMLElement,
  aggregate: Aggregate,
  myScore: number | null,
  iRated: boolean,
): void {
  const tallest = Math.max(1, ...aggregate.histogram);

  for (const point of SCALE_POINTS) {
    const column = root.querySelector<HTMLElement>(`[data-col="${point}"]`);
    if (!column) continue;

    const count = aggregate.histogram[point] ?? 0;
    const mine = iRated && myScore === point;
    const isMedian = aggregate.median === point;

    column.querySelector<HTMLElement>('[data-count]')!.textContent = String(count);
    column
      .querySelector<HTMLElement>('[data-bar]')!
      .style.setProperty('--height', `${Math.round((count / tallest) * 100)}%`);

    column.toggleAttribute('data-mine', mine);
    column.querySelector<HTMLElement>('[data-you]')!.hidden = !mine;
    column.querySelector<HTMLElement>('[data-median]')!.hidden = !isMedian;
  }

  // The same numbers again, as a table. Rows are rebuilt rather than patched so that a
  // rating change cannot leave a stale "your answer" note on a row it has moved off.
  const rows = root.querySelector<HTMLElement>('[data-histogram-rows]');
  if (rows) {
    rows.replaceChildren(
      ...SCALE_POINTS.map((point) => {
        const notes: string[] = [];
        if (SCALE_ANCHORS[point]) notes.push(SCALE_ANCHORS[point]);
        if (aggregate.median === point) notes.push('median');
        if (iRated && myScore === point) notes.push('your answer');

        return row(String(point), String(aggregate.histogram[point] ?? 0), notes.join(', '));
      }),
      // Declining is on the same table because it is the same question, and off the scale
      // because it is not a position on it.
      row(
        NO_OPINION_LABEL,
        String(aggregate.noOpinionCount),
        iRated && myScore === null ? 'off the scale, your answer' : 'off the scale',
      ),
    );
  }

  set(root, 'median', aggregate.median === null ? 'none yet' : String(aggregate.median));
  set(root, 'opinions', String(aggregate.opinionCount));
  set(root, 'no-opinion', String(aggregate.noOpinionCount));
  set(
    root,
    'coverage',
    aggregate.coverage === null ? '—' : `${Math.round(aggregate.coverage * 100)}%`,
  );

  root.hidden = false;
}

function row(score: string, people: string, notes: string): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = score;

  const count = document.createElement('td');
  count.textContent = people;

  const note = document.createElement('td');
  note.textContent = notes;

  tr.append(th, count, note);
  return tr;
}

function set(root: HTMLElement, stat: string, value: string): void {
  const target = root.querySelector<HTMLElement>(`[data-stat="${stat}"]`);
  if (target) target.textContent = value;
}
