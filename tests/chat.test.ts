import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_MAX_LENGTH,chatText} from '../src/protocol';

test('world chat normalizes whitespace and removes control characters',()=>{
  assert.equal(chatText('  hello\n\tfrontier\u0000  '),'hello frontier');
  assert.equal(chatText(null),'');
  assert.equal(chatText('   '),'');
});

test('world chat keeps unicode and applies the public message limit',()=>{
  assert.equal(chatText('Hello 🪵 builders'),'Hello 🪵 builders');
  assert.equal(chatText('x'.repeat(CHAT_MAX_LENGTH+20)).length,CHAT_MAX_LENGTH);
});
