let audioCtx: AudioContext | null = null;
let activeInterval: any = null;
let activeNodes: AudioNode[] = [];

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playSound(type: 'digital' | 'classic' | 'bell' | 'gentle') {
  try {
    const ctx = getAudioContext();
    stopSound(); // Ensure any running sound is stopped

    const now = ctx.currentTime;

    if (type === 'bell') {
      // Elegant crystal bell strike
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now); // E5
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now); // B5

      gainNode.gain.setValueAtTime(0.25, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 2.5);
      osc2.stop(now + 2.5);

      activeNodes.push(osc1, osc2, gainNode);
    } else if (type === 'gentle') {
      // Soft ambient major chord sweep
      const chord = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.08, now + 0.1 + idx * 0.12);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.8 + idx * 0.12);
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.start(now + idx * 0.08);
        osc.stop(now + 2.5);
        activeNodes.push(osc, gainNode);
      });
    } else if (type === 'digital') {
      // Repeating dual-pulse digital alarm beeps
      const playBeep = () => {
        try {
          const beepCtx = getAudioContext();
          const beepNow = beepCtx.currentTime;
          const osc = beepCtx.createOscillator();
          const gainNode = beepCtx.createGain();

          osc.type = 'square';
          osc.frequency.setValueAtTime(880, beepNow); // A5

          gainNode.gain.setValueAtTime(0.12, beepNow);
          gainNode.gain.setValueAtTime(0.12, beepNow + 0.1);
          gainNode.gain.exponentialRampToValueAtTime(0.001, beepNow + 0.12);

          osc.connect(gainNode);
          gainNode.connect(beepCtx.destination);

          osc.start(beepNow);
          osc.stop(beepNow + 0.14);
        } catch (err) {
          console.error('Beep sound error:', err);
        }
      };

      activeInterval = setInterval(() => {
        playBeep();
        setTimeout(() => {
          playBeep();
        }, 150);
      }, 1000);

      // Fire immediately on trigger
      playBeep();
      setTimeout(() => {
        playBeep();
      }, 150);
    } else if (type === 'classic') {
      // Vintage high-pitch mechanical bell ring
      const ring = () => {
        try {
          const ringCtx = getAudioContext();
          const ringNow = ringCtx.currentTime;
          const osc1 = ringCtx.createOscillator();
          const osc2 = ringCtx.createOscillator();
          const gainNode = ringCtx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(1000, ringNow);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(1030, ringNow); // beating effect

          gainNode.gain.setValueAtTime(0.08, ringNow);
          gainNode.gain.linearRampToValueAtTime(0.08, ringNow + 0.3);
          gainNode.gain.exponentialRampToValueAtTime(0.001, ringNow + 0.35);

          osc1.connect(gainNode);
          osc2.connect(gainNode);
          gainNode.connect(ringCtx.destination);

          osc1.start(ringNow);
          osc2.start(ringNow);
          osc1.stop(ringNow + 0.4);
          osc2.stop(ringNow + 0.4);
        } catch (err) {
          console.error('Ring sound error:', err);
        }
      };

      activeInterval = setInterval(() => {
        ring();
      }, 650);

      ring();
    }
  } catch (err) {
    console.error('Failed to trigger audio synthesis:', err);
  }
}

export function stopSound() {
  if (activeInterval) {
    clearInterval(activeInterval);
    activeInterval = null;
  }
  activeNodes.forEach(node => {
    try {
      (node as any).stop?.();
    } catch (e) {}
    try {
      node.disconnect();
    } catch (e) {}
  });
  activeNodes = [];
}
