import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('.cache', { recursive: true });
let binary = process.env.NATIVE_SPECTRUM_ORACLE;
if (!binary) {
  binary = '.cache/native-spectrum-oracle';
  execFileSync(process.env.CXX ?? 'c++', ['-std=c++17', '-O2', '-Itest-corpus/aegisub-fft', 'scripts/native-spectrum-oracle.cpp', 'test-corpus/aegisub-fft/fft.cpp', 'test-corpus/aegisub-fft/hsl.cpp', '-o', binary], { stdio: 'inherit' });
}
const actual = JSON.parse(execFileSync(binary, { encoding: 'utf8' })), path = 'test-corpus/native-spectrum-oracle.json';
if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(actual) + '\n');
else {
  const reference = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(actual.powers.length, reference.powers.length); assert.equal(actual.rows.length, reference.rows.length);
  assert.deepEqual(actual.colours, reference.colours);
  actual.rows.forEach((item, index) => item.rows.forEach((row, y) => {
    const expected = reference.rows[index].rows[y];
    assert.equal(row[0], expected[0]); assert.equal(row[1], expected[1]); assert.equal(row[3], expected[3]); assert.ok(Math.abs(row[2] - expected[2]) < .0001);
  }));
  actual.powers.forEach((row, index) => {
    const expected = reference.powers[index];
    assert.equal(row.rate, expected.rate); assert.equal(row.quality, expected.quality); assert.equal(row.signal, expected.signal);
    assert.equal(row.fftSize, expected.fftSize); assert.equal(row.hop, expected.hop); assert.equal(row.values.length, expected.values.length);
    row.values.forEach((value, bin) => assert.ok(Math.abs(value - expected.values[bin]) < 0.0001, `native power mismatch: ${index}/${bin}`));
  });
}
console.log(`Native spectrum oracle: ${actual.powers.length} FFT vectors, ${actual.colours.length} colours and ${actual.rows.length} row maps checked.`);
