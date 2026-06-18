export const interestOptions = [
  { key: 'beta', label: 'Beta testing' },
  { key: 'pilot', label: 'Classroom pilot' },
  { key: 'research', label: 'Research collaboration' },
  { key: 'instructor_demo', label: 'Instructor demo' },
  { key: 'technical', label: 'Technical details' },
  { key: 'materials', label: 'Sample activities/materials' },
  { key: 'other', label: 'Other' },
];

export const emptyInfoRequest = {
  name: '',
  email: '',
  institution: '',
  role: '',
  interests: {
    beta: false,
    pilot: false,
    research: false,
    instructor_demo: false,
    technical: false,
    materials: false,
    other: false,
  },
  message: '',
};

export function formatInterestSummary(request) {
  return interestOptions
    .filter(({ key }) => Boolean(request?.[key] ?? request?.interests?.[key] ?? request?.[`interest_${key}`]))
    .map(({ label }) => label);
}
