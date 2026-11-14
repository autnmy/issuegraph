/**
 * The keys line under the Inspector (`MountWords.keys`, `.ig-chrome-keys`) is
 * one of the two things "the keys line" can mean; the viewer's legend bar is
 * the other, pinned in the viewer's own sheet test. The redesign lead put both
 * at the small role (#254): a hint, not the panel's content, and never mono,
 * because nothing in it is copied as typed.
 *
 * ITS OWN FILE, because the cascade reader parses a whole sheet per variant: run
 * over the viewer and mount sheets together inside `mount.test.ts`, the
 * regression loop pushed that file past its time budget. The regression loop
 * reads the mount sheet, where the rule lives; the installed stack is read once.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { viewerStylesheet } from '@issuegraph/viewer';

import { SMALL_BACK, SMALL_TYPE, regressionsOf, typeMisses } from '../testing/counts.ts';
import { mountStylesheet } from './chrome.ts';

describe('the keys line under the Inspector (#254)', () => {
  it('sets it at the small role, in the sans with tabular figures, in its own sheet and under the viewer sheet', () => {
    assert.deepEqual(typeMisses(mountStylesheet, ['.ig-chrome-keys'], SMALL_TYPE), []);
    assert.deepEqual(typeMisses(`${viewerStylesheet}\n${mountStylesheet}`, ['.ig-chrome-keys'], SMALL_TYPE), []);
  });

  it('fails a later rule that puts the mono face or a smaller size back', () => {
    for (const later of regressionsOf(mountStylesheet, '.ig-chrome-keys', SMALL_BACK)) {
      assert.notDeepEqual(typeMisses(later, ['.ig-chrome-keys'], SMALL_TYPE), [], 'the keys line passed with a mono or smaller type put back');
    }
  });
});
