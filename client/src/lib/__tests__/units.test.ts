// The conversions behind the metric/imperial setting (issue #1).
//
// The expected imperial readings are the ones the official Pokédex prints for these two,
// which is the point of writing them down: a conversion checked only against its own
// arithmetic would pass a test derived from that same arithmetic.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  heightColumnLabel,
  heightReading,
  heightValue,
  weightColumnLabel,
  weightReading,
  weightValue,
} from '../units.ts';

describe('heightValue', () => {
  test('metric reads the stored tenths as metres', () => {
    assert.equal(heightValue(17, 'metric'), '1.7');
    assert.equal(heightValue(4, 'metric'), '0.4');
  });

  test('Pikachu, 0.4 m, is 1 foot 4', () => {
    assert.equal(heightValue(4, 'imperial'), '1\'4"');
  });

  test('Onix, 8.8 m, is 28 foot 10', () => {
    assert.equal(heightValue(88, 'imperial'), '28\'10"');
  });

  test('inches carry into the next foot rather than reading 12', () => {
    // 0.3 m is 11.81 inches, which rounds to 12 and has to become one foot exactly.
    assert.equal(heightValue(3, 'imperial'), '1\'0"');
  });
});

describe('weightValue', () => {
  test('metric reads the stored tenths as kilograms', () => {
    assert.equal(weightValue(60, 'metric'), '6.0');
    assert.equal(weightValue(2100, 'metric'), '210.0');
  });

  test('Pikachu, 6 kg, is 13.2 lb', () => {
    assert.equal(weightValue(60, 'imperial'), '13.2');
  });

  test('Onix, 210 kg, is 463.0 lb', () => {
    assert.equal(weightValue(2100, 'imperial'), '463.0');
  });
});

describe('readings carry their own unit', () => {
  test('metric says the unit after the number', () => {
    assert.equal(heightReading(17, 'metric'), '1.7 m');
    assert.equal(weightReading(60, 'metric'), '6.0 kg');
  });

  test('an imperial height needs no suffix, a weight does', () => {
    assert.equal(heightReading(4, 'imperial'), '1\'4"');
    assert.equal(weightReading(60, 'imperial'), '13.2 lb');
  });
});

describe('column labels', () => {
  test('metric names both units', () => {
    assert.equal(heightColumnLabel('metric'), 'Height (m)');
    assert.equal(weightColumnLabel('metric'), 'Weight (kg)');
  });

  test('an imperial height column names none, because its values do', () => {
    assert.equal(heightColumnLabel('imperial'), 'Height');
    assert.equal(weightColumnLabel('imperial'), 'Weight (lb)');
  });
});
