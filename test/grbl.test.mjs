import assert from 'node:assert/strict';
import test from 'node:test';
import { READ_ONLY, guessMachine, isReadOnly, parseSetting, parseStatus } from '../shared/grbl.js';

test('only the four read-only questions are allowed', () => {
  assert.deepEqual(Object.values(READ_ONLY), ['?', '$I\n', '$$\n', '$G\n']);
  for (const bad of ['$H\n', '$X\n', '$110=9000\n', 'G0 X10\n', '$J=G91 X1 F100\n', '~', '!', '\x18', '$RST=*\n', '$$', '?\n']) {
    assert.equal(isReadOnly(bad), false, JSON.stringify(bad));
  }
  assert.equal(Object.isFrozen(READ_ONLY), true);
});

test('status reports: MPos with a WCO gives work position; states with a sub-state', () => {
  const a = parseStatus('<Idle|MPos:-100.000,-50.000,-5.000|FS:0,0|WCO:-120.000,-60.000,-10.000>');
  assert.equal(a.state, 'Idle');
  assert.deepEqual(a.wpos, [20, 10, 5]);
  const b = parseStatus('<Hold:0|MPos:-101.000,-50.000,-5.000|FS:0,0>', a.wco);
  assert.equal(b.state, 'Hold');
  assert.equal(b.sub, '0');
  assert.deepEqual(b.wpos, [19, 10, 5]);
  assert.equal(parseStatus('<Alarm|WPos:1.000,2.000,3.000|FS:0,0>').state, 'Alarm');
  assert.equal(parseStatus('ok'), null);
  assert.equal(parseStatus('<Party|MPos:0,0,0>'), null);
});

test('settings lines and the machine guess', () => {
  assert.deepEqual(parseSetting('$102=40.000'), ['102', 40]);
  assert.equal(parseSetting('$N0='), null);
  const notes = guessMachine({ 102: 40, 130: 420, 131: 430, 22: 1 });
  assert.match(notes.join(' '), /belt-driven Z.*standard size.*homing switches/);
});
