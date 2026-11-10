import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const controller = readFileSync(new URL('../long-interview-v06.js', import.meta.url), 'utf8');
const silent = 'SISTEMA: [BLOQUE_SILENCIOSO]';

test('un cierre solo con pausas informa del problema antes de mostrar las acciones', () => {
  const functions = ['aggregatePayload', 'visibleProcessedTranscript', 'publishAggregate']
    .map(name => controller.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))[0])
    .join('\n');
  const context = {
    SILENT_BLOCK_MARKER: silent,
    state: { blockIndex: 1, processedBlocks: [{index: 1, transcript: silent, segments: [], participants: [], review_items: []}] },
  };
  assert.throws(() => runInNewContext(functions + '\npublishAggregate()', context), /no contiene voz reconocida/);
});
