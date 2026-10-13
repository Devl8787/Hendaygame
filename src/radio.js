// Henday Traffic Radio 2-16, with your host Brenda.
//
// Brenda talks with the browser's built-in text-to-speech, using the best
// female English voice it offers (Canadian if there is one). A synthesised
// jingle and a burst of static frame each report, and her words appear as
// subtitles. M mutes the radio. Later these can become recorded clips: swap
// speak() for playing audio files and keep everything else.

const STATION = 'Henday Traffic Radio 2-16';

// What Brenda says, by event. `chance` is how often she bothers; `cooldown`
// (seconds) stops her repeating herself about the same thing.
const LINES = {
  start: {
    chance: 1,
    cooldown: 0,
    lines: [
      "Good morning Edmonton, this is Brenda on Henday Traffic Radio, two sixteen on your dial. Traffic is heavy, the potholes are deep, and the coffee is cold. Drive safe out there.",
      "You're listening to Henday Traffic Radio, I'm Brenda. Conditions on the Henday today: yes. Buckle up.",
      "Brenda here on two sixteen. The Henday is open, mostly, and the construction crews are in position. Let's go.",
    ],
  },
  wrongWay: {
    chance: 1,
    cooldown: 8,
    priority: true,
    lines: [
      "Breaking news: we have a report of a wrong-way driver on the Henday. Again. Please, everyone, stay in your lane.",
      "Our traffic chopper spots a vehicle going the wrong way on the Henday. They seem very confident about it.",
      "Wrong-way driver reported. If that's you, honey, the Henday goes the other way.",
      "Heads up: a driver is heading the wrong way in your lanes. Police describe them as committed.",
    ],
  },
  workZone: {
    chance: 0.6,
    cooldown: 25,
    lines: [
      "Construction update: a lane is closed ahead for important work, which so far has mostly been looking at the hole.",
      "Crews are on site today. Crews will also be on site tomorrow. And the next day. Estimated completion: twenty thirty one.",
      "Reminder: fines double in construction zones. Progress, unfortunately, does not.",
      "Lane closure ahead. One worker is digging, four are supervising, and one has a double double.",
    ],
  },
  pothole: {
    chance: 0.5,
    cooldown: 25,
    lines: [
      "We're getting calls about a pothole on the Henday. Callers describe it as a lot of pothole.",
      "City crews say that pothole is on the list. The list is very long.",
      "Pothole report: if you just lost a hubcap, it's in there with several others.",
      "That pothole has its own postal code now.",
    ],
  },
  heave: {
    chance: 1,
    cooldown: 20,
    lines: [
      "And we have airtime! Frost heave season is in full bloom.",
      "That frost heave has been there since nineteen eighty seven. It's practically a heritage site.",
      "Reports of a vehicle achieving liftoff near the big bump. The judges give it a seven.",
    ],
  },
  rockChip: {
    chance: 0.7,
    cooldown: 30,
    lines: [
      "Gravel truck alert. Your windshield has been chosen.",
      "Listener tip: following a gravel truck is how windshields learn about crack propagation.",
    ],
  },
  tow: {
    chance: 1,
    cooldown: 10,
    lines: [
      "A tow truck has been dispatched. That'll be three hundred dollars, and no, they don't take Air Miles.",
      "Vehicle on its roof on the Henday. A tow truck is on the way, and so is your insurance premium.",
    ],
  },
  lap: {
    chance: 1,
    cooldown: 0,
    lines: [
      "Lap two, and traffic is still moving. Barely.",
      "Another lap on the Henday. Officials remind you it is a loop, so this was always going to happen.",
    ],
  },
  finalLap: {
    chance: 1,
    cooldown: 0,
    lines: [
      "Final lap! Henday Traffic Radio reminds you the speed limit is one hundred. We have to say that.",
      "Last lap. If you can see the gantry, you're almost home. If you can see a wrong-way driver, you're almost not.",
    ],
  },
  finish: {
    chance: 1,
    cooldown: 0,
    priority: true,
    lines: [
      "And that's the race! Congratulations, you survived the Henday. Most people just call that a commute.",
      "Checkered flag! That's a wrap from Henday Traffic Radio. I'm Brenda, and the construction will still be here tomorrow.",
    ],
  },
  filler: {
    chance: 1,
    cooldown: 0,
    lines: [
      "Traffic is moving at a brisk twelve kilometres an hour near Whitemud. So, a normal day.",
      "Weather update: it's snowing. It's also sunny. It's Edmonton.",
      "We've got a left-lane camper near Gateway. Please don't honk, they can't hear you over their podcast.",
      "Reminder that the Henday is a loop. If you're lost, just keep going. You'll be back.",
      "Construction season is now in its eleventh month. Officials remain optimistic.",
      "Listener question: when will the Henday be finished? Great question. Next caller.",
      "Delays on the Henday. Which part of the Henday? Yes.",
      "If you're just joining us, there's construction. That's the update.",
      "Merging tip of the day: the zipper merge works. Nobody believes us, but it works.",
      "Yellowhead is backed up, Whitemud is backed up, and so is my email. Back to you, Henday.",
    ],
  },
};

const FILLER_EVERY = [40, 70]; // seconds between random chatter

