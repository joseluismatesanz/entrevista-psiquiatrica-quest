(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl || typeof RTCPeerConnection === 'undefined') return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitForDataChannelOpen(channel, timeoutMs = 5000) {
    if (channel.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Realtime data channel timeout'));
      }, timeoutMs);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Realtime data channel closed'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        channel.removeEventListener('open', onOpen);
        channel.removeEventListener('close', onClose);
      };
      channel.addEventListener('open', onOpen, { once: true });
      channel.addEventListener('close', onClose, { once: true });
    });
  }

  function createSessionState(pc, dc) {
    const committedOrder = [];
    const committedSet = new Set();
    const completed = new Map();
    const partial = new Map();
    const timing = new Map();
    const failed = new Set();
    let eventSequence = 0;
    let lastEventAt = performance.now();
    let speechActive = false;
    let closed = false;

    const rememberCommitted = (itemId) => {
      const id = String(itemId || '');
      if (!id || committedSet.has(id)) return;
      committedSet.add(id);
      committedOrder.push(id);
    };

    const onMessage = (message) => {
      let event;
      try {
        event = JSON.parse(String(message.data || ''));
      } catch {
        return;
      }
      lastEventAt = performance.now();
      eventSequence += 1;
      const itemId = String(event?.item_id || '');

      if (event.type === 'input_audio_buffer.speech_started') {
        speechActive = true;
        if (itemId) {
          const previous = timing.get(itemId) || {};
          timing.set(itemId, { ...previous, start: Number(event.audio_start_ms) / 1000 });
        }
        return;
      }

      if (event.type === 'input_audio_buffer.speech_stopped') {
        speechActive = false;
        if (itemId) {
          const previous = timing.get(itemId) || {};
          timing.set(itemId, { ...previous, end: Number(event.audio_end_ms) / 1000 });
        }
        return;
      }

      if (event.type === 'input_audio_buffer.committed') {
        rememberCommitted(itemId);
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        if (!itemId) return;
        const previous = partial.get(itemId) || '';
        partial.set(itemId, previous + String(event.delta || ''));
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        if (!itemId) return;
        rememberCommitted(itemId);
        const transcript = String(event.transcript || '').trim();
        if (transcript) completed.set(itemId, { text: transcript, sequence: eventSequence });
        partial.delete(itemId);
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.failed') {
        if (itemId) failed.add(itemId);
      }
    };

    dc.addEventListener('message', onMessage);

    const closeTransport = () => {
      if (closed) return;
      closed = true;
      dc.removeEventListener('message', onMessage);
      try { dc.close(); } catch {}
      try { pc.close(); } catch {}
    };

    const buildSegments = () => {
      if (!completed.size || failed.size) return [];
      const knownOrder = committedOrder.filter((id) => completed.has(id));
      const extras = [...completed.keys()]
        .filter((id) => !committedSet.has(id))
        .sort((a, b) => completed.get(a).sequence - completed.get(b).sequence);
      const orderedIds = [...knownOrder, ...extras];
      return orderedIds.map((id, index) => {
        const meta = timing.get(id) || {};
        const start = Number.isFinite(meta.start) ? meta.start : index;
        const end = Number.isFinite(meta.end) ? meta.end : start;
        return { id, start, end, text: completed.get(id).text };
      });
    };

    return {
      async stop() {
        const completionsAtStop = completed.size;
        const speechWasActive = speechActive;

        // El MediaRecorder ya se ha detenido cuando se llama aquí. Se compromete cualquier
        // último turno que todavía no hubiera cerrado el VAD. Un buffer vacío solo produce
        // un error de Realtime y no invalida los turnos ya completados.
        if (dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify({
              type: 'input_audio_buffer.commit',
              event_id: `commit_${Date.now()}`,
            }));
          } catch {}
        }

        const startedAt = performance.now();
        while (performance.now() - startedAt < 3000) {
          const pendingCommitted = committedOrder.some((id) => !completed.has(id) && !failed.has(id));
          const capturedLastActiveTurn = !speechWasActive || completed.size > completionsAtStop;
          const quietForMs = performance.now() - lastEventAt;
          if (performance.now() - startedAt > 550 && capturedLastActiveTurn && !pendingCommitted && quietForMs > 300) break;
          await sleep(80);
        }

        const segments = buildSegments();
        closeTransport();
        partial.clear();
        completed.clear();
        timing.clear();
        committedOrder.length = 0;
        committedSet.clear();
        failed.clear();
        return segments;
      },
      abort() {
        closeTransport();
        partial.clear();
        completed.clear();
        timing.clear();
        committedOrder.length = 0;
        committedSet.clear();
        failed.clear();
      },
    };
  }

  async function start(stream) {
    if (!stream?.getAudioTracks?.().length) throw new Error('No microphone track');

    const tokenResponse = await fetch(`${baseUrl}/api/realtime-token`, {
      method: 'POST',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenPayload.value !== 'string') {
      throw new Error('Realtime transcription unavailable');
    }

    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel('oai-events');
    const session = createSessionState(pc, dc);

    try {
      pc.addTrack(stream.getAudioTracks()[0], stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenPayload.value}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpResponse.ok) throw new Error('Realtime WebRTC negotiation failed');
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      await waitForDataChannelOpen(dc);
      return session;
    } catch (error) {
      session.abort();
      throw error;
    }
  }

  window.ClinicalRealtimeAudio = { start };
})();
