const transpiler = new Bun.Transpiler({ loader: 'ts' });

export const transpileFunctionBody = (source: string): string => transpiler.transformSync(source);
