// The eight instructor observation tags (View Groups, Observation view).
// Keys match the instructor_observations.label column (migration 026).
// `cue` is what to look for, so tags are applied consistently.
export const OBSERVATION_LABELS = [
  { key: 'talk', short: 'Talk', name: 'Discussing', cue: 'Talking about the problem together.', bg: '#d1e7dd', border: '#198754', text: '#0f5132' },
  { key: 'code', short: 'Code', name: 'All coding', cue: 'Everyone working on the code (shown only when the current question group has code).', bg: '#c3f0e0', border: '#20a77a', text: '#0b5e43', codeOnly: true },
  { key: 'watch', short: 'Watch', name: 'One drives, others watch', cue: 'Focused on screens; one person types, the others watch.', bg: '#fff3cd', border: '#cc9a06', text: '#664d03' },
  { key: 'quiet', short: 'Quiet', name: 'Quiet, on task', cue: 'Silent but working: reading or thinking.', bg: '#e9ecef', border: '#6c757d', text: '#41464b' },
  { key: 'help', short: 'Help', name: 'Asking for help', cue: 'Hand up, or asking or waiting for the instructor.', bg: '#ffe5d0', border: '#fd7e14', text: '#984c0c' },
  { key: 'frustrated', short: 'Frust', name: 'Frustrated', cue: 'Sighs, head in hands, repeated failed runs.', bg: '#f7b787', border: '#ca5010', text: '#5c2405' },
  { key: 'off_task', short: 'Off', name: 'Off topic', cue: 'Socializing, phones, other work.', bg: '#f8d7da', border: '#dc3545', text: '#842029' },
  { key: 'uncertain', short: '?', name: "Can't tell", cue: 'Not visible, or unsure what they are doing.', bg: '#ffffff', border: '#adb5bd', text: '#495057' },
];

export const OBSERVATION_BY_KEY = Object.fromEntries(OBSERVATION_LABELS.map((l) => [l.key, l]));
