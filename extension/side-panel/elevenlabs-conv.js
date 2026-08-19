// Direct ElevenLabs Conversational AI client over WebSocket.
// Avoids bundling the @elevenlabs/client SDK so the extension has no build step.
//
// Audio formats (default): pcm_16000 in both directions — 16 kHz, 16-bit signed LE, mono.
// Exposes window.ElevenLabsConv with start() / stop() / on(event, cb).

(function () {
  const SAMPLE_RATE = 16000;
  const CHUNK_SAMPLES = 4096;

  // base64 helpers
  function b64encode(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function b64decode(s) {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function floatToPCM16(input) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  class Conversation {
    constructor() {
      this.ws = null;
      this.audioCtx = null;
      this.micStream = null;
      this.micNode = null;
      this.processor = null;
      this.playCtx = null;
      this.playHead = 0;
      this.handlers = {};
      this.started = false;
    }

    on(event, cb) {
      (this.handlers[event] ||= []).push(cb);
    }

    emit(event, data) {
      (this.handlers[event] || []).forEach((cb) => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }

    async start({ signedUrl, dynamicVariables }) {
      if (this.started) return;
      this.started = true;

      this.ws = new WebSocket(signedUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.addEventListener('open', () => {
        this.emit('status', 'connected');
        // Send initiation with dynamic variables.
        this.ws.send(
          JSON.stringify({
            type: 'conversation_initiation_client_data',
            dynamic_variables: dynamicVariables || {},
          })
        );
      });

      this.ws.addEventListener('message', (ev) => this.onMessage(ev));
      this.ws.addEventListener('close', () => {
        this.emit('status', 'closed');
        this.cleanup();
      });
      this.ws.addEventListener('error', (e) => {
        console.error('ws error', e);
        this.emit('error', e);
      });

      await this.startMic();
    }

    async startMic() {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.micStream = stream;

      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      // Browsers may refuse the requested sampleRate. We resample manually if so.
      const ctxRate = this.audioCtx.sampleRate;

      this.micNode = this.audioCtx.createMediaStreamSource(stream);
      this.processor = this.audioCtx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const resampled = ctxRate === SAMPLE_RATE ? input : resampleLinear(input, ctxRate, SAMPLE_RATE);
        const pcm = floatToPCM16(resampled);
        const b64 = b64encode(pcm.buffer);
        this.ws.send(JSON.stringify({ user_audio_chunk: b64 }));
      };

      this.micNode.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);
      this.emit('status', 'listening');
    }

    onMessage(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'conversation_initiation_metadata': {
          this.emit('ready', msg.conversation_initiation_metadata_event);
          break;
        }
        case 'audio': {
          const b = msg.audio_event?.audio_base_64;
          if (b) this.playPCM(b);
          this.emit('status', 'speaking');
          break;
        }
        case 'user_transcript': {
          const t = msg.user_transcription_event?.user_transcript;
          if (t) this.emit('user_text', t);
          break;
        }
        case 'agent_response': {
          const t = msg.agent_response_event?.agent_response;
          if (t) this.emit('agent_text', t);
          break;
        }
        case 'interruption': {
          this.stopPlayback();
          this.emit('status', 'listening');
          break;
        }
        case 'ping': {
          if (msg.ping_event) {
            const pong = { type: 'pong', event_id: msg.ping_event.event_id };
            try { this.ws.send(JSON.stringify(pong)); } catch {}
          }
          break;
        }
        default:
          // ignore unknown
          break;
      }
    }

    ensurePlayCtx() {
      if (!this.playCtx) {
        this.playCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        this.playHead = this.playCtx.currentTime;
      }
      return this.playCtx;
    }

    playPCM(b64) {
      const ctx = this.ensurePlayCtx();
      const ab = b64decode(b64);
      const i16 = new Int16Array(ab);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;

      const buffer = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
      buffer.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime, this.playHead);
      src.start(startAt);
      this.playHead = startAt + buffer.duration;

      src.onended = () => {
        if (ctx.currentTime >= this.playHead - 0.02) {
          this.emit('status', 'listening');
        }
      };
    }

    stopPlayback() {
      if (this.playCtx) {
        // Schedule a fresh playhead; in-flight buffers can't be cancelled individually
        // without tracking them — for v1 we just drop the gap.
        this.playHead = this.playCtx.currentTime;
      }
    }

    stop() {
      try { this.ws?.close(); } catch {}
      this.cleanup();
      this.emit('status', 'idle');
    }

    cleanup() {
      try { this.processor?.disconnect(); } catch {}
      try { this.micNode?.disconnect(); } catch {}
      try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { this.audioCtx?.close(); } catch {}
      try { this.playCtx?.close(); } catch {}
      this.processor = null;
      this.micNode = null;
      this.micStream = null;
      this.audioCtx = null;
      this.playCtx = null;
      this.ws = null;
      this.started = false;
    }
  }

  function resampleLinear(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, input.length - 1);
      const frac = idx - lo;
      out[i] = input[lo] * (1 - frac) + input[hi] * frac;
    }
    return out;
  }

  window.ElevenLabsConv = { Conversation };
})();