// Female English voices, best first. Natural "Online" voices come with
// Microsoft Edge; Google voices with Chrome; the rest with Windows or macOS.
const PREFERRED_VOICES = [
  /Clara.*Canada/i,
  /(Aria|Jenny|Ava|Emma|Michelle|Libby|Sonia|Natasha|Molly).*Natural/i,
  /Google UK English Female/i,
  /Google US English/i,
  /Zira/i,
  /Hazel/i,
  /Susan/i,
  /(Samantha|Karen|Moira|Tessa|Victoria|Fiona|Serena)/i,
  /female/i,
];

export class Radio {
  constructor() {
    this.subtitle = document.getElementById('radio');
    this.synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    this.voice = null;
    this.muted = loadMuted();
    this.lastSaid = {};
    this.recent = {};
    this.fillerIn = rand(...FILLER_EVERY);
    this.speaking = false;
    this.audio = null;
    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
    const retry = () => {
      if (this.blocked && !this.muted) this.say(this.blocked);
      this.blocked = null;
    };
    window.addEventListener('keydown', retry);
    window.addEventListener('pointerdown', retry);
  }

  pickVoice() {
    const voices = this.synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('en'));
    for (const pattern of PREFERRED_VOICES) {
      const match = voices.find((v) => pattern.test(v.name));
      if (match) {
        this.voice = match;
        return;
      }
    }
    this.voice = voices[0] ?? null;
  }

  toggleMute() {
    this.muted = !this.muted;
    saveMuted(this.muted);
    if (this.muted) this.stop();
    this.showSubtitle(this.muted ? `${STATION}: muted (M to turn back on)` : `${STATION}: on`, 2);
  }

  // Something happened; Brenda may have something to say about it.
  event(kind) {
    const spec = LINES[kind];
    if (!spec || this.muted) return;
    const now = performance.now() / 1000;
    if (now - (this.lastSaid[kind] ?? -Infinity) < spec.cooldown) return;
    if (Math.random() > spec.chance) return;
    if (this.speaking && !spec.priority) return;
    this.lastSaid[kind] = now;
    this.fillerIn = rand(...FILLER_EVERY);
    this.say(this.pickLine(kind, spec.lines));
  }

  // Random chatter while the race is on and nothing else is being said.
  update(dt, racing) {
    if (!racing || this.muted || this.speaking) return;
    this.fillerIn -= dt;
    if (this.fillerIn <= 0) this.event('filler');
  }

  stop() {
    this.sayId = (this.sayId ?? 0) + 1;
    clearTimeout(this.pending);
    clearTimeout(this.quiet);
    this.synth?.cancel();
    this.speaking = false;
    this.subtitle.textContent = '';
  }

  // Don't repeat the last thing said about the same event.
  pickLine(kind, lines) {
    let line;
    do line = lines[Math.floor(Math.random() * lines.length)];
    while (lines.length > 1 && line === this.recent[kind]);
    this.recent[kind] = line;
    return line;
  }

  say(text) {
    // Cutting in on something already being said: only the newest line counts.
    this.synth?.cancel();
    clearTimeout(this.pending);
    clearTimeout(this.quiet);
    const id = (this.sayId = (this.sayId ?? 0) + 1);
    const done = () => id === this.sayId && this.finished();
    this.speaking = true;
    this.showSubtitle(`${STATION} · Brenda: ${text}`);
    this.jingle();
    if (!this.synth || !this.voice) {
      // No voice available: subtitles only, for about as long as it takes to read.
      this.quiet = setTimeout(done, 1500 + text.length * 55);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.voice;
    utterance.lang = this.voice.lang;
    utterance.rate = 1.05;
    utterance.pitch = 1.05;
    utterance.onend = done;
    utterance.onerror = (e) => {
      // Browsers won't speak until you've interacted with the page; say it
      // on the first key press instead.
      if (e.error === 'not-allowed') this.blocked = text;
      done();
    };
    // Let the jingle play first.
    this.pending = setTimeout(() => this.synth.speak(utterance), 650);
  }

  finished() {
    this.speaking = false;
    this.staticBurst(0.25);
    this.showSubtitle(this.subtitle.textContent, 1.5);
  }

  showSubtitle(text, seconds) {
    this.subtitle.textContent = text;
    clearTimeout(this.hide);
    if (seconds) this.hide = setTimeout(() => (this.subtitle.textContent = ''), seconds * 1000);
  }

  // ------------------------------------------------------------- sound effects

  context() {
    if (!this.audio) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return null;
      this.audio = new Ctx();
    }
    if (this.audio.state === 'suspended') this.audio.resume();
    return this.audio;
  }

  // A bright three-note station ident, then a little static.
  jingle() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = t + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    this.staticBurst(0.3, t + 0.4);
  }

  // Radio static: noise squeezed through a narrow band, like an AM tuner.
  staticBurst(seconds, at) {
    const ctx = this.context();
    if (!ctx) return;
    const start = at ?? ctx.currentTime;
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
    noise.connect(band).connect(gain).connect(ctx.destination);
    noise.start(start);
  }
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function loadMuted() {
  try {
    return localStorage.getItem('henday-radio-muted') === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted) {
  try {
    localStorage.setItem('henday-radio-muted', muted ? '1' : '0');
  } catch {
    // Private windows can block storage; the setting just won't stick.
  }
}
