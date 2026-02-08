import { describe, it, expect, vi, beforeEach } from 'vitest';
import { valueToString, replaceVars, loadAndReplace } from './readReplace.js';
import { readFile } from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises');

describe('readReplace', () => {
  describe('valueToString', () => {
    it('should return empty string for null and undefined', () => {
      expect(valueToString(null)).toBe('');
      expect(valueToString(undefined)).toBe('');
    });

    it('should return string as is', () => {
      expect(valueToString('hello')).toBe('hello');
    });

    it('should convert numbers, booleans, and bigints to string', () => {
      expect(valueToString(123)).toBe('123');
      expect(valueToString(true)).toBe('true');
      expect(valueToString(false)).toBe('false');
      expect(valueToString(BigInt(100))).toBe('100');
    });

    it('should convert symbols to string', () => {
      expect(valueToString(Symbol('foo'))).toBe('Symbol(foo)');
    });

    it('should convert Date to ISO string', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      expect(valueToString(date)).toBe('2023-01-01T12:00:00.000Z');
    });

    it('should stringify arrays and objects', () => {
      expect(valueToString([1, 'a'])).toBe('[1,"a"]');
      expect(valueToString({ key: 'value' })).toBe('{"key":"value"}');
    });

    it('should return function string representation', () => {
      const fn = () => true;
      expect(valueToString(fn)).toContain('() => true');
    });
  });

  describe('replaceVars', () => {
    it('should replace variables in markdown content', () => {
      const template = '# ${title}\n\n${content}';
      const vars = { title: 'Hello', content: 'World' };
      expect(replaceVars(template, vars)).toBe('# Hello\n\nWorld');
    });

    it('should replace variables in XML content', () => {
      const template = '<root><item id="${id}">${value}</item></root>';
      const vars = { id: 1, value: 'test' };
      expect(replaceVars(template, vars)).toBe('<root><item id="1">test</item></root>');
    });

    it('should handle multiple occurrences of the same variable', () => {
      const template = '${a} ${a} ${b}';
      const vars = { a: 'x', b: 'y' };
      expect(replaceVars(template, vars)).toBe('x x y');
    });

    it('should ignore variables in text that are not in the variables object', () => {
      const template = 'Hello ${name}, ignore ${missing}';
      const vars = { name: 'User' };
      // Since 'missing' is not in vars, the regex won't match it
      expect(replaceVars(template, vars)).toBe('Hello User, ignore ${missing}');
    });

    it('should return content unchanged if variables object is empty', () => {
      const template = 'Hello ${name}';
      expect(replaceVars(template, {})).toBe('Hello ${name}');
    });
  });

  describe('loadAndReplace', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should read file and replace variables', async () => {
      const filePath = 'test.md';
      const fileContent = 'Title: ${title}';
      const vars = { title: 'My Doc' };

      vi.mocked(readFile).mockResolvedValue(fileContent);

      const result = await loadAndReplace(filePath, vars);

      expect(readFile).toHaveBeenCalledWith(filePath, 'utf-8');
      expect(result).toBe('Title: My Doc');
    });

    it('should log error and rethrow if reading fails', async () => {
      const error = new Error('Read error');
      vi.mocked(readFile).mockRejectedValue(error);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(loadAndReplace('bad.txt', {})).rejects.toThrow(error);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
