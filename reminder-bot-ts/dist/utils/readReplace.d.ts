export declare function valueToString(value: any): string;
export declare function replaceVars(content: string, variables: Record<string, any>): string;
export declare function loadAndReplace(filePath: string, variables: Record<string, any>): Promise<string>;
