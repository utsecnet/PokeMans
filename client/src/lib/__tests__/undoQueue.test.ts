import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndoQueue } from '../undoQueue.ts';

const WINDOW = 20;
const after = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('undo queue', async (t) => {
  await t.test('commits once the window elapses', async () => {
    const queue = createUndoQueue(WINDOW);
    let committed = 0;
    queue.schedule('collection:1', () => {
      committed++;
    });
    assert.equal(committed, 0, 'must not commit immediately');
    await after(WINDOW * 3);
    assert.equal(committed, 1);
    assert.equal(queue.isArmed('collection:1'), false);
  });

  await t.test('undo prevents the commit entirely', async () => {
    const queue = createUndoQueue(WINDOW);
    let committed = 0;
    queue.schedule('collection:1', () => {
      committed++;
    });
    assert.equal(queue.undo('collection:1'), true);
    await after(WINDOW * 3);
    assert.equal(committed, 0, 'an undone delete must never run');
  });

  /**
   * The regression. React invokes state updaters twice under StrictMode, and the original
   * code created the timer inside one — scheduling two timers while remembering one id.
   * Undo cancelled the tracked timer and the orphan still deleted the collection seconds
   * later, which is exactly how a real collection was lost.
   */
  await t.test('scheduling twice for one key cannot outlive a single undo', async () => {
    const queue = createUndoQueue(WINDOW);
    let committed = 0;
    const commit = () => {
      committed++;
    };

    assert.equal(queue.schedule('collection:7', commit), true);
    assert.equal(queue.schedule('collection:7', commit), false, 'second schedule is refused');

    queue.undo('collection:7');
    await after(WINDOW * 4);
    assert.equal(committed, 0, 'no orphan timer may survive the undo');
  });

  await t.test('a keyless undo cancels the most recent delete', async () => {
    const queue = createUndoQueue(WINDOW);
    const done: string[] = [];
    queue.schedule('a', () => {
      done.push('a');
    });
    queue.schedule('b', () => {
      done.push('b');
    });
    queue.undo();
    await after(WINDOW * 3);
    assert.deepEqual(done, ['a'], 'b was the newest, so b is the one undone');
  });

  await t.test('undo after the window has passed changes nothing', async () => {
    const queue = createUndoQueue(WINDOW);
    let committed = 0;
    queue.schedule('collection:1', () => {
      committed++;
    });
    await after(WINDOW * 3);
    assert.equal(queue.undo('collection:1'), false, 'nothing left to undo');
    assert.equal(committed, 1, 'and it must not double-commit');
  });

  await t.test('undo of an unknown key is a no-op', () => {
    const queue = createUndoQueue(WINDOW);
    assert.equal(queue.undo('nope:1'), false);
    assert.equal(queue.undo(), false, 'keyless undo with nothing pending');
  });

  await t.test('keys are independent', async () => {
    const queue = createUndoQueue(WINDOW);
    const done: string[] = [];
    queue.schedule('collection:1', () => {
      done.push('one');
    });
    queue.schedule('want:1', () => {
      done.push('two');
    });
    assert.deepEqual(queue.armedKeys(), ['collection:1', 'want:1']);
    queue.undo('collection:1');
    await after(WINDOW * 3);
    assert.deepEqual(done, ['two'], 'undoing a collection must not spare a want list');
  });

  await t.test('cancelAll runs nothing', async () => {
    const queue = createUndoQueue(WINDOW);
    let committed = 0;
    queue.schedule('a', () => {
      committed++;
    });
    queue.schedule('b', () => {
      committed++;
    });
    queue.cancelAll();
    assert.deepEqual(queue.armedKeys(), []);
    await after(WINDOW * 3);
    assert.equal(committed, 0);
  });
});
