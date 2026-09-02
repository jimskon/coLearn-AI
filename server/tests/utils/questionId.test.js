const {
  parseQuestionId,
  isValidQuestionId,
  getRootQuestionId,
  isDerivedQuestionId,
  getQuestionIdKind,
} = require('../../utils/questionId');

describe('questionId helper', () => {
  describe('valid root question ids', () => {
    test('parses 1a as main', () => {
      expect(parseQuestionId('1a')).toEqual({
        valid: true,
        input: '1a',
        normalized: '1a',
        root: '1a',
        kind: 'main',
        ordinal: null,
        suffix: '',
        derived: false,
      });
    });

    test('parses 12aa as main', () => {
      expect(parseQuestionId('12aa')).toEqual({
        valid: true,
        input: '12aa',
        normalized: '12aa',
        root: '12aa',
        kind: 'main',
        ordinal: null,
        suffix: '',
        derived: false,
      });
    });

    test('parses 27ab as main', () => {
      const parsed = parseQuestionId('27ab');
      expect(parsed.valid).toBe(true);
      expect(parsed.root).toBe('27ab');
      expect(parsed.kind).toBe('main');
      expect(parsed.ordinal).toBeNull();
    });
  });

  describe('valid derived question ids', () => {
    test('parses state row', () => {
      expect(parseQuestionId('2aS')).toEqual({
        valid: true,
        input: '2aS',
        normalized: '2aS',
        root: '2a',
        kind: 'state',
        ordinal: null,
        suffix: 'S',
        derived: true,
      });
    });

    test('parses follow-up prompt row', () => {
      expect(parseQuestionId('2aF1')).toEqual({
        valid: true,
        input: '2aF1',
        normalized: '2aF1',
        root: '2a',
        kind: 'followup_prompt',
        ordinal: 1,
        suffix: 'F1',
        derived: true,
      });
    });

    test('parses higher-numbered follow-up prompt row', () => {
      const parsed = parseQuestionId('2aF12');
      expect(parsed.valid).toBe(true);
      expect(parsed.root).toBe('2a');
      expect(parsed.kind).toBe('followup_prompt');
      expect(parsed.ordinal).toBe(12);
    });

    test('parses follow-up answer row', () => {
      expect(parseQuestionId('2aFA1')).toEqual({
        valid: true,
        input: '2aFA1',
        normalized: '2aFA1',
        root: '2a',
        kind: 'followup_answer',
        ordinal: 1,
        suffix: 'FA1',
        derived: true,
      });
    });

    test('parses code row', () => {
      expect(parseQuestionId('2cCODE1')).toEqual({
        valid: true,
        input: '2cCODE1',
        normalized: '2cCODE1',
        root: '2c',
        kind: 'code',
        ordinal: 1,
        suffix: 'CODE1',
        derived: true,
      });
    });

    test('parses multi-letter root with derived suffix', () => {
      const parsed = parseQuestionId('12abFA3');
      expect(parsed.valid).toBe(true);
      expect(parsed.root).toBe('12ab');
      expect(parsed.kind).toBe('followup_answer');
      expect(parsed.ordinal).toBe(3);
    });
  });

  describe('invalid question ids', () => {
    test.each([
      '2',
      'a2',
      '2A',
      '2a_state',
      '2a-F1',
      '2aFA',
      '2aF0',
      '2aFA0',
      '2aCODE0',
      '2aCode1',
      '2aOUTPUT1',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
      [],
    ])('rejects invalid value %p', (value) => {
      const parsed = parseQuestionId(value);
      expect(parsed.valid).toBe(false);
      expect(parsed.error).toBeTruthy();
    });
  });

  describe('utility helpers', () => {
    test('isValidQuestionId returns true for valid ids', () => {
      expect(isValidQuestionId('1a')).toBe(true);
      expect(isValidQuestionId('2aS')).toBe(true);
      expect(isValidQuestionId('2aF1')).toBe(true);
      expect(isValidQuestionId('2aFA1')).toBe(true);
      expect(isValidQuestionId('2aCODE1')).toBe(true);
    });

    test('isValidQuestionId returns false for invalid ids', () => {
      expect(isValidQuestionId('2')).toBe(false);
      expect(isValidQuestionId('2aF0')).toBe(false);
      expect(isValidQuestionId('2aOUTPUT1')).toBe(false);
    });

    test('getRootQuestionId returns the root for valid ids', () => {
      expect(getRootQuestionId('2a')).toBe('2a');
      expect(getRootQuestionId('2aS')).toBe('2a');
      expect(getRootQuestionId('2aF1')).toBe('2a');
      expect(getRootQuestionId('2aFA1')).toBe('2a');
      expect(getRootQuestionId('2aCODE1')).toBe('2a');
    });

    test('getRootQuestionId returns null for invalid ids', () => {
      expect(getRootQuestionId('2')).toBeNull();
      expect(getRootQuestionId('2aF0')).toBeNull();
    });

    test('isDerivedQuestionId distinguishes root vs derived', () => {
      expect(isDerivedQuestionId('2a')).toBe(false);
      expect(isDerivedQuestionId('2aS')).toBe(true);
      expect(isDerivedQuestionId('2aF1')).toBe(true);
      expect(isDerivedQuestionId('2aFA1')).toBe(true);
      expect(isDerivedQuestionId('2aCODE1')).toBe(true);
    });

    test('getQuestionIdKind returns expected kinds', () => {
      expect(getQuestionIdKind('2a')).toBe('main');
      expect(getQuestionIdKind('2aS')).toBe('state');
      expect(getQuestionIdKind('2aF1')).toBe('followup_prompt');
      expect(getQuestionIdKind('2aFA1')).toBe('followup_answer');
      expect(getQuestionIdKind('2aCODE1')).toBe('code');
    });

    test('getQuestionIdKind returns null for invalid ids', () => {
      expect(getQuestionIdKind('2aF0')).toBeNull();
      expect(getQuestionIdKind('junk')).toBeNull();
    });
  });

  describe('normalization behavior', () => {
    test('trims surrounding whitespace', () => {
      const parsed = parseQuestionId('  2aFA1  ');
      expect(parsed.valid).toBe(true);
      expect(parsed.normalized).toBe('2aFA1');
      expect(parsed.root).toBe('2a');
      expect(parsed.kind).toBe('followup_answer');
      expect(parsed.ordinal).toBe(1);
    });
  });
});