// Handles microphone access and recording. Kept isolated so the capture
// method (MediaRecorder today) can be swapped later without touching
// game flow or scoring code.

async function requestMicStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

/**
 * Records from the given MediaStream for exactly durationMs milliseconds.
 * Resolves with a Blob of the captured audio.
 */
function recordForDuration(stream, durationMs, onStart) {
  return new Promise((resolve, reject) => {
    let recorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (err) {
      reject(err);
      return;
    }

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      resolve(blob);
    };

    recorder.start();
    if (onStart) onStart();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
}

async function decodeBlobToBuffer(blob, audioContext) {
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

window.REPLICO_RECORDER = { requestMicStream, recordForDuration, decodeBlobToBuffer };
