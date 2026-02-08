import { readFile } from 'fs/promises';
// Smart string conversion for any value
export function valueToString(value) {
    if (value === null || value === undefined) {
        return ''; // Or return 'null'/'undefined' if you prefer
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'symbol') {
        return value.toString(); // "Symbol(description)"
    }
    if (value instanceof Date) {
        return value.toISOString(); // Or format as you prefer
    }
    if (Array.isArray(value) || typeof value === 'object') {
        return JSON.stringify(value);
    }
    if (typeof value === 'function') {
        return value.toString(); // Or execute it: return value()
    }
    // Fallback for any other type
    return String(value);
}
// Core replacement function with smart conversion
export function replaceVars(content, variables) {
    const varNames = Object.keys(variables);
    if (varNames.length === 0)
        return content;
    const pattern = new RegExp(`\\$\\{(${varNames.join('|')})\\}`, 'g');
    return content.replace(pattern, (match, varName) => {
        return valueToString(variables[varName]);
    });
}
// File loading with your signature
export async function loadAndReplace(filePath, variables) {
    try {
        const content = await readFile(filePath, 'utf-8');
        return replaceVars(content, variables);
    }
    catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        throw error;
    }
}
